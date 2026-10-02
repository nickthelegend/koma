"use client";

import { useEffect, useRef, useState } from "react";
import type { GenState, Quote } from "./use-generation";
import { ArbMark, IconClose } from "../icons";
import { short } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { useWallet } from "../wallet";

/** What the sheet needs from a paid flow: the studio's GenState, or a series launch. */
type PayState = Pick<GenState, "quoteError"> & { stage: string; quote?: Quote };

/** Words that change with what is being bought. Defaults describe a comic issue. */
type Copy = { noun: string; after: string; back: string };
const ISSUE: Copy = { noun: "issue", after: "drawing starts once it lands", back: "Back to the studio" };

/**
 * The HTTP 402 moment. The server answered "payment required" with a quote;
 * this sheet shows that quote in plain words and asks for one signature.
 */
export function PaySheet({ state, onPay, onCancel, copy = ISSUE }: { state: PayState; onPay: () => void; onCancel: () => void; copy?: Copy }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { address, usdc, usdcLoaded, connect, connecting, error: walletError, refreshBalance } = useWallet();
  const [faucet, setFaucet] = useState<{ busy: boolean; error?: string }>({ busy: false });

  async function claim() {
    setFaucet({ busy: true });
    const res = await fetch("/api/faucet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    if (!res?.ok) {
      setFaucet({ busy: false, error: body?.error ?? "The faucet didn't answer. Try again." });
      return;
    }
    refreshBalance();
    setFaucet({ busy: false });
  }
  const open = state.stage === "quote" || state.stage === "signing";
  const q = state.quote;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const tooLow = address && q && usdcLoaded && Number(q.amount) > usdc;
  const problem = state.quoteError ?? walletError;

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (state.stage === "quote") onCancel();
      }}
      className="mb-0 mt-auto w-full max-w-none bg-transparent p-0 text-paper backdrop:bg-black/75 backdrop:backdrop-blur-sm md:m-auto md:w-[460px]"
    >
      <div className="border-t-4 border-kapow bg-stock pb-[max(env(safe-area-inset-bottom),20px)] md:border md:border-t-4 md:border-rule md:border-t-kapow md:pb-0">
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            <p className="font-mono text-[11.5px] text-kapow">{q ? "HTTP 402 · Payment required" : `Can't quote this ${copy.noun}`}</p>
            <p className="mt-1 font-display text-[34px] uppercase leading-none">{q ? `Pay ${q.amount} USDC` : "Not yet"}</p>
          </div>
          {state.stage === "quote" && (
            <button onClick={onCancel} aria-label="Cancel" className="-mr-1 p-1 text-mute hover:text-paper">
              <IconClose />
            </button>
          )}
        </div>

        {q && (
          <>
            <dl className="mx-5 mt-5 border border-rule bg-ink text-[13px]">
              {[
                ["Network", <span key="n" className="flex items-center gap-1.5"><ArbMark /> {KOMA.label}</span>],
                ["Token", <span key="t">USDC <span className="font-mono text-[11.5px] text-mute">{short(q.asset)}</span></span>],
                ["Pay to", <span key="p" className="font-mono text-[12px]">{short(q.payTo)}</span>],
                ["Settled by", "KOMA facilitator"],
                ["Gas", "None for you"],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-center justify-between gap-4 border-t border-rule px-3.5 py-2.5 first:border-t-0">
                  <dt className="text-mute">{k}</dt>
                  <dd className="text-right text-paper">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mx-5 mt-4 text-[12.5px] leading-relaxed text-mute">
              Your wallet signs a one-time USDC transfer authorization for exactly this amount. The facilitator submits it on
              Arbitrum, and {copy.after}. The signature can&rsquo;t be reused.
            </p>
          </>
        )}

        {problem && (
          <p role="alert" className="mx-5 mt-4 border border-kapow/60 bg-kapow/10 px-3 py-2.5 text-[13px] leading-snug text-paper">
            {problem}
          </p>
        )}

        <div className="px-5 pb-5 pt-5">
          {!q ? (
            <button onClick={onCancel} className="h-12 w-full border-2 border-paper/80 font-display text-[18px] uppercase hover:bg-paper hover:text-ink">
              {copy.back}
            </button>
          ) : !address ? (
            <button onClick={connect} disabled={connecting} className="slant w-full py-3.5 text-[20px]">
              {connecting ? "Connecting…" : "Connect wallet to pay"}
            </button>
          ) : tooLow ? (
            <p className="border border-kapow/50 px-3 py-3 text-[13px] leading-relaxed text-soft">
              Your wallet has {usdc.toFixed(2)} USDC on {KOMA.label}. Add at least {(Number(q.amount) - usdc).toFixed(2)} more to pay
              for this {copy.noun}.
              {KOMA.faucet && (
                <>
                  <button onClick={claim} disabled={faucet.busy} className="mt-3 block h-10 w-full bg-arb font-display text-[16px] uppercase text-ink disabled:opacity-60">
                    {faucet.busy ? "Sending test USDC…" : "Get 1 test USDC"}
                  </button>
                  {faucet.error && <span role="alert" className="mt-2 block text-kapow">{faucet.error}</span>}
                </>
              )}
              {KOMA.key === "arbitrum-sepolia" && (
                <>
                  {" "}Test USDC is free at{" "}
                  <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-arb underline">faucet.circle.com</a>.
                </>
              )}
            </p>
          ) : (
            <button onClick={onPay} disabled={state.stage === "signing"} className="slant w-full py-3.5 text-[20px]">
              {state.stage === "signing" ? "Confirm in your wallet…" : `Sign & pay ${q.amount} USDC`}
            </button>
          )}
          {address && q && (
            <p className="mt-3 text-center text-[12px] text-mute">
              Paying from <span className="font-mono">{short(address)}</span> · {usdcLoaded ? usdc.toFixed(2) : "…"} USDC available
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
