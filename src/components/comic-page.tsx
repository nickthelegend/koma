import Image from "next/image";
import type { Balloon, Page } from "@/lib/types";

// Lettering is live text laid over the art, never baked in: it stays sharp at
// any size, is readable by screen readers, and translates.
function Lettering({ b }: { b: Balloon }) {
  const pos: React.CSSProperties = { left: `${b.x}%`, top: `${b.y}%`, maxWidth: b.w ? `${b.w}%` : undefined };

  if (b.kind === "sfx") {
    return (
      <span
        className="balloon font-sfx text-[clamp(22px,5.4cqw,52px)] leading-none tracking-wide text-bam [paint-order:stroke_fill] [-webkit-text-stroke:0.13em_#0d0d0d]"
        style={{ ...pos, rotate: `${b.tilt ?? 0}deg`, textShadow: "0.06em 0.08em 0 #0d0d0d" }}
      >
        {b.text}
      </span>
    );
  }

  if (b.kind === "caption") {
    return (
      <span
        className="balloon border-[1.5px] border-[#0d0d0d] bg-[#ffe98a] px-[0.7em] py-[0.45em] font-letter text-[clamp(9px,1.75cqw,15px)] uppercase leading-[1.2] text-[#0d0d0d] shadow-[2px_2px_0_#0d0d0d]"
        style={pos}
      >
        {b.text}
      </span>
    );
  }

  const thought = b.kind === "thought";
  return (
    <span
      className={`balloon ${thought ? "" : "balloon-tail"} ${b.tail === "right" ? "tail-r" : ""} border-[1.5px] border-[#0d0d0d] bg-white px-[0.95em] py-[0.6em] text-center font-letter text-[clamp(9px,1.9cqw,16px)] uppercase leading-[1.18] text-[#0d0d0d] ${
        thought ? "rounded-[50%] italic" : "rounded-[48%/42%]"
      }`}
      style={pos}
    >
      {b.text}
      {thought && (
        <>
          <i className="absolute -bottom-3 left-[30%] h-2.5 w-2.5 rounded-full border-[1.5px] border-[#0d0d0d] bg-white" />
          <i className="absolute -bottom-5 left-[24%] h-1.5 w-1.5 rounded-full border-[1.5px] border-[#0d0d0d] bg-white" />
        </>
      )}
    </span>
  );
}

/** One printed page: 1-2-1 layout (wide establishing, two beats, wide reveal). */
export function ComicPage({ page, number, priority = false }: { page: Page; number: number; priority?: boolean }) {
  return (
    <article className="comic-sheet mx-auto w-full [container-type:inline-size]" aria-label={`Page ${number}`}>
      <div className="grid grid-cols-2 gap-[clamp(5px,1.4%,12px)]">
        {page.panels.map((p, i) => (
          <figure
            key={i}
            className={`comic-panel ${p.shape === "wide" ? "col-span-2 aspect-[16/9]" : "aspect-square"}`}
          >
            {p.img ? (
              <Image
                src={p.img}
                alt={p.alt}
                fill
                priority={priority && i < 2}
                sizes={p.shape === "wide" ? "(min-width: 900px) 820px, 100vw" : "(min-width: 900px) 410px, 50vw"}
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-[#e8e4db]" role="img" aria-label="Panel still being drawn">
                <div className="halftone absolute inset-0 animate-ink text-[#0d0d0d]/25" />
                <span className="relative font-letter text-[clamp(9px,1.6cqw,13px)] uppercase text-[#0d0d0d]/60">Inking…</span>
              </div>
            )}
            {p.balloons.map((b, j) => (
              <Lettering key={j} b={b} />
            ))}
          </figure>
        ))}
      </div>
      <p className="mt-[clamp(4px,1%,10px)] text-center font-letter text-[11px] text-[#0d0d0d]/60">{number}</p>
    </article>
  );
}
