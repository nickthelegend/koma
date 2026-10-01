import Image from "next/image";
import { progressLabel } from "@/lib/format";

// Three print treatments for a series launched without a character sheet. The
// name picks one, so the same series always looks the same and a board of them
// doesn't read as one repeated tile.
const PLATES = [
  { ground: "bg-stock-2", dots: "text-kapow/45", ink: "text-paper", rule: "border-paper/15" },
  { ground: "bg-kapow", dots: "text-ink/25", ink: "text-ink", rule: "border-ink/25" },
  { ground: "bg-paper", dots: "text-kapow/40", ink: "text-paper-ink", rule: "border-paper-ink/20" },
  { ground: "bg-ink", dots: "text-paper/20", ink: "text-kapow", rule: "border-kapow/30" },
] as const;

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * No art: the character's name, set as a cover plate. Sized in container units
 * so the longest word always fits the width and every line fits the height.
 */
function NamePlate({ name, caption }: { name: string; caption: boolean }) {
  const words = (name.trim() || "Your character").toUpperCase().split(/\s+/);
  const longest = Math.max(...words.map((w) => w.length));
  const lines = Math.min(words.length, 4);
  // Keep the top quarter clear for badges and captions.
  const size = Math.min(84 / (0.5 * longest), 36 / (lines * 0.86), caption ? 17 : 20);
  const p = PLATES[hash(name) % PLATES.length];
  return (
    <div className={`@container absolute inset-0 ${p.ground}`}>
      <div
        className={`halftone absolute inset-y-0 right-0 w-3/5 ${p.dots}`}
        style={{ maskImage: "linear-gradient(100deg, transparent 10%, #000 75%)", WebkitMaskImage: "linear-gradient(100deg, transparent 10%, #000 75%)" }}
        aria-hidden
      />
      <div className={`absolute inset-[4%] border-2 ${p.rule}`} aria-hidden />
      <p className={`masthead absolute inset-x-[8%] bottom-[11%] ${p.ink}`} style={{ fontSize: `${size}cqw`, lineHeight: 0.86 }} aria-hidden>
        {words.map((w, i) => (
          <span key={i} className="block">{w}</span>
        ))}
      </p>
      {caption && (
        <span className={`absolute right-[6%] top-[8%] -rotate-2 border-2 border-ink bg-paper px-2 py-1 font-letter text-[11px] leading-none text-paper-ink @md:text-[13px]`}>
          Launched without a sheet
        </span>
      )}
    </div>
  );
}

/**
 * A character sheet (16:9, as drawn at launch). A series launched straight
 * on-chain has none, so it gets its name set as a plate instead of a fake image.
 */
export function Sheet({
  src,
  name,
  sizes,
  priority = false,
  className = "",
  caption = false,
}: {
  src: string;
  name: string;
  sizes: string;
  priority?: boolean;
  className?: string;
  /** Say plainly on the plate that there's no art (large placements). */
  caption?: boolean;
}) {
  return (
    <div className={`relative aspect-[16/9] overflow-hidden bg-stock-2 ${className}`} role={src ? undefined : "img"} aria-label={src ? undefined : `${name || "Character"}: no character sheet drawn`}>
      {src ? <Image src={src} alt={`Character sheet of ${name}`} fill priority={priority} sizes={sizes} className="object-cover" /> : <NamePlate name={name} caption={caption} />}
    </div>
  );
}

/** Raised so far against the graduation target, in on-chain blue. */
export function RaisedBar({ raised, target, label = true, size = "sm" }: { raised: number; target: number; label?: boolean; size?: "sm" | "lg" }) {
  const pct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
  const money = (n: number) => `$${n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`;
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Raised toward graduation"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={raised}
        aria-valuetext={`${raised.toFixed(2)} of ${target.toFixed(0)} USDC raised, ${progressLabel(raised, target)}`}
        className={size === "lg" ? "relative h-7 border-2 border-arb/60 bg-ink" : "h-2 bg-rule"}
      >
        <div className="relative h-full overflow-hidden bg-arb" style={{ width: `${pct}%` }}>
          {size === "lg" && <div className="halftone absolute inset-0 text-ink/25" aria-hidden />}
        </div>
      </div>
      {label && (
        <p className={`mt-1.5 flex justify-between gap-2 font-mono text-mute ${size === "lg" ? "text-[13px]" : "text-[11.5px]"}`}>
          <span>
            <span className="text-paper">{money(raised)}</span> of ${target.toLocaleString("en-US")}
          </span>
          <span className={pct >= 100 ? "text-arb" : "text-soft"}>{progressLabel(raised, target)}</span>
        </p>
      )}
    </div>
  );
}

export function DemoBadge({ target }: { target: number }) {
  return (
    <span className="bg-bam px-1.5 py-1 font-display text-[11px] uppercase leading-none text-ink" title={`Demo series: graduates at ${target} USDC, 5-minute canon votes`}>
      Demo · graduates at ${target}
    </span>
  );
}

export function GraduatedBadge() {
  return <span className="bg-arb px-1.5 py-1 font-display text-[11px] uppercase leading-none text-ink">Graduated · Uniswap v4</span>;
}

export function RemixBadge({ of }: { of?: string }) {
  return (
    <span className="max-w-[18ch] truncate bg-paper px-1.5 py-1 font-display text-[11px] uppercase leading-none text-paper-ink" title={of ? `Remix of ${of}` : undefined}>
      {of ? `Remix of ${of}` : "Remix"}
    </span>
  );
}
