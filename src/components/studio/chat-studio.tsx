"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Comic, Genre, Pitch } from "@/lib/types";
import { ComicPage } from "../comic-page";
import { ShareButton } from "../share-button";
import { IconArrow, IconBook, IconPen, IconRemix } from "../icons";
import { PaySheet } from "./pay-sheet";
import { PitchCard } from "./pitch-card";
import { Steps } from "./progress";
import { useGeneration } from "./use-generation";
import { EpisodeBanner, type EpisodeSeries } from "../launchpad/episode-banner";
import { priceFor } from "@/lib/order";
import { AI_DOWN_NOTE, useServerStatus } from "../use-server-status";

type Msg = { role: "user" | "assistant"; content: string; pitched?: string };
type Saved = { messages: Msg[]; pitch: Pitch | null; jobId?: string; genre?: Genre };

const STARTERS = [
  "A heist where the vault starts talking back",
  "My grandma is secretly a retired superhero",
  "A kaiju just wants to finish lunch",
  "Two rival racers forced to share one car",
];

const RUNNING = ["settling", "writing", "drawing", "lettering", "minting", "done", "error"];

function greeting(remix?: Comic, genre?: Genre, series?: EpisodeSeries): Msg {
  // The greeting goes to the editor with the thread, so it also tells the editor what this issue is for.
  if (series) {
    return {
      role: "assistant",
      content: `This one's an episode proposal for the series “${series.name}”, starring ${series.characterName}. What happens to ${series.characterName} in this episode?`,
    };
  }
  if (remix) return { role: "assistant", content: `Remixing “${remix.title}”. Same world, new story: what happens this time?` };
  return {
    role: "assistant",
    content: genre
      ? `Let's make a ${genre.toLowerCase()} comic. What's it about? A premise, a character, a vibe, anything works.`
      : "Hey, I'm your editor. What's your comic about? A premise, a character, a vibe, anything works.",
  };
}

const storageKey = (remix?: Comic, series?: EpisodeSeries) => (series ? `koma-studio:series:${series.id}` : `koma-studio:${remix?.id ?? "new"}`);
// A paid conversation is also filed under its job, since /create?job=… carries no remix or genre.
const jobKey = (jobId: string) => `koma-studio:job:${jobId}`;

function load(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: Saved | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* storage unavailable: the chat just won't survive a reload */
  }
}

