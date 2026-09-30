"use client";

import Link from "next/link";
import type { GenState, Stage } from "./use-generation";
import { ComicPage } from "../comic-page";
import { ShareButton } from "../share-button";
import { ArbMark, IconBook, IconCheck, IconPen } from "../icons";
import { short } from "@/lib/format";
import { txUrl } from "@/lib/explorer";

const STEPS: { key: Stage; label: string }[] = [
  { key: "settling", label: "Payment settled on Arbitrum" },
  { key: "writing", label: "Script written" },
  { key: "drawing", label: "Panels drawn" },
  { key: "lettering", label: "Balloons lettered" },
  { key: "minting", label: "Minted to your wallet" },
];
const ORDER: Stage[] = ["signing", "settling", "writing", "drawing", "lettering", "minting", "done"];

function status(step: Stage, s: GenState) {
  const now = s.stage === "error" ? (s.failedAt ?? "settling") : s.stage;
  const a = ORDER.indexOf(step);
  const b = ORDER.indexOf(now);
  if (s.stage === "error" && a === b) return "failed";
  return b > a ? "done" : b === a ? "active" : "todo";
}

const txLink = (hash: string, label: string) => (
  <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-arb hover:underline">
    {label}
  </a>
);

function detail(step: Stage, s: GenState) {
  switch (step) {
    case "settling":
      return s.paymentTx ? txLink(s.paymentTx, short(s.paymentTx, 8, 6)) : "Facilitator submitting the USDC transfer…";
    case "writing":
      return s.script ? `“${s.script.title}”` : "Planning beats and dialogue…";
    case "drawing":
      return `${s.drawn} of ${s.total} panels`;
    case "lettering":
      return "Speech, captions and sound effects";
    case "minting":
      return s.tokenId && s.mintTx ? txLink(s.mintTx, `Token #${s.tokenId}`) : "Writing the content hash on-chain…";
  }
}

/** The five stages of a paid issue, with live detail for the current one. */
export function Steps({ state, className = "" }: { state: GenState; className?: string }) {
  return (
    <ol className={`border-l-2 border-rule ${className}`}>
      {STEPS.map((st, i) => {
        const k = status(st.key, state);
        return (
          <li key={st.key} className="relative pb-5 pl-6 last:pb-0" aria-current={k === "active" ? "step" : undefined}>
            <span
              className={`absolute -left-[11px] top-0 grid h-5 w-5 place-items-center font-display text-[11px] ${
                k === "done" ? "bg-kapow text-ink" : k === "active" ? "animate-pulse bg-paper text-ink" : k === "failed" ? "bg-[#ff3b3b] text-ink" : "border-2 border-rule bg-ink text-mute"
              }`}
            >
              {k === "done" ? <IconCheck width={12} height={12} strokeWidth={3} /> : k === "failed" ? "!" : i + 1}
            </span>
            <p className={`text-[14px] font-semibold leading-5 ${k === "todo" ? "text-mute" : "text-paper"}`}>{st.label}</p>
            {k !== "todo" && <p className="mt-0.5 text-[12.5px] text-mute">{detail(st.key, state)}</p>}
            {k === "active" && st.key === "drawing" && (
              <div className="mt-2 h-1.5 bg-rule">
                <div className="h-full bg-kapow transition-[width] duration-500" style={{ width: `${(state.drawn / Math.max(1, state.total)) * 100}%` }} />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Progress({ state, onReset }: { state: GenState; onReset: () => void }) {
  const done = state.stage === "done";
  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-16 pt-6 md:grid-cols-[360px_1fr] md:gap-14 md:px-8 md:pt-10">
      <aside className="md:sticky md:top-24 md:self-start">
        <p className="text-[13px] text-mute">{done ? "Issue ready" : state.stage === "error" ? "Something went wrong" : "Making your issue"}</p>
        <h1 className="masthead mt-1 text-[16vw] text-kapow md:text-[88px]">{state.script?.title ?? (state.stage === "error" ? "Stopped" : "Writing…")}</h1>
        {state.script && <p className="mt-3 text-[15px] leading-relaxed text-soft">{state.script.logline}</p>}

        <Steps state={state} className="mt-8" />

        {done ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/c/${state.jobId}/read`} className="slant h-12 px-7 text-[20px]">
              <IconBook width={18} height={18} /> Read it
            </Link>
            <ShareButton title={state.script?.title ?? "My comic"} path={`/c/${state.jobId}`} />
            <button onClick={onReset} className="flex h-12 items-center gap-2 px-2 font-display text-[16px] uppercase text-soft hover:text-paper">
              <IconPen width={16} height={16} /> Make another
            </button>
          </div>
        ) : state.stage === "error" ? (
          <div role="alert" className="mt-8 border border-[#ff3b3b]/60 bg-[#ff3b3b]/10 p-4 text-[13.5px] leading-relaxed text-soft">
            <p className="font-semibold text-paper">This issue stopped partway.</p>
            <p className="mt-1">{state.error}</p>
            {state.paymentTx && (
              <p className="mt-2 text-[12.5px]">
                Your payment is on-chain ({txLink(state.paymentTx, short(state.paymentTx, 8, 6))}). Keep this link: job{" "}
                <span className="font-mono">{state.jobId}</span>.
              </p>
            )}
            <button onClick={onReset} className="mt-3 font-display text-[15px] uppercase text-paper underline decoration-kapow underline-offset-4">
              Back to the studio
            </button>
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[12.5px] text-mute">
            <ArbMark width={14} height={14} /> You can leave this page. The issue finishes and lands on your shelf.
          </p>
        )}
      </aside>

      <section aria-label="Live preview" aria-busy={!done} className="min-w-0">
        {state.pages.length === 0 ? (
          <div className="comic-sheet mx-auto grid aspect-[3/4] max-w-[760px] place-items-center">
            <div className="text-center">
              <div className="halftone mx-auto h-24 w-24 animate-ink rounded-full text-[#0d0d0d]/40" />
              <p className="mt-4 font-letter text-[14px] uppercase text-[#0d0d0d]/70">
                {state.stage === "writing" ? "Writing the script…" : "Waiting on the payment…"}
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[760px] flex-col gap-8">
            {state.pages.map((p, i) => (
              <ComicPage key={i} page={p} number={i + 1} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
