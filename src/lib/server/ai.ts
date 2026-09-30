import type { BalloonKind, Genre } from "@/lib/types";
import { estimate, recordSpend } from "./budget";
import { config } from "./config";
import { markFalDown } from "./fal-health";

const GENRES: Genre[] = ["Manga", "Superhero", "Noir", "Sci-fi", "Horror", "Comedy", "Fantasy"];
const KINDS: BalloonKind[] = ["speech", "thought", "caption", "sfx"];
export const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
export type Corner = (typeof CORNERS)[number];

export type ScriptBalloon = { kind: BalloonKind; text: string; at: Corner };
export type ScriptPanel = { shot: string; alt: string; balloons: ScriptBalloon[] };
export type Script = {
  title: string;
  logline: string;
  genre: Genre;
  cover: string;
  pages: { panels: ScriptPanel[] }[];
};

export async function fal<T>(endpoint: string, input: unknown, timeoutMs = 120_000): Promise<T> {
  const res = await fetch(`https://fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 240);
    if (res.status === 401 || res.status === 403) markFalDown(text);
    throw new Error(`${endpoint} ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ——— LLM ———
// fal-ai/any-llm is deprecated; openrouter/router takes the same prompt/system_prompt
// and answers { output, reasoning?, partial, error?, usage: { prompt_tokens, completion_tokens, total_tokens, cost } }.
export const LLM_ENDPOINT = "openrouter/router";
type LlmOut = { output: string; error?: string | null; usage?: { cost?: number | null } | null };

/** One LLM call on fal. Records its real cost (usage.cost) or, failing that, `estimateUsd`. */
export async function llm(o: { prompt: string; system?: string; estimateUsd: number; maxTokens?: number; timeoutMs?: number }) {
  const r = await fal<LlmOut>(
    LLM_ENDPOINT,
    { model: config.llmModel, prompt: o.prompt, ...(o.system ? { system_prompt: o.system } : {}), ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}) },
    o.timeoutMs,
  );
  recordSpend("llm", r.usage?.cost ?? o.estimateUsd);
  if (r.error) throw new Error(r.error);
  if (!r.output) throw new Error("empty LLM output");
  return r.output;
}

// ——— Script ———
function brief(o: { prompt: string; title?: string; pages: number; style: string; genre?: Genre; cast: { name: string; look: string }[]; remix?: { title: string; logline: string } }) {
  return `You are the writer and layout artist for a short comic. Write it as strict JSON only, no prose, no code fences.

STORY IDEA: ${o.prompt}
${o.remix ? `This is a remix of the comic "${o.remix.title}" (${o.remix.logline}). Keep its world and tone, tell a new story.\n` : ""}${o.title ? `TITLE: "${o.title}" (use exactly this title)\n` : ""}ART STYLE: ${o.style}
${o.genre ? `GENRE: ${o.genre}. Write it squarely in this genre.\n` : ""}
PAGES: exactly ${o.pages}. Each page has exactly 4 panels in a 1-2-1 layout: panel 1 is a wide establishing shot, panels 2 and 3 are square beats, panel 4 is a wide reveal or cliffhanger. The story must land on the last panel.
${o.cast.length ? `CAST (use them as the leads): ${o.cast.map((c) => `${c.name}: ${c.look}`).join("; ")}` : "Invent up to two memorable leads with distinct looks."}

JSON shape:
{"title": string (max 24 chars, punchy),
 "logline": string (one sentence, max 110 chars),
 "genre": one of ${JSON.stringify(GENRES)},
 "cover": string (image prompt for the cover art),
 "pages": [{"panels": [{"shot": string, "alt": string, "balloons": [{"kind": one of ${JSON.stringify(KINDS)}, "text": string, "at": one of ${JSON.stringify(CORNERS)}}]}]}]}

Rules:
- "shot" is an image-generation prompt: camera framing, action, setting, lighting. Every shot that shows a character must repeat that character's full visual description word for word, so they look the same in every panel. Never ask for text, letters, signs with writing, logos or speech bubbles in the image.
- "alt" describes the panel for screen readers in one plain sentence.
- 0 to 2 balloons per panel. Speech and thought max 70 characters, captions max 80, sfx one or two words max 10 characters. Put balloons in corners where the shot leaves room (usually top). Keep it funny or tense, never generic.
- No real people, no brands, nothing sexual, no gore.`;
}

function clean(s: unknown, max: number) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseScript(raw: string, pages: number): Script {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const d = JSON.parse(json);
  if (!Array.isArray(d.pages) || d.pages.length < pages) throw new Error("script has too few pages");
  return {
    title: clean(d.title, 28) || "Untitled",
    logline: clean(d.logline, 140),
    genre: GENRES.includes(d.genre) ? d.genre : "Manga",
    cover: clean(d.cover, 900),
    pages: d.pages.slice(0, pages).map((p: { panels: unknown[] }) => {
      if (!Array.isArray(p.panels) || p.panels.length < 4) throw new Error("page has too few panels");
      return {
        panels: p.panels.slice(0, 4).map((raw) => {
          const pn = raw as Record<string, unknown>;
          return {
            shot: clean(pn.shot, 900),
            alt: clean(pn.alt, 200),
            balloons: (Array.isArray(pn.balloons) ? pn.balloons : [])
              .slice(0, 2)
              .map((b: Record<string, unknown>) => ({
                kind: KINDS.includes(b.kind as BalloonKind) ? (b.kind as BalloonKind) : "speech",
                text: clean(b.text, b.kind === "sfx" ? 12 : 90),
                at: CORNERS.includes(b.at as Corner) ? (b.at as Corner) : "top-left",
              }))
              .filter((b: ScriptBalloon) => b.text),
          };
        }),
      };
    }),
  };
}