/** Talk the story through with the editor, then pay for the pitch and watch it get drawn. */
export function ChatStudio({ remix, job, genre, series }: { remix?: Comic; job?: string; genre?: Genre; series?: EpisodeSeries }) {
  const key = storageKey(remix, series);
  // Rendered client-only (see chat-studio-client), so saved chats can seed state directly.
  const [saved] = useState(() => {
    // ?job= resumes the chat that paid for it.
    if (job) return load(jobKey(job));
    const s = load(key);
    if (!s) return null;
    // Otherwise only an unpaid draft you actually wrote in, started for the same genre link.
    const wrote = s.messages.some((m) => m.role === "user");
    return !s.jobId && wrote && s.genre === genre ? s : null;
  });
  const [messages, setMessages] = useState<Msg[]>(() => saved?.messages ?? [greeting(remix, genre, series)]);
  const [pitch, setPitch] = useState<Pitch | null>(() => saved?.pitch ?? null);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const { offline, aiDown } = useServerStatus();
  const { state, requestQuote, pay, cancel, resume } = useGeneration();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Pick a running issue back up, and check the server can take payments.
  useEffect(() => {
    if (job) resume(job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const snapshot = { messages, pitch, jobId: state.jobId, genre };
    save(key, snapshot);
    if (state.jobId) save(jobKey(state.jobId), snapshot);
  }, [key, messages, pitch, state.jobId, genre]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, thinking, state.stage, state.drawn]);

  const running = RUNNING.includes(state.stage);

  async function send(text: string) {
    if (aiDown) return;
    const content = text.trim();
    if (!content || thinking || running) return;
    const next: Msg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    setThinking(true);
    setChatError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), pitch, remixOf: remix?.id, genre }),
      });
      const body = (await res.json().catch(() => ({}))) as { reply?: string; pitch?: Pitch | null; error?: string };
      if (!res.ok || !body.reply) throw new Error(body.error ?? `The editor didn't answer (${res.status}).`);
      setMessages((m) => [...m, { role: "assistant", content: body.reply!, pitched: body.pitch?.title }]);
      // An episode is priced as one (the editor doesn't know it's writing for a series).
      if (body.pitch) setPitch(series ? { ...body.pitch, seriesId: series.id, remixOf: undefined, price: priceFor(body.pitch.pages, true) } : body.pitch);
    } catch (e) {
      setChatError((e as Error).message);
      setMessages(next.slice(0, -1));
      setDraft(content);
    } finally {
      setThinking(false);
      inputRef.current?.focus();
    }
  }

  const startOver = () => {
    cancel();
    save(key, null);
    setMessages([greeting(remix, genre, series)]);
    setPitch(null);
    setChatError(null);
  };

  const payForPitch = () => pitch && requestQuote(series ? { ...pitch, remixOf: undefined, seriesId: series.id } : pitch);
  const done = state.stage === "done";

  const card = pitch && (
    <PitchCard pitch={pitch} onChange={setPitch} onPay={payForPitch} busy={state.stage === "quoting"} locked={running || !!offline || aiDown} episodeOf={series?.name} />
  );

  return (
    <>
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-32 pt-6 md:grid-cols-[1fr_380px] md:gap-12 md:px-8 md:pb-24 md:pt-10">
        <div className="min-w-0">
          <div className="flex items-end justify-between gap-4">
            <h1 className="masthead text-[20vw] text-kapow md:text-[clamp(96px,9vw,132px)]">Studio</h1>
            <div className="flex shrink-0 items-center gap-4 pb-2 text-[13px]">
              {messages.length > 1 && !running && (
                <button onClick={startOver} className="text-mute hover:text-paper">Start over</button>
              )}
              <Link href={series ? `/create/form?series=${series.id}` : remix ? `/create/form?remix=${remix.id}` : genre ? `/create/form?genre=${genre}` : "/create/form"} className="text-mute hover:text-paper">
                Prefer a form?
              </Link>
            </div>
          </div>

          {aiDown && (
            <p role="status" className="mt-5 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              {AI_DOWN_NOTE}
            </p>
          )}
          {offline && (
            <p role="status" className="mt-5 border border-kapow/60 bg-kapow/10 px-4 py-3 text-[13.5px] leading-relaxed text-soft">
              <span className="font-semibold text-paper">The studio is offline.</span> This server hasn&rsquo;t been given {offline} yet,
              so it can&rsquo;t take payments. Reading is unaffected.
            </p>
          )}

          {series && <EpisodeBanner series={series} />}

          {remix && (
            <div className="mt-5 flex items-center gap-3 border border-rule bg-stock p-2.5 pr-4">
              <div className="relative h-14 w-11 shrink-0 overflow-hidden">
                <Image src={remix.cover} alt="" fill sizes="44px" className="object-cover" />
              </div>
              <p className="min-w-0 text-[13px] leading-snug text-soft">
                <span className="flex items-center gap-1.5 font-semibold text-paper">
                  <IconRemix width={14} height={14} /> Remixing {remix.title}
                </span>
                The new issue links back to it on-chain.
              </p>
            </div>
          )}

          {/* ——— Thread ——— */}
          <ol className="mt-6 flex flex-col gap-4" aria-live="polite" aria-label="Conversation with the editor">
            {messages.map((m, i) =>
              m.role === "assistant" ? (
                <li key={i} className="flex max-w-[640px] gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center bg-kapow font-display text-[16px] text-ink" aria-hidden>K</span>
                  <div className="min-w-0">
                    <p className="text-[11.5px] text-mute">Editor</p>
                    <p className="mt-0.5 text-[15.5px] leading-relaxed text-paper">{m.content}</p>
                    {m.pitched && (
                      <p className="mt-2 inline-flex items-center gap-1.5 border border-rule px-2 py-1 text-[12px] text-soft">
                        <IconPen width={12} height={12} /> Pitch: {m.pitched}
                      </p>
                    )}
                  </div>
                </li>
              ) : (
                <li key={i} className="ml-auto max-w-[560px] bg-paper px-4 py-2.5 text-[15px] leading-relaxed text-ink">
                  {m.content}
                </li>
              ),
            )}
            {thinking && (
              <li className="flex gap-3" aria-label="Editor is typing">
                <span className="grid h-8 w-8 shrink-0 place-items-center bg-kapow font-display text-[16px] text-ink" aria-hidden>K</span>
                <span className="flex items-center gap-1 pt-3">
                  {[0, 1, 2].map((d) => (
                    <i key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-soft" style={{ animationDelay: `${d * 160}ms` }} />
                  ))}
                </span>
              </li>
            )}
          </ol>

          {chatError && (
            <p role="alert" className="mt-4 border border-[#ff3b3b]/60 bg-[#ff3b3b]/10 px-3 py-2.5 text-[13px] text-paper">
              {chatError}
            </p>
          )}

          {messages.length === 1 && !running && (
            <div className="mt-5 flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} onClick={() => send(s)} disabled={aiDown} className="border border-rule px-3 py-1.5 text-[13px] text-soft hover:border-paper hover:text-paper disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Pitch inline on phones */}
          {card && !running && <div className="mt-6 md:hidden">{card}</div>}

          {/* ——— The issue being made, in the thread ——— */}
          {running && (
            <section aria-label="Your issue" aria-busy={!done} className="mt-8 border-t border-rule pt-6">
              <div className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center bg-kapow font-display text-[16px] text-ink" aria-hidden>K</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-mute">Editor</p>
                  <p className="mt-0.5 text-[15.5px] leading-relaxed text-paper">
                    {done
                      ? `“${state.script?.title}” is done and minted to your wallet.`
                      : state.stage === "error"
                        ? "Something went wrong while making this one."
                        : "Paid. The artists are on it, and you'll see each panel the moment it's inked."}
                  </p>
                  <Steps state={state} className="mt-5" />
                  {state.stage === "error" && <p className="mt-4 text-[13.5px] text-soft">{state.error}</p>}
                  {done && (
                    <div className="mt-6 flex flex-wrap gap-3">
                      <Link href={`/c/${state.jobId}/read`} className="slant h-12 px-7 text-[20px]">
                        <IconBook width={18} height={18} /> Read it
                      </Link>
                      <ShareButton title={state.script?.title ?? "My comic"} path={`/c/${state.jobId}`} />
                      {series && (
                        <Link href={`/s/${series.id}`} className="flex h-12 items-center border-2 border-paper/80 px-4 font-display text-[16px] uppercase text-paper hover:bg-paper hover:text-ink">
                          Vote on {series.name}
                        </Link>
                      )}
                      <button onClick={startOver} className="flex h-12 items-center gap-2 px-2 font-display text-[16px] uppercase text-soft hover:text-paper">
                        <IconPen width={16} height={16} /> Make another
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {state.pages.length > 0 && (
                <div className="mt-8 flex flex-col gap-6">
                  {state.pages.map((p, i) => (
                    <ComicPage key={i} page={p} number={i + 1} />
                  ))}
                </div>
              )}
            </section>
          )}
          <div ref={endRef} />
        </div>

        {/* Pitch beside the thread on desktop */}
        <aside className="hidden md:block">
          <div className="sticky top-24">
            {card ?? (
              <div className="border border-dashed border-rule p-5 text-[13.5px] leading-relaxed text-mute">
                Your pitch shows up here once the editor has enough to go on: title, story, style, cast, pages and price. Tweak
                it by talking, then pay from here.
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* ——— Composer ——— */}
      {!running && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
          className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-ink/95 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-md"
        >
          <div className="mx-auto flex max-w-[1320px] items-end gap-3 md:px-4">
            <label htmlFor="say" className="sr-only">Message the editor</label>
            <textarea
              id="say"
              ref={inputRef}
              value={draft}
              rows={1}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
              disabled={aiDown}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !aiDown) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder={aiDown ? "The editor is offline right now" : pitch ? "Ask for changes…" : "Tell the editor your idea…"}
              className="max-h-40 min-h-12 flex-1 resize-none border border-rule bg-stock px-4 py-3 text-[15.5px] text-paper placeholder:text-mute focus:border-soft focus:outline-none md:max-w-[calc(100%-420px)]"
            />
            <button type="submit" disabled={!draft.trim() || thinking || aiDown} aria-label="Send" className="slant h-12 w-14 shrink-0">
              <IconArrow width={20} height={20} />
            </button>
          </div>
        </form>
      )}

      <PaySheet state={state} onPay={pay} onCancel={cancel} />
    </>
  );
}
