"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { coinAbi } from "@/lib/launchpad/abi";
import { signVote } from "@/lib/launchpad/client";
import type { Addr, CanonView, ProposalView } from "@/lib/launchpad/types";
import { agoSec, coinAmount, countdown, short } from "@/lib/format";
import { KOMA } from "@/lib/network";
import { IconCheck, IconPen } from "../icons";
import { useWallet, walletErrorMessage } from "../wallet";

type Props = {
  seriesId: number;
  symbol: string;
  characterName: string;
  coin: Addr;
  canonRegistry: Addr;
  characterOwner: Addr | null;
};

/**
 * What happens next in the story. Anyone holding 1M coins (or the character's
 * owner) proposes an episode; holders vote for free with a signature,
 * weighted by what they held when the episode opened.
 */
export function CanonBoard({ seriesId, symbol, characterName, coin, canonRegistry, characterOwner }: Props) {
  const wallet = useWallet();
  const [view, setView] = useState<CanonView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Windows are in block time; keep the countdown on the chain's clock.
  const skew = useRef(0);
  const [voting, setVoting] = useState<{ issueId: number; error?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/canon/${seriesId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`The canon board didn't load (${res.status}).`);
      const v = (await res.json()) as CanonView;
      skew.current = v.chainTime * 1000 - Date.now();
      setView(v);
      setNow(Date.now() + skew.current);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [seriesId]);

  // Poll every 5s while the tab is visible; tick the countdown every second.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 5000);
    const tick = setInterval(() => setNow(Date.now() + skew.current), 1000);
    // Coming back to the tab shows the current board at once, not after the next poll.
    const onShow = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [load]);

  const me = wallet.address?.toLowerCase();
  const snapshot = view?.slot?.snapshot;
  const current = useReadContract({
    address: coin,
    abi: coinAbi,
    functionName: "getVotes",
    args: wallet.address ? [wallet.address] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(wallet.address), refetchInterval: 15_000 },
  });
  const atSnapshot = useReadContract({
    address: coin,
    abi: coinAbi,
    functionName: "getPastVotes",
    args: wallet.address && snapshot ? [wallet.address, BigInt(snapshot)] : undefined,
    chainId: KOMA.chain.id,
    query: { enabled: Boolean(wallet.address && snapshot) },
  });
  const held = (x?: bigint) => (x === undefined ? null : Number(formatUnits(x, 18)));
  const nowCoins = held(current.data);
  const snapCoins = held(atSnapshot.data);
  const owner = Boolean(me && characterOwner && characterOwner.toLowerCase() === me);

  if (!view) {
    return (
      <section aria-label="Canon" aria-busy className="min-h-[260px] border border-rule bg-stock p-5">
        {loadError ? (
          <p role="alert" className="text-[13.5px] text-kapow">
            {loadError}{" "}
            <button onClick={load} className="text-paper underline underline-offset-4">Retry</button>
          </p>
        ) : (
          <p className="animate-pulse text-[13.5px] text-mute">Loading the canon board…</p>
        )}
      </section>
    );
  }

  const { episode, slot, proposals } = view;
  const open = slot ? slot.open && now / 1000 < slot.endsAt : true;
  const mine = view.votes.find((v) => v.voter.toLowerCase() === me && v.episode === episode);
  const total = proposals.reduce((s, p) => s + p.votes, 0);
  const top = Math.max(0, ...proposals.map((p) => p.votes));
  const threshold = view.thresholdCoins;
  // Eligibility is measured at the snapshot once the episode is open, else right now.
  const proposingPower = slot ? snapCoins : nowCoins;
  const canPropose = owner || (proposingPower !== null && proposingPower >= threshold);
  const voteWeight = slot ? snapCoins : null;

  async function vote(p: ProposalView) {
    if (!wallet.address) return;
    setVoting({ issueId: p.issueId });
    try {
      const w = await wallet.walletClient();
      const signature = await signVote(w, { canonRegistry, seriesId, episode, issueId: p.issueId, voter: w.account.address });
      const res = await fetch(`/api/canon/${seriesId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode, issueId: p.issueId, voter: w.account.address, signature }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? `The vote wasn't accepted (${res.status}).`);
      setVoting(null);
      void load();
    } catch (e) {
      setVoting({ issueId: p.issueId, error: /reject|denied/i.test((e as Error).message) ? walletErrorMessage(e) : (e as Error).message });
    }
  }

  return (
    <section aria-labelledby="canon-h" className="border border-rule bg-stock">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule px-4 py-3.5 md:px-5">
        <div>
          <p className="text-[13px] text-soft">What happens next, decided by ${symbol} holders</p>
          <h2 id="canon-h" className="masthead mt-1.5 text-[44px] text-paper md:text-[56px]">Episode {episode}</h2>
        </div>
        <div className="text-right" aria-live="off">
          {!slot ? (
            <p className="font-display text-[16px] uppercase text-bam">Open for proposals</p>
          ) : open ? (
            <>
              <p className="font-mono text-[26px] leading-none text-paper" role="timer" aria-label={`Voting closes in ${countdown(slot.endsAt, now)}`}>
                {countdown(slot.endsAt, now)}
              </p>
              <p className="mt-1 text-[11.5px] text-mute">left to vote</p>
            </>
          ) : (
            <p className="max-w-[22ch] text-[12.5px] leading-snug text-soft">Voting closed. The winner is being written on-chain…</p>
          )}
        </div>
      </header>

      <div className="px-4 py-4 md:px-5">
        {/* Who can do what, for the connected wallet */}
        <div className="flex flex-col gap-3 border border-rule bg-ink p-3 text-[12.5px] leading-relaxed text-soft md:flex-row md:items-center md:justify-between">
          <p>
            Proposing needs <span className="text-paper">{threshold.toLocaleString("en-US")} ${symbol}</span>
            {slot ? " held when this episode opened" : ""} or the {characterName} Character NFT.{" "}
            {wallet.address ? (
              owner ? (
                <span className="text-paper">You own the character, so you can always propose.</span>
              ) : proposingPower === null ? (
                <span>Checking your balance…</span>
              ) : (
                <span>
                  You {slot ? "had" : "hold"} <span className="font-mono text-paper">{coinAmount(proposingPower)}</span>.
                </span>
              )
            ) : (
              <span>Connect a wallet to see yours.</span>
            )}
          </p>
          {open && (
            <Link
              href={`/create?series=${seriesId}`}
              className={
                canPropose || !wallet.address
                  ? "slant h-10 shrink-0 px-5 text-[15px]"
                  : "flex h-10 shrink-0 items-center gap-2 border border-rule px-4 font-display text-[15px] uppercase text-soft hover:border-paper hover:text-paper"
              }
            >
              <IconPen width={14} height={14} /> Propose episode {episode}
            </Link>
          )}
        </div>

        {proposals.length === 0 ? (
          <div className="mt-4 border border-dashed border-rule px-5 py-10 text-center">
            <p className="font-display text-[26px] uppercase leading-tight text-paper">Episode {episode} is open. Propose it.</p>
            <p className="mx-auto mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-mute">
              Make a comic starring {characterName} in the studio. It&rsquo;s minted to you like any issue and entered as a proposal.
              {slot ? " Voting is open until the clock runs out." : " The first proposal starts the voting clock."}
            </p>
          </div>
        ) : (
          <>
            {wallet.address && slot && open && (
              <p className="mt-4 text-[12.5px] text-mute">
                {voteWeight === null ? "Checking your voting weight…" : voteWeight > 0 ? (
                  <>Your vote weighs <span className="font-mono text-paper">{coinAmount(voteWeight)}</span> ${symbol} (your balance when voting opened). Signing is free; you can change your vote until the clock runs out.</>
                ) : (
                  <>You held no ${symbol} when this episode opened, so you can&rsquo;t vote on it. Coins bought now count from the next episode.</>
                )}
              </p>
            )}
            <ul className="mt-4 grid gap-4 sm:grid-cols-2">
              {proposals.map((p) => {
                const chosen = mine?.issueId === p.issueId;
                const leading = p.votes > 0 && p.votes === top;
                const pct = total > 0 ? (p.votes / total) * 100 : 0;
                return (
                  <li key={p.issueId} className={`flex gap-3.5 border p-3 ${chosen ? "border-kapow" : leading ? "border-paper/40" : "border-rule"} bg-ink`}>
                    <Link href={p.issue ? `/c/${p.issue.id}` : "#"} className="relative aspect-[3/4] w-[96px] shrink-0 overflow-hidden bg-stock-2" aria-label={p.issue ? `Read ${p.issue.title}` : "Issue"}>
                      {p.issue?.cover && <Image src={p.issue.cover} alt="" fill sizes="96px" className="object-cover" />}
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <p className="line-clamp-2 font-display text-[19px] uppercase leading-tight text-paper">{p.issue?.title ?? `Issue #${p.issueId}`}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-mute">
                        by <span className="font-mono">{short(p.proposer)}</span> · {agoSec(p.proposedAt, now)}
                        {leading && <span className="ml-1.5 font-semibold text-bam">· leading</span>}
                      </p>
                      <div className="mt-2.5 h-2 bg-rule" aria-hidden>
                        <div className="h-full bg-kapow transition-[width] duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-1 flex justify-between gap-2 font-mono text-[11.5px] text-mute">
                        <span>
                          {coinAmount(p.votes)} votes · {p.voters} {p.voters === 1 ? "voter" : "voters"}
                        </span>
                        <span className="text-soft">{Math.round(pct)}%</span>
                      </p>
                      <div className="mt-auto pt-2">
                        {chosen ? (
                          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-kapow">
                            <IconCheck width={13} height={13} /> Your vote
                          </p>
                        ) : open && slot ? (
                          <button
                            onClick={() => (wallet.address ? vote(p) : wallet.connect())}
                            disabled={(voting?.issueId === p.issueId && !voting.error) || (wallet.address !== null && voteWeight === 0)}
                            className="h-8 border border-paper/70 px-3 font-display text-[14px] uppercase text-paper hover:bg-paper hover:text-ink disabled:opacity-40"
                          >
                            {!wallet.address ? "Connect to vote" : voting?.issueId === p.issueId && !voting.error ? "Sign in wallet…" : mine ? "Switch vote" : "Vote"}
                          </button>
                        ) : null}
                        {voting?.issueId === p.issueId && voting.error && <p role="alert" className="mt-1.5 text-[12px] leading-snug text-kapow">{voting.error}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* ——— Canon so far ——— */}
        <h3 className="mt-9 font-display text-[22px] uppercase leading-none text-paper">Canon so far</h3>
        {view.canon.length === 0 ? (
          <p className="mt-2 text-[13px] text-mute">No episode is canon yet. When voting on episode 1 closes, the proposal with the most votes becomes canon.</p>
        ) : (
          <ol className="mt-3 border-l-2 border-kapow">
            {view.canon.map((c) => (
              <li key={c.episode} className="relative pb-4 pl-5 last:pb-0">
                <span className="absolute -left-[7px] top-1.5 h-3 w-3 bg-kapow" aria-hidden />
                <p className="text-[12px] text-mute">Episode {c.episode}</p>
                {c.issue ? (
                  <Link href={`/c/${c.issue.id}`} className="font-display text-[20px] uppercase leading-tight text-paper hover:text-kapow">
                    {c.issue.title}
                  </Link>
                ) : (
                  <p className="font-display text-[20px] uppercase text-paper">Issue #{c.issueId}</p>
                )}
                <p className="mt-0.5 font-mono text-[11px] text-mute">
                  {c.totalVotes > 0 ? `${coinAmount(c.winnerVotes)} of ${coinAmount(c.totalVotes)} votes` : "No votes were cast, so the earliest proposal became canon"}{c.votesRoot && ` · votes root ${short(c.votesRoot, 8, 4)}`}
                </p>
              </li>
            ))}
          </ol>
        )}

        {view.alternates.length > 0 && (
          <>
            <h3 className="mt-9 font-display text-[22px] uppercase leading-none text-paper">Alternate universes</h3>
            <p className="mt-1 text-[12.5px] text-mute">Proposals that lost their vote. Still minted, still readable.</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {view.alternates.map((a) => (
                <li key={a.issueId}>
                  <Link href={a.issue ? `/c/${a.issue.id}` : "#"} className="inline-block border border-rule px-2.5 py-1.5 text-[12.5px] text-soft hover:border-paper hover:text-paper">
                    Ep {a.episode} · {a.issue?.title ?? `Issue #${a.issueId}`}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
