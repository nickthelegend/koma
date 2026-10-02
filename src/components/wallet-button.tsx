"use client";

import { useWallet } from "./wallet";
import { ArbMark } from "./icons";
import { short } from "@/lib/format";

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, usdc, usdcLoaded, connecting, connect, disconnect, error } = useWallet();

  if (!address) {
    return (
      <div className="relative">
        <button
          onClick={connect}
          disabled={connecting}
          className="h-9 border border-paper/80 px-3.5 text-[13px] font-semibold tracking-tight text-paper transition-colors hover:bg-paper hover:text-ink disabled:opacity-60"
        >
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
        {error && (
          <p role="alert" className="absolute right-0 top-11 z-50 w-[260px] border border-kapow/60 bg-stock px-3 py-2 text-[12.5px] leading-snug text-paper shadow-lg">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={disconnect}
      title="Disconnect"
      className="group flex h-9 items-center gap-2 border border-rule bg-stock pl-2 pr-3 text-[13px] hover:border-arb"
    >
      <ArbMark />
      {!compact && <span className="font-mono text-[12px] text-arb">{usdcLoaded ? usdc.toFixed(2) : "…"} USDC</span>}
      <span className="font-mono text-[12px] text-soft group-hover:text-paper">{short(address, 5, 3)}</span>
    </button>
  );
}
