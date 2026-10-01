"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { KOMA, USDC_DECIMALS } from "@/lib/network";
import type { Job, JobStage, Order, Page } from "@/lib/types";
import { useWallet, walletErrorMessage } from "../wallet";

export type Stage = "idle" | "quoting" | "quote" | "signing" | JobStage;

export type Quote = { amount: string; network: string; payTo: `0x${string}`; asset: `0x${string}` };

export type GenState = {
  stage: Stage;
  quote?: Quote;
  /** Problem before any money moved; the pay sheet shows it. */
  quoteError?: string;
  jobId?: string;
  paymentTx?: `0x${string}`;
  script?: { title: string; logline: string };
  pages: Page[];
  drawn: number;
  total: number;
  tokenId?: number;
  mintTx?: `0x${string}`;
  error?: string;
  failedAt?: JobStage;
};

const IDLE: GenState = { stage: "idle", pages: [], drawn: 0, total: 0 };
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function errorText(res: Response) {
  const body = await res.json().catch(() => null);
  return body?.error ?? body?.errorMessage ?? body?.errorReason ?? `Server answered ${res.status}`;
}

/**
 * The studio's side of x402: ask → 402 quote → one wallet signature →
 * resend with PAYMENT-SIGNATURE → poll the job until the issue is minted.
 */
export function useGeneration() {
  const wallet = useWallet();
  const [s, set] = useState<GenState>(IDLE);
  const pending = useRef<{ order: Order; required: PaymentRequired } | null>(null);
  const polling = useRef<AbortController | null>(null);

  const follow = useCallback(async (jobId: string) => {
    polling.current?.abort();
    const ctl = new AbortController();
    polling.current = ctl;
    while (!ctl.signal.aborted) {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store", signal: ctl.signal });
        if (res.status === 404) {
          set({ ...IDLE, stage: "error", error: "That issue could not be found." });
          return;
        }
        const job = (await res.json()) as Job;
        set((p) => ({
          ...p,
          stage: job.stage,
          jobId: job.id,
          paymentTx: job.paymentTx,
          script: job.script,
          pages: job.pages,
          drawn: job.drawn,
          total: job.total,
          tokenId: job.tokenId,
          mintTx: job.mintTx,
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
      await new Promise((r) => setTimeout(r, 1200));
    }
  }, [wallet]);

  useEffect(() => () => polling.current?.abort(), []);

  const requestQuote = useCallback(async (order: Order) => {
    set({ ...IDLE, stage: "quoting" });
    try {
      // Same requirements the paid endpoint answers 402 with, fetched without a 4xx.
      const res = await fetch("/api/comics/quote", json(order));
      if (res.status !== 200 || !res.headers.get("PAYMENT-REQUIRED")) {
        set({ ...IDLE, stage: "quote", quoteError: await errorText(res) });
        return;
      }
      const required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse((n) => res.headers.get(n));
      const req = required.accepts.find((a) => a.network === KOMA.caip) ?? required.accepts[0];
      pending.current = { order, required };
      set({
        ...IDLE,
        stage: "quote",
        quote: { amount: Number(formatUnits(BigInt(req.amount), USDC_DECIMALS)).toFixed(2), network: req.network, payTo: req.payTo as `0x${string}`, asset: req.asset as `0x${string}` },
      });
    } catch (e) {
      set({ ...IDLE, stage: "quote", quoteError: (e as Error).message });
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
      // Pay only KOMA's USDC on KOMA's network, never more than a 6-page episode costs ($1.80).
      http = new x402HTTPClient(
        x402Client.fromConfig({
          schemes: [{ network: KOMA.caip, client: new ExactEvmScheme(signer) }],
          spendControls: { allowedAssets: [{ network: KOMA.caip, asset: KOMA.usdc, maxAmountPerPayment: "1800000" }] },
        }),
      );
      header = http.encodePaymentSignatureHeader(await http.createPaymentPayload(p.required));
    } catch (e) {
      set((st) => ({ ...st, stage: "quote", quoteError: walletErrorMessage(e) }));
      return;
    }

    set((st) => ({ ...st, stage: "settling" }));
    try {
      const res = await fetch("/api/comics", { ...json(p.order), headers: { "Content-Type": "application/json", ...header } });
      if (res.status !== 202) {
        const why = await errorText(res);
        set((st) => ({ ...st, stage: "quote", quoteError: `Payment not accepted: ${why}` }));
        return;
      }
      const { jobId } = (await res.json()) as { jobId: string };
      const settled = http.getPaymentSettleResponse((n) => res.headers.get(n));
      pending.current = null;
      set((st) => ({ ...st, jobId, paymentTx: settled?.transaction as `0x${string}` | undefined }));
      // Keep an episode's series in the URL, so a reload still shows the episode banner.
      const series = new URLSearchParams(window.location.search).get("series");
      window.history.replaceState(null, "", `${window.location.pathname}?job=${jobId}${series ? `&series=${encodeURIComponent(series)}` : ""}`);
      void follow(jobId);
    } catch (e) {
      set((st) => ({ ...st, stage: "quote", quoteError: (e as Error).message }));
    }
  }, [wallet, follow]);

  const cancel = useCallback(() => {
    polling.current?.abort();
    pending.current = null;
    set(IDLE);
    if (window.location.search.includes("job=")) {
      const series = new URLSearchParams(window.location.search).get("series");
      window.history.replaceState(null, "", `${window.location.pathname}${series ? `?series=${encodeURIComponent(series)}` : ""}`);
    }
  }, []);

  const resume = useCallback((jobId: string) => {
    set({ ...IDLE, stage: "settling", jobId });
    void follow(jobId);
  }, [follow]);

  return { state: s, requestQuote, pay, cancel, resume };
}
