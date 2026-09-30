import { config } from "./config";

// Whether fal will actually run jobs right now. Checked before quoting, so a
// locked or out-of-credit account never takes a payment it can't draw for.
// The probe is an empty request to a real endpoint: a working account gets a
// free validation error (4xx other than 401/403); a locked one gets 403.
const TTL_MS = 60_000;
let cached: { at: number; ok: boolean; reason?: string } | null = null;

export async function falHealth(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!config.falKey) return { ok: false, reason: "server missing FAL_KEY" };
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ok ? { ok: true } : { ok: false, reason: cached.reason! };
  try {
    const res = await fetch("https://fal.run/fal-ai/flux-2", {
      method: "POST",
      headers: { Authorization: `Key ${config.falKey}`, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail ?? `HTTP ${res.status}`;
      cached = { at: Date.now(), ok: false, reason: detail };
    } else {
      cached = { at: Date.now(), ok: true };
    }
  } catch {
    // Network trouble reaching fal: don't block payments on a probe timeout; jobs retry.
    cached = { at: Date.now(), ok: true };
  }
  return cached.ok ? { ok: true } : { ok: false, reason: cached.reason! };
}

/** Called when a real fal call comes back locked, so the next quote is refused at once. */
export function markFalDown(reason: string) {
  cached = { at: Date.now(), ok: false, reason };
}

export const FAL_DOWN_MESSAGE = "The studio's AI artist is offline right now, so nothing can be drawn. No payment was taken. Try again later.";
