import Link from "next/link";
import type { SeriesSummary } from "@/lib/launchpad/types";
import { coinPrice, coinPricePlain, plural, usdAmount } from "@/lib/format";
import { DemoBadge, GraduatedBadge, RaisedBar, Sheet } from "./sheet";

// Series cards hang on the wall like the covers do, just less crooked: a
// character sheet is a wide print, and a big tilt reads as broken.
const TILTS = [-0.9, 0.7, -0.4, 1, -0.7, 0.5];

/** One series in the explorer: its character, its coin and how close it is to graduating. */
export function SeriesCard({ s, index, priority = false }: { s: SeriesSummary; index: number; priority?: boolean }) {
  const status = s.graduated ? "graduated to Uniswap v4" : s.complete ? "curve complete" : `${Math.floor((s.raisedUsdc / Math.max(1, s.targetUsdc)) * 100)}% to graduation`;
  return (
    <Link
      href={`/s/${s.id}`}
      className="group block outline-none"
      aria-label={`${s.name}, $${s.symbol}, starring ${s.characterName}. Price ${coinPricePlain(s.priceUsdc)} per coin, ${status}.`}
    >
      <div
        className="relative transition-transform duration-200 ease-out group-hover:!rotate-0 group-hover:-translate-y-1 group-focus-visible:!rotate-0"
        style={{ rotate: `${TILTS[index % TILTS.length]}deg` }}
      >
        {index % 3 === 1 && <span className="tape -top-2.5 left-8 rotate-[-6deg]" />}
        <div className="relative shadow-[0_18px_30px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/5 group-focus-visible:ring-2 group-focus-visible:ring-bam">
          <Sheet src={s.sheetUrl} name={s.characterName} priority={priority} sizes="(min-width: 1024px) 400px, (min-width: 640px) 46vw, 92vw" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {s.graduated ? <GraduatedBadge /> : s.demo && <DemoBadge target={s.targetUsdc} />}
            {s.parentSeriesId > 0 && <span className="bg-paper px-1.5 py-0.5 font-display text-[11px] uppercase leading-none text-paper-ink">Remix</span>}
          </div>
        </div>
      </div>

      <div className="mt-3.5 px-0.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="masthead truncate text-[30px] text-paper group-hover:text-kapow">{s.name}</p>
            <p className="mt-1 truncate text-[12.5px] text-mute">
              <span className="font-mono text-soft">${s.symbol}</span> · starring {s.characterName}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[14px] text-arb" title={`${coinPricePlain(s.priceUsdc)} per coin`}>{coinPrice(s.priceUsdc)}</p>
            <p className="mt-0.5 text-[11.5px] text-mute">cap {usdAmount(s.marketCapUsdc)}</p>
          </div>
        </div>
        <div className="mt-3">
          {s.graduated ? (
            <p className="font-mono text-[11.5px] text-mute">Raised ${s.raisedUsdc.toFixed(2)} · trading in its Uniswap v4 pool</p>
          ) : (
            <RaisedBar raised={s.raisedUsdc} target={s.targetUsdc} />
          )}
        </div>
        <p className="mt-2 text-[12px] text-mute">
          {plural(s.holders, "holder")} · {plural(s.episodes, "canon episode")}
        </p>
      </div>
    </Link>
  );
}
