"use client";

import { cast as roster, styles } from "@/lib/studio-config";
import { PAGE_OPTIONS } from "@/lib/network";
import { priceFor } from "@/lib/order";
import type { Pitch } from "@/lib/types";
import { ArbMark } from "../icons";

/** The deal on the table: what will be drawn and what it costs. */
export function PitchCard({
  pitch,
  onChange,
  onPay,
  busy,
  locked,
  episodeOf,
}: {
  pitch: Pitch;
  onChange: (p: Pitch) => void;
  onPay: () => void;
  busy: boolean;
  locked: boolean;
  /** Series name when this pitch is an episode proposal. */
  episodeOf?: string;
}) {
  const style = styles.find((s) => s.id === pitch.style);
  const leads = [...roster.filter((c) => pitch.cast.includes(c.id)).map((c) => c.name), ...(pitch.custom ?? []).map((c) => c.name)];
  return (
    <section aria-label="Current pitch" className="border border-rule bg-stock">
      <div className="border-b border-rule px-4 py-2.5">
        <p className="text-[12px] text-mute">
          {locked ? "Paid for" : "The pitch"}
          {episodeOf && <span className="text-kapow"> · Episode for {episodeOf}</span>}
        </p>
      </div>
      <div className="p-4">
        <h2 className="masthead text-[40px] leading-[0.9] text-paper">{pitch.title}</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-soft">{pitch.prompt}</p>
        <dl className="mt-4 grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-mute">Genre</dt>
          <dd className="text-paper">{pitch.genre ?? "Writer's choice"}</dd>
          <dt className="text-mute">Style</dt>
          <dd className="text-paper">{style?.label}</dd>
          <dt className="text-mute">Starring</dt>
          <dd className="text-paper">{leads.length ? leads.join(" and ") : "Invented by the writer"}</dd>
        </dl>
        {pitch.custom?.map((c) => (
          <p key={c.name} className="mt-2 text-[12.5px] leading-snug text-mute">
            <span className="text-soft">{c.name}:</span> {c.look}
          </p>
        ))}

        <div role="radiogroup" aria-label="Pages" className="mt-5 grid grid-cols-4 border border-rule">
          {PAGE_OPTIONS.map((n) => {
            const on = n === pitch.pages;
            return (
              <button
                key={n}
                role="radio"
                aria-checked={on}
                disabled={locked || busy}
                onClick={() => onChange({ ...pitch, pages: n, price: priceFor(n, Boolean(pitch.seriesId)) })}
                className={`border-l border-rule py-2 first:border-l-0 disabled:cursor-default ${on ? "bg-paper text-ink" : "text-soft hover:bg-stock-2"}`}
              >
                <span className="block font-display text-[20px] leading-none">{n}</span>
                <span className={`mt-0.5 block text-[11px] ${on ? "text-ink/70" : "text-mute"}`}>{n === 1 ? "page" : "pages"}</span>
              </button>
            );
          })}
        </div>

        {!locked && (
          <>
            <button onClick={onPay} disabled={busy} className="slant mt-5 w-full py-3.5 text-[20px]">
              {busy ? "Getting quote…" : `Pay ${pitch.price} USDC & draw`}
            </button>
            <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-mute">
              <ArbMark width={12} height={12} /> One signature in your wallet · no gas
            </p>
          </>
        )}
      </div>
    </section>
  );
}
