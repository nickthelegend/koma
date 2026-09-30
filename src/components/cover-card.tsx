import Image from "next/image";
import Link from "next/link";
import type { Comic } from "@/lib/types";
import { plural } from "@/lib/format";

// Covers are pinned to the wall by hand: each one sits at its own small angle,
// and every third one is held up by tape.
const TILTS = [-2.2, 1.6, -0.8, 2.4, -1.4, 0.9, 2, -2.6, 1.1, -1.8, 0.6, -0.4];

export function CoverCard({ comic, index, priority = false }: { comic: Comic; index: number; priority?: boolean }) {
  const tilt = TILTS[index % TILTS.length];
  const taped = index % 3 === 1;
  return (
    <Link href={`/c/${comic.id}`} className="group block outline-none" aria-label={`${comic.title}, ${comic.genre}, ${plural(comic.pageCount, "page")}`}>
      <div
        className="relative transition-transform duration-200 ease-out group-hover:!rotate-0 group-hover:-translate-y-1 group-focus-visible:!rotate-0"
        style={{ rotate: `${tilt}deg` }}
      >
        {taped && <span className="tape -top-2.5 left-1/2 -translate-x-1/2 rotate-[-4deg]" />}
        <div className="relative aspect-[3/4] overflow-hidden bg-stock-2 shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/5 group-focus-visible:ring-2 group-focus-visible:ring-bam">
          <Image
            src={comic.cover}
            alt=""
            fill
            priority={priority}
            sizes="(min-width: 1024px) 300px, (min-width: 768px) 30vw, 46vw"
            className="object-cover"
          />
          {/* Masthead strip printed on the cover itself */}
          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-2.5 pb-6 pt-2">
            <p className="masthead text-[clamp(20px,6vw,34px)] text-paper drop-shadow-[2px_2px_0_rgba(0,0,0,0.6)] md:text-[clamp(22px,2.5vw,36px)]">
              {comic.title}
            </p>
          </div>
          <span className="absolute bottom-2 left-2 bg-paper px-1.5 py-0.5 font-display text-[11px] uppercase leading-none text-paper-ink">
            {comic.genre}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-paper">{comic.title}</p>
          <p className="mt-0.5 truncate text-[12px] text-mute">by {comic.creator.name}</p>
        </div>
        <span className="shrink-0 pt-px font-display text-[14px] tracking-wide text-paper">
          #{comic.chain.tokenId}
        </span>
      </div>
    </Link>
  );
}
