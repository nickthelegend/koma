import type { Metadata } from "next";
import Link from "next/link";
import type { SeriesSummary } from "@/lib/launchpad/types";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { listSeries } from "@/lib/server/launchpad/queries";
import { SeriesCard } from "@/components/launchpad/series-card";
import { ArbMark, IconPlus } from "@/components/icons";
import { KOMA } from "@/lib/network";

export const metadata: Metadata = {
  title: "Series",
  description: "Comic series launched on KOMA: each with a Character NFT that has its own wallet, and a coin on a USDC curve whose holders vote on canon.",
};

export const dynamic = "force-dynamic";

const SORTS = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "graduating", label: "Graduating" },
] as const;
type Sort = (typeof SORTS)[number]["key"];

const progress = (s: SeriesSummary) => (s.complete || s.graduated ? -1 : s.raisedUsdc / Math.max(1, s.targetUsdc));

function sorted(list: SeriesSummary[], sort: Sort) {
  // listSeries is already ordered by latest activity (trade or launch).
  if (sort === "new") return [...list].sort((a, b) => b.launchedAt - a.launchedAt);
  if (sort === "graduating") return [...list].sort((a, b) => progress(b) - progress(a));
  return list;
}

export default async function SeriesPage({ searchParams }: PageProps<"/series">) {
  const sp = await searchParams;
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? "trending") as Sort;
  const deployed = launchpad() !== null;
  const all = deployed ? listSeries() : [];
  const list = sorted(all, sort);

  return (
    <>
      <section className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
        <div className="grid items-end gap-6 md:grid-cols-[auto_1fr] md:gap-12">
          <h1 className="masthead text-[27vw] text-kapow md:text-[clamp(150px,17vw,236px)]">Series</h1>
          <div className="flex flex-col gap-4 md:pb-3">
            <p className="max-w-[50ch] text-[14px] leading-relaxed text-soft">
              A series is a character and a story that keeps going. Each one mints a Character NFT with its own wallet and puts a
              coin on a USDC curve. Holders vote on which episode becomes canon, and trading fees pay the character, the series it
              remixed, and KOMA.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/launch" className="slant h-11 px-6 text-[17px]">
                <IconPlus width={16} height={16} /> Launch a series · $0.10
              </Link>
              <span className="flex items-center gap-1.5 text-[12px] text-mute">
                <ArbMark width={13} height={13} /> Testnet collectibles on {KOMA.label}
              </span>
            </div>
          </div>
        </div>
      </section>

      {!deployed ? (
        <section className="mx-auto mt-10 max-w-[1320px] px-4 md:px-8">
          <div role="status" className="border border-dashed border-rule px-6 py-16 text-center">
            <p className="font-display text-3xl uppercase text-paper">The launchpad is offline</p>
            <p className="mx-auto mt-2 max-w-[48ch] text-[14px] leading-relaxed text-mute">
              Its contracts aren&rsquo;t deployed on {KOMA.label} yet, so there are no series to show. Comics are unaffected: the
              catalog and studio work as usual.
            </p>
            <Link href="/" className="mt-6 inline-flex h-11 items-center border-2 border-paper/80 px-5 font-display text-[16px] uppercase hover:bg-paper hover:text-ink">
              Back to the catalog
            </Link>
          </div>
        </section>
      ) : all.length === 0 ? (
        <section className="mx-auto mt-10 max-w-[1320px] px-4 md:px-8">
          <Link
            href="/launch"
            className="group flex flex-col gap-6 border-2 border-dashed border-kapow/70 p-6 hover:border-kapow md:flex-row md:items-end md:justify-between md:p-10"
          >
            <p className="masthead text-[18vw] text-kapow md:text-[clamp(96px,10vw,150px)]">Series #1 is yours</p>
            <div className="md:max-w-[380px]">
              <p className="text-[15px] leading-relaxed text-soft">
                Nothing has launched yet. Describe a character and pitch the story: for $0.10 in USDC KOMA draws the character sheet,
                mints the Character NFT to you and opens its coin on the curve.
              </p>
              <span className="slant mt-5 h-11 px-6 text-[17px]">
                <IconPlus width={16} height={16} /> Launch the first series
              </span>
            </div>
          </Link>
        </section>
      ) : (
        <section className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12" aria-label="All series">
          <nav className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:gap-6 md:px-0" aria-label="Sort series">
            {SORTS.map((s) => {
              const active = s.key === sort;
              return (
                <Link
                  key={s.key}
                  href={s.key === "trending" ? "/series" : `/series?sort=${s.key}`}
                  scroll={false}
                  aria-current={active ? "true" : undefined}
                  className={`shrink-0 px-3 py-1.5 font-display text-[14px] uppercase tracking-wide md:px-0 ${
                    active ? "bg-paper text-ink md:bg-transparent md:text-paper md:underline md:decoration-kapow md:decoration-[3px] md:underline-offset-[10px]" : "text-mute hover:text-paper"
                  }`}
                >
                  {s.label}
                </Link>
              );
            })}
          </nav>
          <ul className="mt-8 grid gap-x-8 gap-y-12 sm:grid-cols-2 md:mt-10 lg:grid-cols-3">
            {list.map((s, i) => (
              <li key={s.id}>
                <SeriesCard s={s} index={i} priority={i < 3} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
