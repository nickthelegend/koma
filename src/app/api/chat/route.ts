import { NextResponse, type NextRequest } from "next/server";
import { findComic } from "@/lib/catalog";
import { config } from "@/lib/server/config";
import { clientIp } from "@/lib/server/client-ip";
import { editorTurn, type ChatMessage } from "@/lib/server/chat";
import { GENRES } from "@/lib/studio-config";
import type { Genre, Pitch } from "@/lib/types";

export const dynamic = "force-dynamic";

// Chat is free to use, so each caller gets a modest budget of editor turns.
const g = globalThis as unknown as { __komaChatHits?: Map<string, number[]> };
const hits = (g.__komaChatHits ??= new Map<string, number[]>());
const WINDOW_MS = 10 * 60_000;
const MAX_TURNS = 40;
const GLOBAL_PER_HOUR = Number(process.env.KOMA_CHAT_PER_HOUR ?? 600);

function limited(key: string, windowMs: number, max: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

/** POST /api/chat { messages: [{ role, content }], pitch?, remixOf? } → { reply, pitch } */
export async function POST(req: NextRequest) {
  if (!config.falKey) return NextResponse.json({ error: "The editor is offline: server missing FAL_KEY." }, { status: 503 });
  if (limited(`ip:${clientIp(req)}`, WINDOW_MS, MAX_TURNS)) {
    return NextResponse.json({ error: "That's a lot of notes. Give the editor a few minutes." }, { status: 429 });
  }
  if (limited("all", 60 * 60_000, GLOBAL_PER_HOUR)) {
    return NextResponse.json({ error: "The editor is swamped right now. Try again in a little while." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { messages?: ChatMessage[]; pitch?: Pitch | null; remixOf?: string; genre?: string } | null;
  const messages = (Array.isArray(body?.messages) ? body.messages : [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-30)
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, 1000) }));
  if (!messages.length || messages.at(-1)!.role !== "user" || !messages.at(-1)!.content) {
    return NextResponse.json({ error: "Say something to the editor first." }, { status: 400 });
  }
  const remix = body?.remixOf ? await findComic(body.remixOf) : null;
  try {
    const genre = GENRES.find((g) => g === body?.genre) as Genre | undefined;
    return NextResponse.json(await editorTurn(messages, body?.pitch ?? null, remix, genre));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
