import { coinPricePlain } from "@/lib/format";

/** A series' recent prices as a tiny step line. Flat until somebody trades. */
export function Sparkline({ points, className = "" }: { points: number[]; className?: string }) {
  if (points.length < 2) return null;
  const W = 96;
  const H = 28;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (p: number) => (hi === lo ? H / 2 : H - 2 - ((p - lo) / span) * (H - 4));
  let d = `M0,${y(points[0]).toFixed(1)}`;
  for (let i = 1; i < points.length; i++) d += `H${x(i).toFixed(1)}V${y(points[i]).toFixed(1)}`;
  const up = points.at(-1)! >= points[0];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Recent price: ${coinPricePlain(points[0])} to ${coinPricePlain(points.at(-1)!)}`}
      className={`block h-7 w-24 ${className}`}
    >
      <path d={d} fill="none" stroke={up ? "var(--arb)" : "var(--kapow)"} strokeWidth="1.75" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
