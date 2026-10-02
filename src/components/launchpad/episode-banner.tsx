"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { CANON_THRESHOLD, coinAbi } from "@/lib/launchpad/abi";
import type { CanonView, SeriesDetail } from "@/lib/launchpad/types";
import { coinAmount } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { useWallet } from "../wallet";

/** The series an episode is being written for, as the studio knows it from the server. */
export type EpisodeSeries = { id: number; name: string; symbol: string; characterName: string };

/**
 * Shown above the studio in episode mode. Proposing needs 1M coins (at the
 * open episode's snapshot) or the Character NFT; KOMA refuses the payment
 * before any USDC moves otherwise, and this says so up front.
 */
export function EpisodeBanner({ series }: { series: EpisodeSeries }) {
  const wallet = useWallet();
  const [detail, setDetail] = useState<SeriesDetail | null>(null);
  const [canon, setCanon] = useState<CanonView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch(`/api/series/${series.id}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<SeriesDetail>) : Promise.reject(new Error(`Series #${series.id} didn't load (${r.status}).`)))),
      fetch(`/api/canon/${series.id}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<CanonView>) : null)).catch(() => null),
    ])
      .then(([d, c]) => {
        if (!live) return;
        setDetail(d);
        setCanon(c);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [series.id]);

  const snapshot = canon?.slot?.snapshot;
  // Eligibility is the balance at the open episode's snapshot, or right now if none is open yet.
  const now = useReadContract({
    address: detail?.coin,
    abi: coinAbi,
    functionName: "getVotes",
    args: wallet.address ? [wallet.address] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(wallet.address && detail && !snapshot) },
  });
  const past = useReadContract({
    address: detail?.coin,
    abi: coinAbi,
    functionName: "getPastVotes",
    args: wallet.address && snapshot ? [wallet.address, BigInt(snapshot)] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(wallet.address && detail && snapshot) },
  });
  const votes = snapshot ? past : now;

  const held = votes.data !== undefined ? Number(formatUnits(votes.data, 18)) : null;
  const owner = Boolean(wallet.address && detail?.characterOwner && detail.characterOwner.toLowerCase() === wallet.address.toLowerCase());
  const eligible = owner || (held !== null && held >= CANON_THRESHOLD);
  const episode = canon?.episode;

  return (
    <div className="mt-5 flex gap-3 border border-kapow/60 bg-stock p-3 pr-4">
      <div className="relative aspect-[16/9] w-[92px] shrink-0 self-start overflow-hidden bg-stock-2">
        {detail?.sheetUrl ? (
          <Image src={detail.sheetUrl} alt="" fill sizes="92px" className="object-cover" />
        ) : (
          // No character sheet (launched without one): a small type plate, never an empty box.
          detail && <span className="absolute inset-0 grid place-items-center bg-paper font-display text-[15px] uppercase leading-none text-ink">${series.symbol.trim()}</span>
        )}
      </div>
      <div className="min-w-0 text-[13px] leading-snug text-soft">
        <p className="font-semibold text-paper">
          Episode proposal{episode ? ` (episode ${episode})` : ""} for{" "}
          <Link href={`/s/${series.id}`} className="underline decoration-kapow underline-offset-4">{series.name}</Link> starring {series.characterName}
        </p>
        <p className="mt-1">
          Needs {CANON_THRESHOLD.toLocaleString("en-US")} ${series.symbol} or the Character NFT.{" "}
          {error ? (
            <span className="text-kapow">{error}</span>
          ) : !wallet.address ? (
            "Connect a wallet to check yours."
          ) : owner ? (
            <span className="text-paper">You own the character, so you can always propose.</span>
          ) : held === null ? (
            "Checking your balance…"
          ) : (
            <span className={eligible ? "text-paper" : "text-kapow"}>
              You {snapshot ? "had" : "hold"} {coinAmount(held)} ${series.symbol}
              {snapshot ? " when this episode opened" : ""}.
              {!eligible && " KOMA will refuse the payment before any USDC moves."}
            </span>
          )}
        </p>
        <p className="mt-1 text-[12px] text-mute">It&rsquo;s minted to you like any issue, then entered for holders to vote on.</p>
      </div>
    </div>
  );
}
