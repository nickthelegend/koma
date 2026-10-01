"use client";

import { useState } from "react";
import { KOMA } from "@/lib/network";
import { useWallet } from "../wallet";

/** Not enough USDC: on testnets, where free test USDC comes from; on Arbitrum One, plainly how much more is needed. */
export function FaucetHint({ need }: { need: number }) {
  const { address, usdc, refreshBalance } = useWallet();
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

  return (
    <div className="border border-kapow/50 px-3 py-3 text-[13px] leading-relaxed text-soft">
      Your wallet has {usdc.toFixed(2)} USDC on {KOMA.label}. Add at least {Math.max(0.01, need - usdc).toFixed(2)} more for this.
      {KOMA.faucet && (
        <>
          <button onClick={claim} disabled={faucet.busy} className="mt-3 block h-10 w-full bg-arb font-display text-[16px] uppercase text-ink disabled:opacity-60">
            {faucet.busy ? "Sending test USDC…" : "Get 1 test USDC"}
          </button>
          {faucet.error && <span role="alert" className="mt-2 block text-kapow">{faucet.error}</span>}
        </>
      )}
      {KOMA.key === "arbitrum-one" && <> Send USDC on Arbitrum One to this wallet, from an exchange or a bridge.</>}
      {KOMA.key === "arbitrum-sepolia" && (
        <>
          {" "}Test USDC is free at{" "}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-arb underline">faucet.circle.com</a>.
        </>
      )}
    </div>
  );
}
