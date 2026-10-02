"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { GENRES } from "@/lib/studio-config";
import { FEE_SPLIT, GRADUATION_FEE_PCT, KOMA, LAUNCH_PRICE, TRADE_FEE_PCT } from "@/lib/network";
import { txUrl } from "@/lib/explorer";
import { short } from "@/lib/format";
import { CANON_THRESHOLD, DEMO_TARGET_USDC, GRADUATION_TARGET_USDC, START_PRICE_USDC, TOTAL_SUPPLY } from "@/lib/launchpad/abi";
import type { SeriesSummary } from "@/lib/launchpad/types";
import type { Genre } from "@/lib/types";
import { PaySheet } from "../studio/pay-sheet";
import { ArbMark, IconCheck, IconPlus, IconRemix } from "../icons";
import { SeriesCard } from "./series-card";
import { COIN_DISCLAIMER, MAINNET } from "./network-note";
import { useLaunch, type LaunchRequest, type LaunchState } from "./use-launch";
import { AI_DOWN_NOTE } from "../use-server-status";

export type ParentSeries = { id: number; name: string; symbol: string; characterName: string };

const LAUNCH_COPY = { noun: "launch", after: "the character sheet is drawn once it lands", back: "Back to the form" };

type Draft = { name: string; symbol: string; characterName: string; characterPrompt: string; pitch: string; genre: Genre | ""; demo: boolean };

/** Same rules as the server's parseLaunch, so problems show before the quote. */
function problems(d: Draft): Partial<Record<keyof Draft, string>> {
  const p: Partial<Record<keyof Draft, string>> = {};
  const len = (s: string) => s.trim().length;
  if (len(d.name) < 2 || len(d.name) > 32) p.name = "2 to 32 characters.";
  if (!/^[A-Z0-9]{2,8}$/.test(d.symbol.trim().toUpperCase())) p.symbol = "2 to 8 letters or digits.";
  if (len(d.characterName) < 2 || len(d.characterName) > 30) p.characterName = "2 to 30 characters.";
  if (len(d.characterPrompt) < 20 || len(d.characterPrompt) > 400) p.characterPrompt = "Describe the look in 20 to 400 characters.";
  if (len(d.pitch) < 12 || len(d.pitch) > 600) p.pitch = "Pitch the series in 12 to 600 characters.";
  return p;
}

const inputCls = "mt-1.5 w-full border border-rule bg-ink px-3 py-2.5 text-[15.5px] text-paper placeholder:text-mute focus:border-soft focus:outline-none aria-[invalid=true]:border-kapow";

function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-paper">{label}</label>
        {hint && <span className="font-mono text-[11px] text-mute" aria-hidden>{hint}</span>}
      </div>
      {children}
      {error && <p id={`${id}-err`} className="mt-1 text-[12.5px] text-kapow">{error}</p>}
    </div>
  );
}

