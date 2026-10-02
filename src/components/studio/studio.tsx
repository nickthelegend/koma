"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { GENRES, cast as roster, styles } from "@/lib/studio-config";
import { EPISODE_PRICE_PER_PAGE, PRICE_PER_PAGE } from "@/lib/network";
import type { Comic, CustomCharacter, Genre } from "@/lib/types";
import { Receipt } from "./receipt";
import { PaySheet } from "./pay-sheet";
import { Progress } from "./progress";
import { useGeneration } from "./use-generation";
import { ArbMark, IconBolt, IconCheck, IconPlus, IconRemix } from "../icons";
import { EpisodeBanner, type EpisodeSeries } from "../launchpad/episode-banner";
import { AI_DOWN_NOTE, useServerStatus } from "../use-server-status";

const STARTERS = [
  { label: "Heist gone wrong", text: "Four broke crooks plan a vault job that goes sideways when the vault starts talking back." },
  { label: "Rivals to allies", text: "Two rival street racers are forced to share one car to outrun a storm that eats cities." },
  { label: "Monster of the week", text: "A tired kaiju just wants to finish lunch before the city's mechs show up." },
  { label: "Origin story", text: "A night-shift janitor at a physics lab wakes up able to pause everything except herself." },
  { label: "Noir mystery", text: "A detective follows a trail of burner wallets to a man who died last Tuesday." },
];

