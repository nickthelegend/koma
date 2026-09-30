import { coinPrice, coinPricePlain, plural } from "@/lib/format";

const W = 600;
const H = 200;

/**
 * Price after every trade, as a step chart: the price holds until the next
 * trade moves it. Hand-rolled SVG; the y axis spans only the range traded,
 * since a curve's early moves are tiny next to its starting price.
 */
export function PriceChart({ points, now }: { points: { t: number; price: number }[]; now: number }) {
  const pts = points.length ? [...points, { t: Math.max(now, points.at(-1)!.t), price: points.at(-1)!.price }] : [];
  const t0 = pts[0]?.t ?? 0;
  const t1 = Math.max(t0 + 1, pts.at(-1)?.t ?? 1);
  const prices = pts.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const flat = hi - lo < lo * 1e-9;
  const pad = flat ? lo * 0.05 || 1 : (hi - lo) * 0.12;
  const [ymin, ymax] = [lo - pad, hi + pad];
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (p: number) => H - ((p - ymin) / (ymax - ymin)) * H;

  let line = "";
  pts.forEach((p, i) => {
    line += i === 0 ? `M${x(p.t).toFixed(1)},${y(p.price).toFixed(1)}` : `H${x(p.t).toFixed(1)}V${y(p.price).toFixed(1)}`;
  });
  const area = pts.length ? `${line}V${H}H0Z` : "";
  const first = pts[0]?.price ?? 0;
  const last = pts.at(-1)?.price ?? 0;
  const trades = Math.max(0, points.length - 1);
  const change = first > 0 ? ((last - first) / first) * 100 : 0;

  return (
    <figure className="border border-rule bg-stock">
      <figcaption className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-2.5">
        <span className="text-[12px] text-mute">Price per coin · {plural(trades, "trade")}</span>
        <span className={`font-mono text-[12px] ${change >= 0 ? "text-arb" : "text-kapow"}`}>
          {change >= 0 ? "+" : ""}
          {change.toFixed(change !== 0 && Math.abs(change) < 1 ? 2 : 1)}% since launch
        </span>
      </figcaption>
      <div className="relative px-4 pb-3 pt-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Price went from ${coinPricePlain(first)} at launch to ${coinPricePlain(last)} over ${plural(trades, "trade")}.`}
          className="block h-[180px] w-full md:h-[220px]"
        >
          <defs>
            <linearGradient id="price-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--arb)" stopOpacity="0.35" />
              <stop offset="1" stopColor="var(--arb)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--rule)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          {area && <path d={area} fill="url(#price-fill)" />}
          {line && <path d={line} fill="none" stroke="var(--arb)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        </svg>
        {pts.length > 0 && (
          <>
            <span className="pointer-events-none absolute right-5 top-3 bg-stock/80 font-mono text-[10.5px] text-mute">{coinPrice(hi)}</span>
            <span className="pointer-events-none absolute bottom-4 right-5 bg-stock/80 font-mono text-[10.5px] text-mute">{coinPrice(lo)}</span>
          </>
        )}
      </div>
    </figure>
  );
}
