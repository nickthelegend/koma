"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { KOMA, USDC_DECIMALS, LAUNCH_PRICE } from "@/lib/network";
import type { LaunchJob, LaunchStage } from "@/lib/launchpad/types";
import type { Quote } from "../studio/use-generation";
import { useWallet, walletErrorMessage } from "../wallet";

export type LaunchRequest = LaunchJob["request"];

export type LaunchState = {
  stage: "idle" | "quoting" | "quote" | "signing" | LaunchStage;
  quote?: Quote;
  /** Problem before any money moved; the pay sheet shows it. */
  quoteError?: string;
  jobId?: string;
  paymentTx?: `0x${string}`;
  sheet?: string;
  launchTx?: `0x${string}`;
  seriesId?: number;
  request?: LaunchRequest;
  error?: string;
  failedAt?: LaunchStage;
};

const IDLE: LaunchState = { stage: "idle" };
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function errorText(res: Response) {
  const body = await res.json().catch(() => null);
  return body?.error ?? body?.errorMessage ?? body?.errorReason ?? `Server answered ${res.status}`;
}

/**
 * A series launch over x402, the same way the studio buys an issue:
 * quote → one USDC signature → resend with PAYMENT-SIGNATURE → poll the launch.
 */
export function useLaunch() {
  const wallet = useWallet();
  const [s, set] = useState<LaunchState>(IDLE);
  const pending = useRef<{ request: LaunchRequest; required: PaymentRequired } | null>(null);
  const polling = useRef<AbortController | null>(null);

  const follow = useCallback(async (jobId: string) => {
    polling.current?.abort();
    const ctl = new AbortController();
    polling.current = ctl;
    while (!ctl.signal.aborted) {
      try {
        const res = await fetch(`/api/launches/${jobId}`, { cache: "no-store", signal: ctl.signal });
        if (res.status === 404) {
          set({ ...IDLE, stage: "error", error: "That launch could not be found." });
          return;
        }
        const job = (await res.json()) as LaunchJob;
        set((p) => ({
          ...p,
          stage: job.stage,
          jobId: job.id,
          paymentTx: job.paymentTx,
          sheet: job.sheet,
          launchTx: job.launchTx,
          seriesId: job.seriesId,
          request: job.request,
          error: job.error,
          failedAt: job.failedAt,
        }));
        if (job.stage === "done" || job.stage === "error") {
          wallet.refreshBalance();
          return;
        }
      } catch {
        if (ctl.signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  }, [wallet]);

  useEffect(() => () => polling.current?.abort(), []);

  const requestQuote = useCallback(async (request: LaunchRequest) => {
    set({ ...IDLE, stage: "quoting", request });
    try {
      const res = await fetch("/api/series/quote", json(request));
      if (res.status !== 200 || !res.headers.get("PAYMENT-REQUIRED")) {
        set({ ...IDLE, stage: "quote", request, quoteError: await errorText(res) });
        return;
      }
      const required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((n) => res.headers.get(n));
      const req = required.accepts.find((a) => a.network === KOMA.caip) ?? required.accepts[0];
      pending.current = { request, required };
      set({
        ...IDLE,
        stage: "quote",
        request,
        quote: { amount: Number(formatUnits(BigInt(req.amount), USDC_DECIMALS)).toFixed(2), network: req.network, payTo: req.payTo as `0x${string}`, asset: req.asset as `0x${string}` },
      });
    } catch (e) {
      set({ ...IDLE, stage: "quote", request, quoteError: (e as Error).message });
    }
  }, []);

  const pay = useCallback(async () => {
    const p = pending.current;
    if (!p) return;
    set((st) => ({ ...st, stage: "signing", quoteError: undefined }));
    let http: x402HTTPClient;
    let header: Record<string, string>;
    try {
      const signer = await wallet.signer();
      // Pay only KOMA's USDC on KOMA's network, never more than a launch costs.
      http = new x402HTTPClient(
        x402Client.fromConfig({
          schemes: [{ network: KOMA.caip, client: new ExactEvmScheme(signer) }],
          spendControls: { allowedAssets: [{ network: KOMA.caip, asset: KOMA.usdc, maxAmountPerPayment: String(Math.round(LAUNCH_PRICE * 1e6)) }] },
        }),
      );
      header = http.encodePaymentSignatureHeader(await http.createPaymentPayload(p.required));
    } catch (e) {
      set((st) => ({ ...st, stage: "quote", quoteError: walletErrorMessage(e) }));
      return;
    }

    set((st) => ({ ...st, stage: "settling" }));
    try {
      const res = await fetch("/api/series", { ...json(p.request), headers: { "Content-Type": "application/json", ...header } });
      if (res.status !== 202) {
        const why = await errorText(res);
        set((st) => ({ ...st, stage: "quote", quoteError: `Payment not accepted: ${why}` }));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      const settled = http.getPaymentSettleResponse((n) => res.headers.get(n));
      pending.current = null;
      set((st) => ({ ...st, jobId, paymentTx: settled?.transaction as `0x${string}` | undefined }));
      window.history.replaceState(null, "", `${window.location.pathname}?job=${jobId}`);
      void follow(jobId);
    } catch (e) {
      set((st) => ({ ...st, stage: "quote", quoteError: (e as Error).message }));
    }
  }, [wallet, follow]);

  /** Close the pay sheet; the form keeps what was typed. */
  const cancel = useCallback(() => {
    polling.current?.abort();
    pending.current = null;
    set(IDLE);
    if (window.location.search.includes("job=")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const resume = useCallback((jobId: string) => {
    set({ ...IDLE, stage: "settling", jobId });
    void follow(jobId);
  }, [follow]);

  return { state: s, requestQuote, pay, cancel, resume };
}