export async function writeScript(o: Parameters<typeof brief>[0]): Promise<Script> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = await llm({ prompt: brief(o), estimateUsd: estimate.llm("script", o.pages), maxTokens: 2_000 + 2_000 * o.pages });
      const script = parseScript(output, o.pages);
      return { ...script, ...(o.genre ? { genre: o.genre } : {}), ...(o.title ? { title: o.title } : {}) };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Couldn't write the script: ${(last as Error)?.message}`);
}

// ——— Art ———
// FLUX.2 [dev] on fal: fal-ai/flux-2 (text-to-image, $0.012/MP) and fal-ai/flux-2/edit
// (reference images, $0.012/MP of input + output). Replaces fal-ai/flux/dev ($0.025/MP).
const T2I = "fal-ai/flux-2";
const EDIT = "fal-ai/flux-2/edit";
const NO_TEXT = "no text, no letters, no words, no logo, no watermark, no speech bubbles";

export type ImageSize = "landscape_16_9" | "square_hd" | "portrait_4_3";
/** Pixel sizes the pipeline has always used (flux/dev's presets), sent explicitly so both endpoints agree. */
export const SIZES: Record<ImageSize, { width: number; height: number }> = {
  landscape_16_9: { width: 1024, height: 576 },
  square_hd: { width: 1024, height: 1024 },
  portrait_4_3: { width: 768, height: 1024 },
};

type FluxOut = { images: { url: string }[]; seed: number; has_nsfw_concepts?: boolean[] };

/** One FLUX.2 generation: record its cost, reject flagged art, download the bytes. */
async function render(endpoint: string, input: Record<string, unknown>, costUsd: number, kind: "sheet" | "panel" | "panel-ref") {
  const r = await fal<FluxOut>(endpoint, {
    num_inference_steps: 28,
    guidance_scale: 2.5,
    enable_safety_checker: true,
    output_format: "jpeg",
    ...input,
  });
  recordSpend(kind, costUsd);
  if (r.has_nsfw_concepts?.[0]) throw new Error("panel flagged by safety filter");
  const url = r.images?.[0]?.url;
  if (!url) throw new Error(`${endpoint} returned no image`);
  const img = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`image download ${img.status}`);
  return { url, bytes: new Uint8Array(await img.arrayBuffer()), seed: r.seed };
}

async function retry<T>(what: string, run: (attempt: number) => Promise<T>) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await run(attempt);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Couldn't ${what}: ${(last as Error)?.message}`);
}

const SHEET_STYLE = "clean comic book art, confident black ink line work, flat cel-shaded colors";
const SHEET_SIZE = { width: 1024, height: 576 };

/**
 * A character turnaround to use as a reference for every panel: the same
 * character three times (front, three-quarter, action pose) on a plain light
 * background. 1024x576 on FLUX.2 = $0.012.
 */
export async function characterSheet(o: { name: string; prompt: string; style?: string; seed?: number }): Promise<{ url: string; bytes: Uint8Array; seed: number }> {
  const seed = o.seed ?? seedFrom(`${o.name}\n${o.prompt}`);
  const prompt = [
    `${o.style ?? SHEET_STYLE}, character model sheet`,
    `one character, ${o.prompt}`,
    "drawn three times side by side at the same scale, full body head to toe: facing front standing relaxed, three-quarter view, and a dynamic action pose",
    "identical face, hair, outfit, colors and proportions in all three",
    "plain flat off-white background, even lighting, no scenery, no props on the ground, no panel borders",
    NO_TEXT,
  ].join(", ");
  return retry("draw the character sheet", (attempt) =>
    render(T2I, { prompt, image_size: SHEET_SIZE, seed: seed + attempt }, estimate.sheet(SHEET_SIZE.width, SHEET_SIZE.height), "sheet"),
  );
}

/**
 * One panel. Without refs: FLUX.2 text-to-image. With refs (character sheet URLs,
 * or data: URIs; max 4): FLUX.2 edit, told to keep the referenced character on model.
 */
export async function draw(prompt: string, size: ImageSize, seed: number, opts: { refs?: string[]; character?: string } = {}) {
  const image_size = SIZES[size];
  const refs = (opts.refs ?? []).filter(Boolean).slice(0, 4);
  const r = await retry("draw a panel", (attempt) =>
    refs.length
      ? render(
          EDIT,
          { prompt: withRefs(prompt, refs.length, opts.character), image_urls: refs, image_size, seed: seed + attempt },
          estimate.panel(image_size.width, image_size.height, refs.length),
          "panel-ref",
        )
      : render(T2I, { prompt: `${prompt}, ${NO_TEXT}`, image_size, seed: seed + attempt }, estimate.panel(image_size.width, image_size.height), "panel"),
  );
  return r.bytes;
}

function withRefs(prompt: string, n: number, character?: string) {
  const sheets = n > 1 ? `reference images 1 to ${n}` : "the reference image";
  const who = character ? `${character}, the character shown in ${sheets},` : `the character shown in ${sheets}`;
  return [
    `A single new comic panel: ${prompt}`,
    `Draw ${who} exactly on model: the same face, hairstyle, outfit, colors and body proportions as in the character sheet`,
    "Use the sheet only as a character reference: do not copy its plain background, its layout or its repeated poses; show the character once, acting in this scene",
    NO_TEXT,
  ].join(". ");
}

function seedFrom(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2 ** 31;
}
