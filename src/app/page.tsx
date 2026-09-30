import Image from "next/image";
import Link from "next/link";
import { genres } from "@/lib/studio-config";
import { allComics, spotlight } from "@/lib/catalog";
import { CoverCard } from "@/components/cover-card";
import { ReceiptsTicker } from "@/components/receipts-ticker";
import { IconBook, IconRemix, IconSearch, IconPen } from "@/components/icons";
import { plural } from "@/lib/format";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { listSeries } from "@/lib/server/launchpad/queries";
import { SeriesCard } from "@/components/launchpad/series-card";

export const dynamic = "force-dynamic";

export default async function Catalog({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const comics = await allComics();
  const genre = typeof sp.genre === "string" && genres.includes(sp.genre as never) ? sp.genre : "All";
  const list = genre === "All" ? comics : comics.filter((c) => c.genre === genre);
  const featured = spotlight(comics);
  const hero = featured?.pages?.[0]?.panels[0];
  const series = launchpad() ? listSeries().slice(0, 6) : [];

  return (
    <>
      {/* ——— Masthead ——— */}
      <section className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
        <div className="grid items-end gap-6 md:grid-cols-[auto_1fr] md:gap-12">
          <h1 className="masthead text-[27vw] text-kapow md:text-[clamp(150px,17vw,236px)]">Catalog</h1>
          <div className="flex flex-col gap-5 md:pb-3">
            <form action="/search" className="flex items-center gap-2.5 border-b border-soft/60 pb-2.5 focus-within:border-paper">
              <IconSearch width={17} height={17} className="text-soft" />
              <label htmlFor="q" className="sr-only">Search comics</label>
              <input
                id="q"
                name="q"
                placeholder="Search titles, makers, genres"
                className="w-full bg-transparent font-display text-[15px] uppercase tracking-wide text-paper placeholder:text-mute focus:outline-none"
              />
            </form>
            <p className="max-w-[46ch] text-[14px] leading-relaxed text-soft">
              Every issue here was written and drawn by AI from one person&rsquo;s prompt, paid for in cents of USDC,
              and minted to them on Arbitrum. Read any of them free. Remix the ones you love.
            </p>
          </div>
        </div>
      </section>

      {/* ——— Spotlight ——— */}
      {featured ? (
        <>
          <section className="mx-auto mt-8 max-w-[1320px] px-4 md:mt-12 md:px-8" aria-labelledby="spotlight">
            <div className="relative isolate overflow-hidden bg-kapow md:min-h-[440px]">
              <div className="relative aspect-[16/10] w-full md:absolute md:inset-y-0 md:right-0 md:aspect-auto md:w-[64%]">
                <Image src={hero?.img || featured.cover} alt={hero?.alt ?? `Cover of ${featured.title}`} fill priority sizes="(min-width: 768px) 64vw, 100vw" className="object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-kapow via-transparent to-transparent md:bg-gradient-to-r md:from-kapow md:via-kapow/10 md:to-transparent" />
              </div>
              <div className="halftone pointer-events-none absolute inset-0 text-black/25 [mask-image:linear-gradient(180deg,transparent_35%,#000_60%)] md:[mask-image:linear-gradient(90deg,#000_30%,transparent_55%)]" aria-hidden />
              <div className="relative -mt-16 px-5 pb-6 md:mt-0 md:flex md:min-h-[440px] md:max-w-[46%] md:flex-col md:justify-end md:p-10">
                <p className="text-[13px] font-semibold text-ink/75">{featured.reads > 0 ? "Most read on KOMA" : "Latest issue"}</p>
                <h2 id="spotlight" className="masthead mt-1 text-[19vw] text-ink md:text-[clamp(88px,9vw,132px)]">
                  {featured.title}
                </h2>
                <p className="mt-3 max-w-[40ch] text-[15px] font-medium leading-snug text-ink">{featured.logline}</p>
                <p className="mt-3 text-[12.5px] text-ink/70">
                  {plural(featured.pageCount, "page")} by {featured.creator.name} · {plural(featured.reads, "read")} · {plural(featured.remixes, "remix", "remixes")}
                </p>
                <div className="mt-6 flex items-center gap-3">
                  <Link href={`/c/${featured.id}/read`} className="slant h-12 px-7 text-[20px] [--kapow-deep:#000] ![background:#000]">
                    <IconBook width={18} height={18} />
                    Read now
                  </Link>
                  <Link href={`/create?remix=${featured.id}`} className="flex h-12 items-center gap-2 border-2 border-ink px-4 font-display text-[16px] uppercase text-ink hover:bg-ink hover:text-kapow">
                    <IconRemix width={17} height={17} />
                    Remix
                  </Link>
                </div>
              </div>
            </div>
          </section>

          <div className="mt-10 md:mt-14">
            <ReceiptsTicker />
          </div>
        </>
      ) : (
        <FirstIssue />
      )}

      {/* ——— Series on the curve ——— */}
      {series.length > 0 && (
        <section className="mx-auto max-w-[1320px] px-4 pt-10 md:px-8 md:pt-14" aria-labelledby="series-strip">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="series-strip" className="masthead text-[13vw] text-paper md:text-[clamp(64px,6vw,92px)]">Series on the curve</h2>
              <p className="mt-2 max-w-[52ch] text-[14px] leading-relaxed text-soft">
                Characters with their own wallets and coins. Holders vote on which episode becomes canon.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/series" className="font-display text-[15px] uppercase tracking-wide text-soft underline decoration-kapow decoration-[3px] underline-offset-[8px] hover:text-paper">
                All series
              </Link>
              <Link href="/launch" className="slant h-10 px-5 text-[15px]">Launch one</Link>
            </div>
          </div>
          <ul className="no-scrollbar -mx-4 mt-8 flex snap-x gap-6 overflow-x-auto px-4 pb-4 pt-2 md:mx-0 md:grid md:grid-cols-3 md:gap-8 md:overflow-visible md:px-0">
            {series.map((x, i) => (
              <li key={x.id} className="w-[82vw] max-w-[400px] shrink-0 snap-start md:w-auto md:max-w-none">
                <SeriesCard s={x} index={i} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ——— Rack ——— */}
      {comics.length > 0 && (
        <section className="mx-auto max-w-[1320px] px-4 pt-8 md:px-8 md:pt-12" aria-label="All issues">
          <div className="flex items-center gap-4">
            <nav className="no-scrollbar -mx-4 flex flex-1 gap-1 overflow-x-auto px-4 md:mx-0 md:gap-6 md:px-0" aria-label="Genres">
              {genres.map((g) => {
                const active = g === genre;
                return (
                  <Link
                    key={g}
                    href={g === "All" ? "/" : `/?genre=${g}`}
                    scroll={false}
                    aria-current={active ? "true" : undefined}
                    className={`shrink-0 px-3 py-1.5 font-display text-[14px] uppercase tracking-wide md:px-0 ${
                      active ? "bg-paper text-ink md:bg-transparent md:text-paper md:underline md:decoration-kapow md:decoration-[3px] md:underline-offset-[10px]" : "text-mute hover:text-paper"
                    }`}
                  >
                    {g === "All" ? "All issues" : g}
                  </Link>
                );
              })}
            </nav>
            <Link href="/create" className="slant hidden h-9 px-5 text-[14px] md:inline-flex">
              <IconPen width={15} height={15} />
              Make one
            </Link>
          </div>

          {list.length === 0 ? (
            <div className="mt-16 border border-dashed border-rule px-6 py-16 text-center">
              <p className="font-display text-3xl uppercase text-paper">No {genre} issues yet</p>
              <p className="mt-2 text-[14px] text-mute">Be the first to put one on the rack.</p>
              <Link href={`/create?genre=${genre}`} className="slant mt-6 h-11 px-6 text-[17px]">Make a {genre} comic</Link>
            </div>
          ) : (
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:mt-10 md:gap-x-8 md:gap-y-14 lg:grid-cols-4">
              {list.map((c, i) => (
                <li key={c.id}>
                  <CoverCard comic={c} index={i} priority={i < 4} />
                </li>
              ))}
              {genre === "All" && (
                <li className="col-span-full">
                  <MakeYourOwn />
                </li>
              )}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function MakeYourOwn() {
  return (
    <Link
      href="/create"
      className="group relative flex flex-col justify-between gap-6 overflow-hidden border-2 border-dashed border-kapow/70 p-5 hover:border-kapow md:flex-row md:items-end md:p-8"
    >
      <p className="masthead text-[64px] text-kapow md:text-[clamp(84px,9vw,132px)]">Your issue here</p>
      <div className="md:max-w-[340px]">
        <p className="text-[13.5px] leading-snug text-soft">Describe a story. Pay $0.10 a page. It&rsquo;s drawn, lettered and minted to you in about a minute.</p>
        <span className="slant mt-4 h-10 px-5 text-[15px]">
          <IconPen width={15} height={15} />
          Start drawing
        </span>
      </div>
    </Link>
  );
}

function FirstIssue() {
  return (
    <section className="mx-auto mt-8 max-w-[1320px] px-4 md:mt-12 md:px-8">
      <Link
        href="/create"
        className="group flex flex-col gap-6 border-2 border-dashed border-kapow/70 p-6 hover:border-kapow md:flex-row md:items-end md:justify-between md:p-10"
      >
        <p className="masthead text-[18vw] text-kapow md:text-[clamp(96px,10vw,150px)]">Issue #1 is yours</p>
        <div className="md:max-w-[360px]">
          <p className="text-[15px] leading-relaxed text-soft">
            The rack is empty. Describe a story, pay $0.10 a page in USDC, and the first comic on KOMA is drawn, lettered and minted to
            you.
          </p>
          <span className="slant mt-5 h-11 px-6 text-[17px]">
            <IconPen width={16} height={16} />
            Make the first one
          </span>
        </div>
      </Link>
    </section>
  );
}
