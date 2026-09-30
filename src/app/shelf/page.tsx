"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CoverCard } from "@/components/cover-card";
import { useWallet } from "@/components/wallet";
import { IconPen } from "@/components/icons";
import { short } from "@/lib/format";
import type { Comic, JobStage } from "@/lib/types";

type ActiveJob = { id: string; stage: JobStage; title: string | null; drawn: number; total: number };

export default function Shelf() {
  const { address, connect, connecting, error } = useWallet();
  const [mine, setMine] = useState<{ owner: string; list: Comic[]; active: ActiveJob[] } | null>(null);

  useEffect(() => {
    if (!address) return;
    let live = true;
    Promise.all([
      fetch(`/api/comics?owner=${address}`).then((r) => r.json() as Promise<{ comics: Comic[] }>),
      fetch(`/api/jobs?payer=${address}`).then((r) => r.json() as Promise<{ jobs: ActiveJob[] }>),
    ])
      .then(([c, j]) => live && setMine({ owner: address, list: c.comics, active: j.jobs }))
      .catch(() => live && setMine({ owner: address, list: [], active: [] }));
    return () => {
      live = false;
    };
  }, [address]);

  const list = mine && mine.owner === address ? mine.list : null;
  const active = mine && mine.owner === address ? mine.active : [];

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <h1 className="masthead text-[30vw] text-kapow md:text-[clamp(140px,15vw,216px)]">Shelf</h1>

      {!address ? (
        <div className="mt-8 max-w-[520px]">
          <p className="text-[16px] leading-relaxed text-soft">
            Your shelf is every issue minted to your wallet on Arbitrum. Connect to see yours. Reading is free and never needs a wallet.
          </p>
          <button onClick={connect} disabled={connecting} className="slant mt-6 h-12 px-7 text-[19px]">
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
          {error && <p role="alert" className="mt-4 text-[13.5px] text-kapow">{error}</p>}
        </div>
      ) : (
        <>
          <p className="mt-4 text-[14px] text-mute" aria-live="polite">
            {list === null
              ? "Pulling your issues…"
              : `${list.length} ${list.length === 1 ? "issue" : "issues"} minted to `}
            {list !== null && <span className="font-mono text-soft">{short(address)}</span>}
          </p>
          <ul className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
            {active.map((j) => (
              <li key={j.id}>
                <Link
                  href={`/create?job=${j.id}`}
                  className="flex aspect-[3/4] flex-col justify-end gap-2 border-2 border-kapow/70 bg-stock p-4 hover:border-kapow"
                >
                  <span className="halftone mb-auto h-16 w-16 animate-ink rounded-full text-kapow/60" aria-hidden />
                  <span className="text-[12px] text-kapow">Still being made · {j.stage === "drawing" ? `${j.drawn} of ${j.total} panels` : j.stage}</span>
                  <span className="font-display text-[20px] uppercase leading-tight text-paper">{j.title ?? "Untitled issue"}</span>
                </Link>
              </li>
            ))}
            {(list ?? []).map((c, i) => (
              <li key={c.id}>
                <CoverCard comic={c} index={i} />
              </li>
            ))}
            <li>
              <Link
                href="/create"
                className="flex aspect-[3/4] flex-col items-center justify-center gap-3 border-2 border-dashed border-rule text-mute hover:border-kapow hover:text-kapow"
              >
                <IconPen width={26} height={26} />
                <span className="font-display text-[18px] uppercase">{list?.length ? "Make a new issue" : "Make your first issue"}</span>
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
