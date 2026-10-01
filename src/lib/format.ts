export function short(hex: string, head = 6, tail = 4) {
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

export function compact(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function usd(n: number | string) {
  const v = typeof n === "string" ? Number(n) : n;
  return `$${v.toFixed(2)}`;
}

export function ago(iso: string, now = Date.now()) {
  const s = Math.max(1, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** "1 page", "2 pages", "1.2K reads" */
export function plural(n: number, word: string, many = `${word}s`) {
  return `${n >= 1000 ? compact(n) : n} ${n === 1 ? word : many}`;
}

// ——— Launchpad numbers. Curve prices are tiny (a millionth of a dollar), so
// they are shown with three significant digits, and runs of zeros collapse to
// a subscript count: 0.00000105 → "$0.0₅105".
const SUB = "₀₁₂₃₄₅₆₇₈₉";

/** Three significant digits, never in exponent form. */
function sig3(n: number) {
  const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(n))));
  return n.toFixed(Math.min(digits, 20));
}
const trimZeros = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);

/** Price of one coin in USDC: "$0.0₅105", "$0.0421", "$1.25". */
export function coinPrice(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const zeros = -Math.floor(Math.log10(n)) - 1;
  if (zeros < 4) return `$${sig3(n)}`;
  const mantissa = Math.round(n * 10 ** (zeros + 3));
  // Rounding 9.995… up to 1000 adds a digit; drop it and one zero instead.
  const [z, m] = mantissa >= 1000 ? [zeros - 1, Math.round(mantissa / 10)] : [zeros, mantissa];
  return `$0.0${String(z).split("").map((d) => SUB[Number(d)]).join("")}${m}`;
}

/** The same price for screen readers and titles: "$0.00000105". */
export function coinPricePlain(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  return n >= 1 ? `$${n.toFixed(2)}` : `$${sig3(n)}`;
}

/** Dollar amounts that can be large or small: "$1.2K", "$25", "$0.35", "$0.0042". */
export function usdAmount(n: number) {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const a = Math.abs(n);
  if (a >= 10_000) return `$${compact(n)}`;
  if (a >= 1_000) return `$${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
  if (a >= 0.01) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `$${trimZeros(sig3(n))}`;
}

/** Coin counts: "950M", "20M", "1,234", "0.5". */
export function coinAmount(n: number) {
  if (!Number.isFinite(n) || n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 100_000) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(n);
  if (a >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return trimZeros(sig3(n));
}

/** "3m ago" from unix seconds. */
export const agoSec = (unix: number, now = Date.now()) => ago(new Date(unix * 1000).toISOString(), now);

/** "4:05" or "1:02:03" until a unix time; "0:00" once it has passed. */
export function countdown(untilUnix: number, now = Date.now()) {
  const s = Math.max(0, Math.floor(untilUnix - now / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Share of a graduation target raised, for labels: "51%", "<1%", "100%". */
export function progressLabel(raised: number, target: number) {
  const pct = target > 0 ? (raised / target) * 100 : 0;
  if (pct >= 100) return "100%";
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.floor(pct)}%`;
}

/** "3m", "5h", "2d": a series' age from its launch time (unix seconds). */
export function ageSec(unix: number, nowUnix: number) {
  const s = Math.max(0, nowUnix - unix);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 172_800) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}
