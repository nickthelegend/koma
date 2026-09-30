import Image from "next/image";

/**
 * A character sheet (16:9, as drawn at launch). Before one exists, a halftone
 * placeholder with the character's name keeps the same box so nothing shifts.
 */
export function Sheet({ src, name, sizes, priority = false, className = "" }: { src: string; name: string; sizes: string; priority?: boolean; className?: string }) {
  return (
    <div className={`relative aspect-[16/9] overflow-hidden bg-stock-2 ${className}`}>
      {src ? (
        <Image src={src} alt={`Character sheet of ${name}`} fill priority={priority} sizes={sizes} className="object-cover" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-kapow/40">
          <div className="halftone absolute inset-0" aria-hidden />
          <p className="masthead relative px-4 text-center text-[clamp(28px,7vw,56px)] text-paper/80">{name || "Your character"}</p>
        </div>
      )}
    </div>
  );
}

/** Raised so far against the graduation target, in on-chain blue. */
export function RaisedBar({ raised, target, label = true }: { raised: number; target: number; label?: boolean }) {
  const pct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
  return (
    <div>
      <div
        role="progressbar"
        aria-label="Raised toward graduation"
        aria-valuemin={0}
        aria-valuemax={target}
        aria-valuenow={raised}
        aria-valuetext={`${raised.toFixed(2)} of ${target.toFixed(0)} USDC raised`}
        className="h-2 bg-rule"
      >
        <div className="h-full bg-arb transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      {label && (
        <p className="mt-1.5 flex justify-between gap-2 font-mono text-[11.5px] text-mute">
          <span>
            <span className="text-paper">${raised < 100 ? raised.toFixed(2) : Math.round(raised).toLocaleString("en-US")}</span> of $
            {target.toLocaleString("en-US")}
          </span>
          <span>{pct >= 100 ? "100" : pct < 1 && pct > 0 ? "<1" : Math.floor(pct)}%</span>
        </p>
      )}
    </div>
  );
}

export function DemoBadge({ target }: { target: number }) {
  return (
    <span className="bg-bam px-1.5 py-0.5 font-display text-[11px] uppercase leading-none text-ink" title={`Demo series: graduates at ${target} USDC, 5-minute canon votes`}>
      Demo · graduates at ${target}
    </span>
  );
}

export function GraduatedBadge() {
  return <span className="bg-arb px-1.5 py-0.5 font-display text-[11px] uppercase leading-none text-ink">Graduated → Uniswap v4</span>;
}
