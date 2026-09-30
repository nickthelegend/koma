import { db } from "./store";

// Daily fal spend guard. Every fal call records what it (probably) cost in its
// own SQLite table; routes can ask `assertBudget(estimate)` before starting work.
//
// Prices, from the fal model pages (checked 2026-09-30):
// - fal-ai/flux-2 (FLUX.2 [dev] text-to-image): $0.012 per megapixel of output.
// - fal-ai/flux-2/edit (FLUX.2 [dev] edit): $0.012 per megapixel of input AND
//   output; every input image is resized to 1 MP first, so each reference costs
//   $0.012 on top of the output. fal's own example: 1024x1024 out + one input = $0.024.
// - fal-ai/flux/dev (old panel model, for comparison): $0.025 per megapixel.
// - openrouter/router: billed per token at the OpenRouter price of the model;
//   the response carries `usage.cost`, which we record when present.
//   anthropic/claude-sonnet-4.5 on OpenRouter: $3 / M input, $15 / M output.
// fal counts 1024x1024 as 1 MP; we round megapixels UP so estimates never undershoot.

const MP_USD = 0.012;
const LLM_IN_PER_TOKEN = 3 / 1_000_000;
const LLM_OUT_PER_TOKEN = 15 / 1_000_000;

export type SpendKind = "llm" | "sheet" | "panel" | "panel-ref";

/** Megapixels as fal bills them (1024x1024 = 1), rounded up. */
export const megapixels = (w: number, h: number) => Math.max(1, Math.ceil((w * h) / (1024 * 1024)));

export const estimate = {
  /**
   * One LLM call. Script: ~1.5k prompt tokens, ~1.1k output tokens per page
   * (measured ~$0.02 for a 1-page script). Chat turn: ~1.5k in + transcript, ~350 out.
   */
  llm(kind: "script" | "chat", pages = 1) {
    const [inTok, outTok] = kind === "script" ? [1_600, 300 + 1_100 * pages] : [2_000, 400];
    return round(inTok * LLM_IN_PER_TOKEN + outTok * LLM_OUT_PER_TOKEN);
  },
  /** FLUX.2 character turnaround sheet (1024x576 → 1 MP → $0.012). */
  sheet(width = 1024, height = 576) {
    return round(megapixels(width, height) * MP_USD);
  },
  /** One panel: FLUX.2 t2i without refs; FLUX.2 edit adds 1 MP per reference image. */
  panel(width = 1024, height = 1024, refs = 0) {
    return round((megapixels(width, height) + Math.min(refs, 4)) * MP_USD);
  },
  /** A whole comic: script + cover + 4 panels per page (+ optional sheets, refs per panel). */
  comic(pages: number, o: { sheets?: number; refs?: number } = {}) {
    const panels = pages * 4 + 1;
    return round(this.llm("script", pages) + (o.sheets ?? 0) * this.sheet() + panels * this.panel(1024, 1024, o.refs ?? 0));
  },
};

export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly capUsd: number;
  readonly estimatedUsd: number;
  readonly day: string;
  constructor(s: { spentUsd: number; capUsd: number; day: string }, estimatedUsd: number) {
    super(`Today's AI budget is used up ($${s.spentUsd.toFixed(2)} of $${s.capUsd.toFixed(2)}). Try again after 00:00 UTC.`);
    this.name = "BudgetExceededError";
    this.spentUsd = s.spentUsd;
    this.capUsd = s.capUsd;
    this.estimatedUsd = estimatedUsd;
    this.day = s.day;
  }
}

const round = (usd: number) => Math.round(usd * 1e6) / 1e6;
const today = () => new Date().toISOString().slice(0, 10);
const capUsd = () => {
  const raw = process.env.KOMA_FAL_DAILY_USD;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 15;
};

const g = globalThis as unknown as { __komaBudgetTable?: boolean };
function table() {
  const conn = db();
  if (!g.__komaBudgetTable) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS fal_spend (
        id INTEGER PRIMARY KEY,
        day TEXT NOT NULL,
        at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        usd REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fal_spend_day ON fal_spend (day);
    `);
    g.__komaBudgetTable = true;
  }
  return conn;
}

/** Spend so far today (UTC), the cap, and the day key. */
export function budgetStatus() {
  const day = today();
  const row = table().prepare("SELECT coalesce(sum(usd), 0) AS usd FROM fal_spend WHERE day = ?").get(day) as { usd: number };
  return { spentUsd: round(row.usd), capUsd: capUsd(), day };
}

/** Throws BudgetExceededError if spending `estimatedUsd` more today would pass KOMA_FAL_DAILY_USD. */
export function assertBudget(estimatedUsd: number) {
  const s = budgetStatus();
  if (s.spentUsd + estimatedUsd > s.capUsd) throw new BudgetExceededError(s, estimatedUsd);
  return s;
}

/** Log one fal call's cost. Never throws: bookkeeping must not break a paid job. */
export function recordSpend(kind: SpendKind, usd: number) {
  if (!(usd > 0)) return;
  try {
    table().prepare("INSERT INTO fal_spend (day, at, kind, usd) VALUES (?, ?, ?, ?)").run(today(), Date.now(), kind, round(usd));
  } catch (e) {
    console.error("[koma] could not record fal spend", e);
  }
}