const PAGE_OPTIONS = [1, 2, 4, 6];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[20px] uppercase tracking-wide text-paper">{title}</h2>
        {hint && <p className="text-[12px] text-mute">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function Studio({ remix, job, genre: initialGenre, series }: { remix?: Comic; job?: string; genre?: Genre; series?: EpisodeSeries }) {
  const [prompt, setPrompt] = useState(remix ? `${remix.logline} ` : "");
  const [style, setStyle] = useState(remix ? styles.find((s) => s.label === remix.style)?.id ?? styles[0].id : styles[0].id);
  const [cast, setCast] = useState<string[]>([]);
  const [custom, setCustom] = useState<CustomCharacter[]>([]);
  const [designing, setDesigning] = useState(false);
  const [draft, setDraft] = useState<CustomCharacter>({ name: "", look: "" });
  const [genre, setGenre] = useState<Genre | undefined>(initialGenre ?? remix?.genre);
  const [pages, setPages] = useState(remix?.pageCount ?? 2);
  const { state, requestQuote, pay, cancel, resume } = useGeneration();
  const { offline, aiDown } = useServerStatus();

  useEffect(() => {
    if (job) resume(job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styleLabel = styles.find((s) => s.id === style)!.label;
  const perPage = series ? EPISODE_PRICE_PER_PAGE : PRICE_PER_PAGE;
  const total = (pages * perPage).toFixed(2);
  const ready = prompt.trim().length >= 12 && state.stage !== "quoting" && !aiDown && !offline;
  const order = () => ({ prompt, style, cast, custom, genre, pages, remixOf: series ? undefined : remix?.id, seriesId: series?.id });
  const picked = cast.length + custom.length;
  const draftOk = draft.name.trim().length >= 2 && draft.name.trim().length <= 30 && draft.look.trim().length >= 10 && draft.look.trim().length <= 200;

  if (!["idle", "quoting", "quote", "signing"].includes(state.stage)) {
    return <Progress state={state} onReset={cancel} />;
  }

  // Two leads at most, counting designed characters; picking a third drops the oldest ready-made one.
  const toggleCast = (id: string) =>
    setCast((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      const room = 2 - custom.length;
      return room > 0 ? [...c, id].slice(-room) : c;
    });
  const addCustom = () => {
    if (!draftOk || picked >= 2) return;
    setCustom((c) => [...c, { name: draft.name.trim(), look: draft.look.trim() }]);
    setDraft({ name: "", look: "" });
    setDesigning(false);
  };

  return (
    <>
      <div className="mx-auto grid max-w-[1320px] gap-10 px-4 pb-40 pt-6 md:grid-cols-[1fr_340px] md:gap-16 md:px-8 md:pb-20 md:pt-10">
        <div className="min-w-0">
          <h1 className="masthead text-[23vw] text-kapow md:text-[clamp(120px,12vw,172px)]">{series ? "New episode" : "New issue"}</h1>

          {series && <EpisodeBanner series={series} />}

          {aiDown && (
            <p role="status" className="mt-6 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              {AI_DOWN_NOTE}
            </p>
          )}
          {offline && (
            <p role="status" className="mt-6 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              <span className="font-semibold text-paper">The studio is offline.</span> This server hasn&rsquo;t been given {offline} yet,
              so it can&rsquo;t take payments. Reading is unaffected.
            </p>
          )}

          {remix && (
            <div className="mt-6 flex items-center gap-3 border border-rule bg-stock p-2.5 pr-4">
              <div className="relative h-14 w-11 shrink-0 overflow-hidden">
                <Image src={remix.cover} alt="" fill sizes="44px" className="object-cover" />
              </div>
              <p className="min-w-0 text-[13px] leading-snug text-soft">
                <span className="flex items-center gap-1.5 font-semibold text-paper">
                  <IconRemix width={14} height={14} /> Remixing {remix.title}
                </span>
                Same world, your story. {remix.creator.name} is credited on the new issue.
              </p>
            </div>
          )}

          {/* ——— Story ——— */}
          <div className="mt-6 border border-rule bg-stock focus-within:border-soft">
            <label htmlFor="story" className="sr-only">What happens in your comic?</label>
            <textarea
              id="story"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              maxLength={600}
              placeholder="What happens in your comic? Who is it about, where are they, and what goes wrong?"
              className="block w-full resize-none bg-transparent px-4 pb-2 pt-4 text-[17px] leading-relaxed text-paper placeholder:text-mute focus:outline-none md:text-[19px]"
            />
            <div className="flex items-center justify-between gap-3 px-4 pb-3">
              <div className="no-scrollbar -ml-1 flex gap-1.5 overflow-x-auto">
                {STARTERS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => setPrompt(s.text)}
                    className="shrink-0 border border-rule px-2.5 py-1 text-[12.5px] text-soft hover:border-paper hover:text-paper"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="shrink-0 font-mono text-[11px] text-mute">{prompt.length}/600</span>
            </div>
          </div>

          {/* ——— Style ——— */}
          <Section title="Art style" hint={styleLabel}>
            <div role="radiogroup" aria-label="Art style" className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-6 md:px-0">
              {styles.map((s) => {
                const on = s.id === style;
                return (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setStyle(s.id)}
                    className="group w-[108px] shrink-0 text-left md:w-auto"
                  >
                    <div className={`relative aspect-[3/4] overflow-hidden outline outline-2 outline-offset-2 ${on ? "outline-kapow" : "outline-transparent"}`}>
                      <Image src={s.thumb} alt="" fill sizes="130px" className={`object-cover transition-[filter] ${on ? "" : "grayscale-[0.6] group-hover:grayscale-0"}`} />
                      {on && (
                        <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center bg-kapow text-ink">
                          <IconCheck width={12} height={12} strokeWidth={3} />
                        </span>
                      )}
                    </div>
                    <p className={`mt-2 text-[12.5px] font-semibold ${on ? "text-paper" : "text-mute"}`}>{s.label}</p>
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ——— Cast ——— */}
          <Section title="Cast" hint={picked ? `${picked} of 2 picked` : "Pick up to two, or let the writer invent them"}>
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              <button
                onClick={() => {
                  setCast([]);
                  setCustom([]);
                }}
                aria-pressed={picked === 0}
                className="flex w-[76px] shrink-0 flex-col items-center gap-2"
              >
                <span className={`grid h-[68px] w-[68px] place-items-center rounded-full border-2 border-dashed ${picked === 0 ? "border-kapow text-kapow" : "border-rule text-mute"}`}>
                  <IconBolt width={22} height={22} />
                </span>
                <span className={`text-center text-[12px] leading-tight ${picked === 0 ? "text-paper" : "text-mute"}`}>Invent them</span>
              </button>
              {roster.map((c) => {
                const on = cast.includes(c.id);
                return (
                  <button key={c.id} onClick={() => toggleCast(c.id)} aria-pressed={on} className="flex w-[76px] shrink-0 flex-col items-center gap-2">
                    <span className={`relative h-[68px] w-[68px] overflow-hidden rounded-full ring-2 ring-offset-2 ring-offset-ink ${on ? "ring-kapow" : "ring-transparent"}`}>
                      <Image src={c.img} alt="" fill sizes="68px" className={`object-cover ${on ? "" : "opacity-70"}`} />
                    </span>
                    <span className={`text-center text-[12px] leading-tight ${on ? "text-paper" : "text-mute"}`}>{c.name}</span>
                  </button>
                );
              })}
              {custom.map((c, i) => (
                <button
                  key={`${c.name}-${i}`}
                  onClick={() => setCustom((all) => all.filter((_, j) => j !== i))}
                  aria-label={`Remove ${c.name}`}
                  title={c.look}
                  className="flex w-[76px] shrink-0 flex-col items-center gap-2"
                >
                  <span className="grid h-[68px] w-[68px] place-items-center rounded-full bg-kapow font-display text-[26px] text-ink ring-2 ring-kapow ring-offset-2 ring-offset-ink">
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="text-center text-[12px] leading-tight text-paper">{c.name}</span>
                </button>
              ))}
              <button
                onClick={() => setDesigning((d) => !d)}
                disabled={picked >= 2}
                aria-expanded={designing}
                title={picked >= 2 ? "Two leads already picked" : "Design your own character"}
                className="flex w-[76px] shrink-0 flex-col items-center gap-2 disabled:opacity-40"
              >
                <span className={`grid h-[68px] w-[68px] place-items-center rounded-full border-2 ${designing ? "border-kapow text-kapow" : "border-rule text-mute"}`}>
                  <IconPlus />
                </span>
                <span className="text-center text-[12px] leading-tight text-mute">Design one</span>
              </button>
            </div>
            {designing && (
              <div className="mt-4 border border-rule bg-stock p-4">
                <label className="block text-[12.5px] text-mute" htmlFor="cname">Name</label>
                <input
                  id="cname"
                  value={draft.name}
                  maxLength={30}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Mika Tanaka"
                  className="mt-1 w-full border border-rule bg-ink px-3 py-2 text-[15px] text-paper placeholder:text-mute focus:border-soft focus:outline-none"
                />
                <label className="mt-3 block text-[12.5px] text-mute" htmlFor="clook">What they look like</label>
                <textarea
                  id="clook"
                  value={draft.look}
                  maxLength={200}
                  rows={2}
                  onChange={(e) => setDraft((d) => ({ ...d, look: e.target.value }))}
                  placeholder="a tall courier with a shaved head, round sunglasses and a yellow rain poncho"
                  className="mt-1 w-full resize-none border border-rule bg-ink px-3 py-2 text-[15px] text-paper placeholder:text-mute focus:border-soft focus:outline-none"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[12px] text-mute">Repeated word for word in every panel so they stay on model.</p>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => setDesigning(false)} className="h-9 px-3 text-[13px] text-soft hover:text-paper">Cancel</button>
                    <button onClick={addCustom} disabled={!draftOk} className="h-9 bg-paper px-4 text-[13px] font-semibold text-ink disabled:opacity-40">
                      Add to cast
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Section>

          {/* ——— Genre ——— */}
          <Section title="Genre" hint={genre ?? "Writer's choice"}>
            <div role="radiogroup" aria-label="Genre" className="flex flex-wrap gap-2">
              {[undefined, ...GENRES].map((g) => {
                const on = g === genre;
                return (
                  <button
                    key={g ?? "any"}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setGenre(g)}
                    className={`border px-3 py-1.5 font-display text-[14px] uppercase tracking-wide ${on ? "border-paper bg-paper text-ink" : "border-rule text-soft hover:border-paper hover:text-paper"}`}
                  >
                    {g ?? "Writer's choice"}
                  </button>
                );
              })}
            </div>
          </Section>

          {/* ——— Length ——— */}
          <Section title="Length" hint="Four panels a page">
            <div role="radiogroup" aria-label="Pages" className="grid grid-cols-4 border border-rule">
              {PAGE_OPTIONS.map((n) => {
                const on = n === pages;
                return (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPages(n)}
                    className={`border-l border-rule py-3 first:border-l-0 ${on ? "bg-paper text-ink" : "text-soft hover:bg-stock-2"}`}
                  >
                    <span className="block font-display text-[26px] leading-none">{n}</span>
                    <span className={`mt-1 block text-[11.5px] ${on ? "text-ink/70" : "text-mute"}`}>
                      {n === 1 ? "page" : "pages"} · ${(n * perPage).toFixed(2)}
                    </span>
                  </button>
                );
              })}
            </div>
          </Section>
        </div>

        {/* ——— Desktop quote column ——— */}
        <aside className="hidden md:block">
          <div className="sticky top-24">
            <div className="rotate-[1.2deg]">
              <Receipt pages={pages} style={styleLabel} castCount={picked} perPage={perPage} />
            </div>
            <button
              onClick={() => requestQuote(order())}
              disabled={!ready}
              className="slant mt-8 w-full py-4 text-[22px]"
            >
              {state.stage === "quoting" ? "Getting quote…" : <>Pay {total} USDC &amp; draw</>}
            </button>
            <p className="mt-3 text-center text-[12px] text-mute">
              {aiDown
                ? "Drawing is paused while the AI artist is offline. No payment will be taken."
                : offline
                  ? "This server can\u2019t take payments right now."
                  : prompt.trim().length >= 12
                    ? "About a minute from payment to finished issue."
                    : "Write at least a sentence to continue."}
            </p>
          </div>
        </aside>
      </div>

      {/* ——— Phone action bar ——— */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-ink/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-md md:hidden">
        <div className="flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-display text-[24px] leading-none">{total} USDC</p>
            <p className="mt-1 flex items-center gap-1 text-[11.5px] text-mute">
              <ArbMark width={12} height={12} /> {pages} {pages === 1 ? "page" : "pages"} · {aiDown ? "artist offline" : "no gas"}
            </p>
          </div>
          <button onClick={() => requestQuote(order())} disabled={!ready} className="slant h-12 px-6 text-[19px]">
            {state.stage === "quoting" ? "Quoting…" : <>Pay &amp; draw</>}
          </button>
        </div>
      </div>

      <PaySheet state={state} onPay={pay} onCancel={cancel} />
    </>
  );
}
