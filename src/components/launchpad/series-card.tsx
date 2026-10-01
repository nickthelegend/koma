import Link from "next/link";
import type { SeriesSummary } from "@/lib/launchpad/types";
import { ageSec, coinPrice, coinPricePlain, plural, progressLabel, usdAmount } from "@/lib/format";
import { DemoBadge, GraduatedBadge, RaisedBar, RemixBadge, Sheet } from "./sheet";
import { Sparkline } from "./sparkline";
import { MAINNET } from "./network-note";

type Props = {
  s: SeriesSummary;
  /** Position in a list (kept for callers; cards no longer tilt). */
  index?: number;
  priority?: boolean;
  /** Recent prices, oldest first. */
  spark?: number[];
  /** Name of the series this one remixes, when known. */
  parentName?: string;
  /** Chain time (unix seconds), for the series' age. */
  now?: number;
  /** Launch preview: same card, not a link, no market numbers that don't exist yet. */
  preview?: boolean;
};

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-mute">{label}</dt>
      <dd className="truncate font-mono text-[13px] text-paper" title={title}>{value}</dd>
    </div>
  );
}

/** One series on the board: its character, its coin, and how close it is to graduating. */
export function SeriesCard({ s, priority = false, spark, parentName, now, preview = false }: Props) {
  const symbol = s.symbol.trim();
  const status = s.graduated ? "graduated to Uniswap v4" : s.complete ? "curve complete, graduating" : `${progressLabel(s.raisedUsdc, s.targetUsdc)} to graduation`;
  const body = (
    <>
      <div className="relative border-b border-rule">
        <Sheet src={s.sheetUrl} name={s.characterName} priority={priority} sizes="(min-width: 1024px) 400px, (min-width: 640px) 46vw, 92vw" />
        <div className="absolute left-2 top-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-1.5">
          {s.graduated ? <GraduatedBadge /> : s.demo && !MAINNET && <DemoBadge target={s.targetUsdc} />}
          {s.parentSeriesId > 0 && <RemixBadge of={parentName} />}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="masthead truncate text-[28px] leading-[0.9] text-paper group-hover:text-kapow" title={s.name}>{s.name}</p>
            <p className="mt-1.5 truncate text-[12.5px] text-mute">
              <span className="font-mono text-soft">${symbol}</span> · starring {s.characterName}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-[15px] leading-none text-arb" title={`${coinPricePlain(s.priceUsdc)} per coin`}>{coinPrice(s.priceUsdc)}</p>
            {spark && spark.length > 1 ? <Sparkline points={spark} className="ml-auto mt-1.5" /> : <p className="mt-1.5 text-[11px] text-mute">per coin</p>}
          </div>
        </div>

        <div className="mt-4">
          {s.graduated ? (
            <p className="border-l-2 border-arb pl-2.5 text-[12.5px] leading-snug text-soft">
              Raised {usdAmount(s.raisedUsdc)}. Trades in its Uniswap v4 pool.
            </p>
          ) : (
            <RaisedBar raised={s.raisedUsdc} target={s.targetUsdc} />
          )}
        </div>

        <div className="min-h-4 flex-1" aria-hidden />
        <dl className={`grid gap-2 border-t border-rule pt-3 ${now === undefined && !preview ? "grid-cols-3" : "grid-cols-4"}`}>
          <Fact label="Mkt cap" value={usdAmount(s.marketCapUsdc)} />
          <Fact label="Holders" value={preview ? "0" : s.holders.toLocaleString("en-US")} />
          <Fact label="Canon" value={plural(s.episodes, "ep", "eps")} />
          {preview ? <Fact label="Age" value="new" /> : now !== undefined && <Fact label="Age" value={ageSec(s.launchedAt, now)} />}
        </dl>
      </div>
    </>
  );

  const frame = "flex h-full flex-col border border-rule bg-stock";
  if (preview) return <div className={frame}>{body}</div>;
  return (
    <Link
      href={`/s/${s.id}`}
      className={`group ${frame} transition-[transform,box-shadow,border-color] duration-150 ease-out hover:-translate-x-0.5 hover:-translate-y-0.5 hover:border-paper/60 hover:shadow-[6px_6px_0_0_var(--kapow)] focus-visible:border-paper/60 focus-visible:shadow-[6px_6px_0_0_var(--kapow)]`}
      aria-label={`${s.name}, $${symbol}, starring ${s.characterName}. Price ${coinPricePlain(s.priceUsdc)} per coin, ${status}, ${plural(s.holders, "holder")}.`}
    >
      {body}
    </Link>
  );
}
