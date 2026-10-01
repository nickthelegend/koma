import { GENRES, cast as roster, styles } from "@/lib/studio-config";
import { parseOrder, priceFor } from "@/lib/order";
import type { Comic, Genre, Pitch } from "@/lib/types";
import { llm } from "./ai";
import { estimate } from "./budget";

export type ChatMessage = { role: "user" | "assistant"; content: string };

const SYSTEM = `You are the editor at KOMA, a studio that turns one person's idea into a short, fully drawn comic. You're talking with the person who will pay for it. Help them shape the story, then hand the artists a pitch.

Voice: warm, quick, a little playful, like a good comics editor. Replies are 1 to 3 short sentences. Ask at most one question at a time. No lists, no markdown.

Get to a pitch fast. If the first message already has a premise, pitch right away and offer one idea to make it better. Otherwise ask one question, then pitch. When they ask for changes, send the whole updated pitch.

Answer with strict JSON only, no code fences:
{"reply": string, "pitch": null | {
  "title": string (2-24 chars, punchy),
  "synopsis": string (40-450 chars: setup, conflict, the ending beat; this is what the writer gets),
  "genre": one of ${JSON.stringify(GENRES)},
  "style": one of ${JSON.stringify(styles.map((s) => s.id))} (${styles.map((s) => `${s.id} = ${s.label}`).join("; ")}),
  "pages": 1 | 2 | 4 | 6 (default 2 unless they ask; each page is 4 panels, $0.10 a page, or $0.30 a page for a series episode),
  "cast": ids from this roster, only if they fit or were asked for: ${roster.map((c) => `${c.id} = ${c.name}, ${c.role}`).join("; ")},
  "custom": [{"name": string, "look": string (10-200 chars, concrete visual description: build, hair, clothes, one signature detail)}]
}}
At most two leads in total across cast and custom. Characters the person describes go in custom. No real people, brands, sexual content or gore; steer away kindly if asked.`;

function transcript(messages: ChatMessage[], current: Pitch | null, remix: Comic | null, genre?: Genre) {
  const lines = messages.map((m) => `${m.role === "user" ? "PERSON" : "EDITOR"}: ${m.content}`);
  return [
    genre && !current ? `They want a ${genre} comic: pitch it in that genre.` : "",
    remix ? `This is a remix of "${remix.title}" (${remix.genre}, ${remix.style}): ${remix.logline}` : "",
    current ? `CURRENT PITCH: ${JSON.stringify({ title: current.title, synopsis: current.prompt, genre: current.genre, style: current.style, pages: current.pages, cast: current.cast, custom: current.custom ?? [] })}` : "",
    ...lines,
    "EDITOR (JSON):",
  ]
    .filter(Boolean)
    .join("\n");
}

function toPitch(raw: unknown, remixOf?: string): Pitch | { error: string } {
  const p = (raw ?? {}) as Record<string, unknown>;
  const parsed = parseOrder({ prompt: p.synopsis, title: p.title, genre: p.genre, style: p.style, pages: p.pages, cast: p.cast, custom: p.custom, remixOf });
  if ("error" in parsed) return parsed;
  return { ...parsed.order, title: parsed.order.title ?? "Untitled", price: priceFor(parsed.order.pages, Boolean(parsed.order.seriesId)) };
}

/** One editor turn: a reply, and a pitch that is already a valid paid order. */
export async function editorTurn(messages: ChatMessage[], current: Pitch | null, remix: Comic | null, genre?: Genre) {
  let prompt = transcript(messages, current, remix, genre);
  for (let attempt = 0; attempt < 3; attempt++) {
    let output: string;
    try {
      output = await llm({ system: SYSTEM, prompt, estimateUsd: estimate.llm("chat"), maxTokens: 1_500, timeoutMs: 60_000 });
    } catch {
      continue;
    }
    try {
      const json = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
      const reply = String(json.reply ?? "").trim().slice(0, 600);
      if (!reply) throw new Error("empty reply");
      if (!json.pitch) return { reply, pitch: null };
      const pitch = toPitch(json.pitch, remix?.id);
      if ("error" in pitch) {
        prompt += `\n(Your pitch was rejected: ${pitch.error} Fix it and answer again.)\nEDITOR (JSON):`;
        continue;
      }
      return { reply, pitch };
    } catch {
      /* malformed; try again */
    }
  }
  throw new Error("The editor lost their train of thought. Try that again.");
}