/** Launch a series: a character, a pitch and a ticker; KOMA draws the sheet and launches everything in one transaction. */
export function LaunchStudio({ deployed, parent, job, arbitrum }: { deployed: boolean; parent: ParentSeries | null; job?: string; arbitrum?: React.ReactNode }) {
  const ids = useId();
  const [d, setD] = useState<Draft>({ name: "", symbol: "", characterName: "", characterPrompt: "", pitch: "", genre: "", demo: !MAINNET });
  const [tried, setTried] = useState(false);
  const [offline, setOffline] = useState<string | null>(null);
  const [aiDown, setAiDown] = useState(false);
  const { state, requestQuote, pay, cancel, resume } = useLaunch();

  useEffect(() => {
    if (job) resume(job);
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: { ready: boolean; missing: string[]; launchpad: unknown; ai?: { ok: boolean } }) => {
        setOffline(!s.launchpad ? "launchpad" : s.ready ? null : s.missing.join(", "));
        setAiDown(s.ready && s.ai?.ok === false);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errs = problems(d);
  const valid = Object.keys(errs).length === 0;
  const show = (k: keyof Draft) => (tried || d[k] !== "") && errs[k] ? errs[k] : undefined;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const target = d.demo ? DEMO_TARGET_USDC : GRADUATION_TARGET_USDC;

  if (!["idle", "quoting", "quote", "signing"].includes(state.stage)) {
    return <LaunchProgress state={state} onReset={cancel} />;
  }

  const request = (): LaunchRequest => ({
    name: d.name.trim(),
    symbol: d.symbol.trim().toUpperCase(),
    characterName: d.characterName.trim(),
    characterPrompt: d.characterPrompt.trim(),
    pitch: d.pitch.trim(),
    genre: d.genre || undefined,
    parentSeriesId: parent?.id ?? 0,
    demo: d.demo,
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (valid && !offline && !aiDown && deployed) void requestQuote(request());
  };
  const down = !deployed || offline === "launchpad";
  const zero = "0x0000000000000000000000000000000000000000" as const;
  const preview: SeriesSummary = {
    id: 0,
    name: d.name.trim() || "Series name",
    symbol: d.symbol || "TICKER",
    characterName: d.characterName.trim() || "Your character",
    sheetUrl: "",
    coin: zero,
    curve: zero,
    characterId: 0,
    characterAccount: zero,
    creator: zero,
    parentSeriesId: parent?.id ?? 0,
    priceUsdc: START_PRICE_USDC,
    marketCapUsdc: START_PRICE_USDC * TOTAL_SUPPLY,
    raisedUsdc: 0,
    targetUsdc: target,
    complete: false,
    graduated: false,
    demo: d.demo,
    holders: 0,
    episodes: 0,
    launchedAt: 0,
    lastTradeAt: null,
  };

  return (
    <>
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pb-14 pt-6 md:grid-cols-[minmax(0,1fr)_400px] md:gap-14 md:px-8 md:pt-10">
        <div className="min-w-0">
          <h1 className="masthead text-[23vw] text-kapow md:text-[clamp(120px,12vw,172px)]">Launch</h1>
          <p className="mt-4 max-w-[56ch] text-[15px] leading-relaxed text-soft">
            Start a series: a character people can follow from episode to episode. For ${LAUNCH_PRICE} in USDC, KOMA draws the character sheet
            and launches everything on {KOMA.label} in one transaction.
          </p>

          {down ? (
            <p role="status" className="mt-6 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              <span className="font-semibold text-paper">The launchpad is offline.</span> Its contracts aren&rsquo;t deployed on{" "}
              {KOMA.label} yet, so series can&rsquo;t be launched here. You can still read the form and make comics in the{" "}
              <Link href="/create" className="text-paper underline underline-offset-4">studio</Link>.
            </p>
          ) : aiDown ? (
            <p role="status" className="mt-6 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              {AI_DOWN_NOTE}
            </p>
          ) : (
            offline && (
              <p role="status" className="mt-6 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
                <span className="font-semibold text-paper">Launching is offline.</span> This server hasn&rsquo;t been given {offline} yet,
                so it can&rsquo;t take payments.
              </p>
            )
          )}

          {parent && (
            <div className="mt-6 flex items-center gap-3 border border-rule bg-stock p-3">
              <IconRemix width={18} height={18} className="shrink-0 text-kapow" />
              <p className="min-w-0 text-[13px] leading-snug text-soft">
                <span className="block font-semibold text-paper">
                  Remix of <Link href={`/s/${parent.id}`} className="underline decoration-kapow underline-offset-4">{parent.name}</Link> (${parent.symbol})
                </span>
                A new series in {parent.characterName}&rsquo;s world. A share of every trade fee on yours flows back up to it.
              </p>
            </div>
          )}

          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-6" aria-describedby={`${ids}-note`}>
            <div className="grid gap-6 sm:grid-cols-[1fr_170px]">
              <Field id={`${ids}-name`} label="Series name" hint={`${d.name.trim().length}/32`} error={show("name")}>
                <input id={`${ids}-name`} value={d.name} maxLength={32} onChange={(e) => set("name", e.target.value)} placeholder="Rain City Couriers" aria-invalid={Boolean(show("name"))} aria-describedby={show("name") ? `${ids}-name-err` : undefined} className={inputCls} />
              </Field>
              <Field id={`${ids}-sym`} label="Ticker" error={show("symbol")}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-[calc(50%+3px)] -translate-y-1/2 font-mono text-[15px] text-mute">$</span>
                  <input
                    id={`${ids}-sym`}
                    value={d.symbol}
                    maxLength={8}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => set("symbol", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                    placeholder="RAIN"
                    aria-invalid={Boolean(show("symbol"))}
                    aria-describedby={show("symbol") ? `${ids}-sym-err` : undefined}
                    className={`${inputCls} pl-6 font-mono uppercase`}
                  />
                </div>
              </Field>
            </div>

            <Field id={`${ids}-char`} label="Character name" hint={`${d.characterName.trim().length}/30`} error={show("characterName")}>
              <input id={`${ids}-char`} value={d.characterName} maxLength={30} onChange={(e) => set("characterName", e.target.value)} placeholder="Mika Tanaka" aria-invalid={Boolean(show("characterName"))} aria-describedby={show("characterName") ? `${ids}-char-err` : undefined} className={inputCls} />
            </Field>

            <Field id={`${ids}-look`} label="What they look like" hint={`${d.characterPrompt.trim().length}/400`} error={show("characterPrompt")}>
              <textarea
                id={`${ids}-look`}
                value={d.characterPrompt}
                maxLength={400}
                rows={3}
                onChange={(e) => set("characterPrompt", e.target.value)}
                placeholder="a tall courier with a shaved head, round sunglasses, a yellow rain poncho and a battered red messenger bag"
                aria-invalid={Boolean(show("characterPrompt"))}
                aria-describedby={show("characterPrompt") ? `${ids}-look-err` : `${ids}-look-hint`}
                className={`${inputCls} resize-none`}
              />
              <p id={`${ids}-look-hint`} className="mt-1 text-[12px] text-mute">Drawn into a character sheet, then reused in every episode so they stay on model.</p>
            </Field>

            <Field id={`${ids}-pitch`} label="The pitch" hint={`${d.pitch.trim().length}/600`} error={show("pitch")}>
              <textarea
                id={`${ids}-pitch`}
                value={d.pitch}
                maxLength={600}
                rows={3}
                onChange={(e) => set("pitch", e.target.value)}
                placeholder="A courier who only works the night shift delivers packages to people who don't exist yet."
                aria-invalid={Boolean(show("pitch"))}
                aria-describedby={show("pitch") ? `${ids}-pitch-err` : undefined}
                className={`${inputCls} resize-none`}
              />
            </Field>

            <Field id={`${ids}-genre`} label="Genre" hint="Optional">
              <select id={`${ids}-genre`} value={d.genre} onChange={(e) => set("genre", e.target.value as Genre | "")} className={`${inputCls} appearance-none`}>
                <option value="">Writer&rsquo;s choice</option>
                {GENRES.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Field>

            {!MAINNET && (
              <label htmlFor={`${ids}-demo`} className="flex cursor-pointer items-start gap-3 border border-rule bg-stock p-3.5">
                <input id={`${ids}-demo`} type="checkbox" checked={d.demo} onChange={(e) => set("demo", e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--kapow)]" />
                <span className="text-[13.5px] leading-snug">
                  <span className="font-semibold text-paper">Demo series (graduates at {DEMO_TARGET_USDC} USDC, 5-minute canon votes)</span>
                  <span className="mt-1 block text-[12.5px] text-mute">
                    So a whole run, from launch to canon to a Uniswap v4 pool, fits in an afternoon with test USDC. A normal series graduates at{" "}
                    {GRADUATION_TARGET_USDC.toLocaleString("en-US")} USDC and votes run for 24 hours. Only on {KOMA.label}; Arbitrum One has no demo series.
                  </span>
                </span>
              </label>
            )}

            {/* ——— What gets minted ——— */}
            <section id={`${ids}-note`} aria-label="What gets launched" className="border border-arb/30 bg-[#06111a] p-4 text-[13.5px] leading-relaxed text-soft">
              <h2 className="flex items-center gap-2 font-display text-[18px] uppercase tracking-wide text-arb">
                <ArbMark /> What you get, in one transaction
              </h2>
              <ul className="mt-3 flex flex-col gap-2">
                {[
                  ["Character NFT, minted to you", `with its own wallet (ERC-6551). The character earns: ${FEE_SPLIT.character}% of every trading fee lands in that wallet.`],
                  [`${TOTAL_SUPPLY.toLocaleString("en-US")} $${d.symbol || "COIN"}`, "95% on a USDC bonding curve (the price rises as people buy), 5% to you, vesting over 30 days."],
                  [`A ${TRADE_FEE_PCT}% fee on each trade`, `split ${FEE_SPLIT.character}% to the character's wallet, ${FEE_SPLIT.remix}% up the remix tree${parent ? ` (starting with ${parent.name})` : ""}, ${FEE_SPLIT.treasury}% to KOMA's treasury.`],
                  ["Canon by vote", `anyone holding ${CANON_THRESHOLD.toLocaleString("en-US")} coins (or you, as the character's owner) can propose episodes; holders vote for free.`],
                  ["Graduation", `at ${target.toLocaleString("en-US")} USDC raised the curve closes; KOMA takes ${GRADUATION_FEE_PCT}% of the USDC and the rest becomes a Uniswap v4 pool.`],
                ].map(([t, x]) => (
                  <li key={t} className="flex gap-2.5">
                    <IconCheck width={14} height={14} className="mt-1 shrink-0 text-arb" />
                    <span>
                      <span className="font-semibold text-paper">{t}</span> {x}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[12px] text-mute">{COIN_DISCLAIMER}</p>
            </section>

            <div>
              <button type="submit" disabled={down || Boolean(offline) || aiDown || state.stage === "quoting"} className="slant w-full py-4 text-[22px] sm:w-auto sm:px-10">
                {state.stage === "quoting" ? "Getting quote…" : `Pay ${LAUNCH_PRICE.toFixed(2)} USDC & launch`}
              </button>
              {down || offline || aiDown ? (
                <p className="mt-3 text-[12px] text-kapow">
                  {aiDown ? "Launching is paused while the AI artist is offline. No payment will be taken." : "Launching is offline on this server right now."}
                </p>
              ) : (
                <p className="mt-3 flex items-center gap-1.5 text-[12px] text-mute">
                  <ArbMark width={12} height={12} /> One signature in your wallet · no gas · about a minute to launch
                </p>
              )}
              {tried && !valid && <p role="alert" className="mt-2 text-[13px] text-kapow">Fix the fields marked above first.</p>}
            </div>
          </form>
        </div>

        {/* ——— Live preview: the user's own typed values, never sample data ——— */}
        <aside aria-label="Preview" className="md:pt-6">
          <div className="md:sticky md:top-24">
            <p className="mb-3 text-[12.5px] text-mute">Your card on the board, as you type. The sheet is drawn after you pay.</p>
            <SeriesCard s={preview} parentName={parent?.name} preview />
            {d.pitch.trim() && <p className="mt-3 line-clamp-4 font-letter text-[14px] leading-relaxed text-soft">&ldquo;{d.pitch.trim()}&rdquo;</p>}
          </div>
        </aside>
      </div>

      {arbitrum && <div className="mx-auto max-w-[1320px] px-4 pb-16 md:px-8">{arbitrum}</div>}

      <PaySheet state={state} onPay={pay} onCancel={cancel} copy={LAUNCH_COPY} />
    </>
  );
}

const STEPS: { key: LaunchState["stage"]; label: string }[] = [
  { key: "settling", label: "Payment settled on Arbitrum" },
  { key: "sheet", label: "Drawing your character sheet" },
  { key: "launching", label: "Launching on Arbitrum" },
];
const ORDER: LaunchState["stage"][] = ["signing", "settling", "sheet", "launching", "done"];

function status(step: LaunchState["stage"], s: LaunchState) {
  const now = s.stage === "error" ? (s.failedAt ?? "settling") : s.stage;
  const a = ORDER.indexOf(step);
  const b = ORDER.indexOf(now);
  if (s.stage === "error" && a === b) return "failed";
  return b > a ? "done" : b === a ? "active" : "todo";
}

const txLink = (hash: string, label: string) => (
  <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-arb hover:underline">{label}</a>
);

/** Paid → sheet → one launch transaction → the series page. */
function LaunchProgress({ state, onReset }: { state: LaunchState; onReset: () => void }) {
  const done = state.stage === "done";
  const [indexed, setIndexed] = useState(false);
  const r = state.request;

  // The series page reads the chain index, which trails the launch by a block or two.
  useEffect(() => {
    if (!done || !state.seriesId) return;
    let live = true;
    let tries = 0;
    const check = async () => {
      const ok = await fetch(`/api/series/${state.seriesId}`, { cache: "no-store" }).then((x) => x.ok).catch(() => false);
      if (!live) return;
      if (ok || ++tries > 20) setIndexed(true);
      else setTimeout(check, 1500);
    };
    void check();
    return () => {
      live = false;
    };
  }, [done, state.seriesId]);

  const detail = (k: LaunchState["stage"]) => {
    if (k === "settling") return state.paymentTx ? txLink(state.paymentTx, short(state.paymentTx, 8, 6)) : "Facilitator submitting the USDC transfer…";
    if (k === "sheet") return state.sheet ? "Drawn" : `${r?.characterName ?? "Your character"}, front, side and back…`;
    if (k === "launching")
      return state.launchTx ? txLink(state.launchTx, short(state.launchTx, 8, 6)) : "Character NFT and its wallet, coin, curve and vesting, in one transaction…";
  };

  return (
    <div className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-16 pt-6 md:grid-cols-[360px_1fr] md:gap-14 md:px-8 md:pt-10">
      <aside className="md:sticky md:top-24 md:self-start">
        <p className="text-[13px] text-mute">{done ? "Series launched" : state.stage === "error" ? "Something went wrong" : "Launching your series"}</p>
        <h1 className="masthead mt-1 break-words text-[16vw] text-kapow md:text-[88px]">{r?.name ?? (state.stage === "error" ? "Stopped" : "Launching…")}</h1>
        {r && (
          <p className="mt-3 text-[14px] text-soft">
            <span className="font-mono text-paper">${r.symbol}</span> · starring {r.characterName}
            {r.demo && <span className="text-mute"> · demo series</span>}
          </p>
        )}

        <ol className="mt-8 border-l-2 border-rule">
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
                {k !== "todo" && <p className="mt-0.5 text-[12.5px] text-mute">{detail(st.key)}</p>}
              </li>
            );
          })}
        </ol>

        {done && state.seriesId ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href={`/s/${state.seriesId}`} aria-disabled={!indexed} className={`slant h-12 px-7 text-[20px] ${indexed ? "" : "pointer-events-none opacity-70"}`}>
              {indexed ? `Open $${r?.symbol ?? "series"}` : "Indexing…"}
            </Link>
            <button onClick={onReset} className="flex h-12 items-center gap-2 px-2 font-display text-[16px] uppercase text-soft hover:text-paper">
              <IconPlus width={16} height={16} /> Launch another
            </button>
          </div>
        ) : state.stage === "error" ? (
          <div role="alert" className="mt-8 border border-[#ff3b3b]/60 bg-[#ff3b3b]/10 p-4 text-[13.5px] leading-relaxed text-soft">
            <p className="font-semibold text-paper">This launch stopped partway.</p>
            <p className="mt-1">{state.error}</p>
            {state.paymentTx && (
              <p className="mt-2 text-[12.5px]">
                Your payment is on-chain ({txLink(state.paymentTx, short(state.paymentTx, 8, 6))}). KOMA retries paid launches when it
                restarts; keep this link: launch <span className="font-mono">{state.jobId}</span>.
              </p>
            )}
            <button onClick={onReset} className="mt-3 font-display text-[15px] uppercase text-paper underline decoration-kapow underline-offset-4">
              Back to the form
            </button>
          </div>
        ) : (
          <p className="mt-8 flex items-center gap-2 text-[12.5px] text-mute">
            <ArbMark width={14} height={14} /> You can leave this page. The Character NFT lands in your wallet either way.
          </p>
        )}
      </aside>

      <section aria-label="Character sheet" aria-busy={!state.sheet} className="min-w-0">
        {state.sheet ? (
          <div className="relative" style={{ rotate: "-0.6deg" }}>
            <span className="tape -top-3 left-10 rotate-[-5deg]" />
            <div className="relative aspect-[16/9] overflow-hidden shadow-[0_30px_50px_-15px_rgba(0,0,0,0.85)]">
              <Image src={state.sheet} alt={`Character sheet of ${r?.characterName ?? "your character"}`} fill priority sizes="(min-width: 768px) 60vw, 100vw" className="object-cover" />
            </div>
          </div>
        ) : (
          <div className="comic-sheet grid aspect-[16/9] place-items-center">
            <div className="text-center">
              <div className="halftone mx-auto h-24 w-24 animate-ink rounded-full text-[#0d0d0d]/40" />
              <p className="mt-4 font-letter text-[14px] uppercase text-[#0d0d0d]/70">
                {state.stage === "sheet" ? "Drawing the character sheet…" : state.stage === "error" ? "No sheet" : "Waiting on the payment…"}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
