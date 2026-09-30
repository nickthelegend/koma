// A torn-paper edge: a white strip with a ragged top and a rougher bottom, the
// way a page looks ripped out of a comic. Deterministic so SSR matches.
function rand(seed: number) {
  let s = seed;
  return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296;
}

function edge(seed: number, y: number, amp: number, step: number, width = 1440) {
  const r = rand(seed);
  const pts: string[] = [];
  for (let x = 0; x <= width; x += step * (0.5 + r())) pts.push(`${x.toFixed(1)},${(y + (r() - 0.5) * amp).toFixed(1)}`);
  pts.push(`${width},${y}`);
  return pts;
}

export function TornEdge({ className = "", flip = false }: { className?: string; flip?: boolean }) {
  const top = edge(7, 16, 9, 26);
  const bottom = edge(91, 38, 20, 11).reverse();
  const ink = edge(33, 50, 18, 18);
  return (
    <svg
      viewBox="0 0 1440 64"
      preserveAspectRatio="none"
      aria-hidden
      className={`block h-10 w-full md:h-16 ${flip ? "rotate-180" : ""} ${className}`}
    >
      <polygon points={`0,64 ${ink.join(" ")} 1440,64`} fill="#151515" />
      <polygon points={`${top.join(" ")} ${bottom.join(" ")}`} fill="#f1ece2" />
    </svg>
  );
}
