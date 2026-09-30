// In-memory sliding-window limits for the free endpoints (one server instance).
const g = globalThis as unknown as { __komaHits?: Map<string, number[]> };
const hits = (g.__komaHits ??= new Map<string, number[]>());

/** Records a hit under `key`; true when the caller is over `max` hits in `windowMs`. */
export function limited(key: string, windowMs: number, max: number) {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
