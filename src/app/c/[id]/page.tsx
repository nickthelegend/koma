import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allComics, findComic } from "@/lib/catalog";
import { ChainProof } from "@/components/chain-proof";
import { ShareButton } from "@/components/share-button";
import { CoverCard } from "@/components/cover-card";
import { IconBook, IconRemix, IconBack } from "@/components/icons";
import { ago, plural, short } from "@/lib/format";
import { canonStatusOfIssue } from "@/lib/server/launchpad/queries";

export async function generateMetadata({ params }: PageProps<"/c/[id]">): Promise<Metadata> {
  const c = await findComic((await params).id);
  if (!c) return {};
  return {
    title: c.title,
    description: c.logline,
    openGraph: { title: `${c.title} — a KOMA comic`, description: c.logline, images: [c.cover] },
    twitter: { card: "summary_large_image" },
  };
}

export const dynamic = "force-dynamic";

export default async function IssuePage({ params }: PageProps<"/c/[id]">) {
  const comic = await findComic((await params).id);
  if (!comic) notFound();
  const comics = await allComics();
  // The index knows the episode's fate; an untagged issue can still have been proposed on-chain.
  const canon = comic.chain?.tokenId ? canonStatusOfIssue(comic.chain.tokenId) : null;
  const episode = canon ?? (comic.series ? { seriesId: comic.series.id, name: comic.series.name, symbol: comic.series.symbol, episode: 0, status: "voting" as const } : null);
  const more = comics.filter((c) => c.id !== comic.id && c.genre === comic.genre).concat(comics.filter((c) => c.genre !== comic.genre)).slice(0, 4);

  return (
    <>
      <section className="relative isolate overflow-hidden">
        {/* Poster wash in the issue's own color, printed through a halftone screen */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[62%] md:h-full md:w-[46%]" style={{ background: comic.tone }}>
          <div className="halftone absolute inset-0 text-black/25" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-ink md:bg-gradient-to-r md:via-transparent" />
        </div>

        <div className="mx-auto grid max-w-[1320px] gap-8 px-4 pb-6 pt-5 md:grid-cols-[minmax(0,420px)_1fr] md:gap-16 md:px-8 md:py-14">
          <div>
            <Link href="/" className="mb-5 inline-flex items-center gap-1.5 bg-ink px-2.5 py-1.5 text-[13px] font-semibold text-paper hover:text-kapow md:mb-8">
              <IconBack width={16} height={16} /> Catalog
            </Link>
            <div className="relative mx-auto w-[72%] max-w-[360px] md:w-full" style={{ rotate: "-2deg" }}>
              <span className="tape -top-3 left-1/2 -translate-x-1/2 rotate-3" />
              <div className="relative aspect-[3/4] overflow-hidden shadow-[0_30px_50px_-15px_rgba(0,0,0,0.85)]">
                <Image src={comic.cover} alt={`Cover of ${comic.title}`} fill priority sizes="(min-width: 768px) 420px, 72vw" className="object-cover" />
              </div>
            </div>
          </div>

          <div className="md:pt-20">
            {episode && (
              <Link
                href={`/s/${episode.seriesId}`}
                className={`mb-3 inline-flex items-center gap-1.5 px-2 py-1 font-display text-[13px] uppercase tracking-wide text-ink hover:bg-paper ${episode.status === "alternate" ? "bg-soft" : "bg-kapow"}`}
              >
                {episode.status === "canon"
                  ? `Canon · episode ${episode.episode} of ${episode.name}`
                  : episode.status === "alternate"
                    ? `Alternate universe · ${episode.name}, episode ${episode.episode}`
                    : `Episode ${episode.episode ? `${episode.episode} ` : ""}proposal · ${episode.name}`}{" "}
                <span className="font-mono text-[11.5px] normal-case">${episode.symbol}</span>
              </Link>
            )}
            <p className="text-[13px] text-soft">
              {comic.genre}{comic.style !== comic.genre ? ` · ${comic.style}` : ""} · {plural(comic.pageCount, "page")}
            </p>
            <h1 className="masthead mt-2 text-[20vw] text-paper md:text-[clamp(84px,9vw,148px)]">{comic.title}</h1>
            <p className="mt-4 max-w-[52ch] text-[16px] leading-relaxed text-soft md:text-[17px]">{comic.logline}</p>
            {comic.cast && <p className="mt-3 text-[13px] text-soft">Starring {comic.cast.join(" and ")}</p>}
            {comic.remixOf && (
              <p className="mt-3 flex items-center gap-1.5 text-[13px] text-soft">
                <IconRemix width={14} height={14} /> Remix of{" "}
                <Link href={`/c/${comic.remixOf.id}`} className="font-semibold text-paper underline decoration-kapow underline-offset-4">
                  {comic.remixOf.title}
                </Link>
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-mute">
              <span>
                Made by <span className="font-semibold text-paper">{comic.creator.name}</span>{" "}
                {!comic.creator.name.startsWith("0x") && <span className="font-mono text-[12px]">{short(comic.creator.address)}</span>}
              </span>
              <span>{ago(comic.createdAt)}</span>
              <span>{plural(comic.reads, "read")}</span>
              <span>{plural(comic.remixes, "remix", "remixes")}</span>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={`/c/${comic.id}/read`} className="slant h-12 px-8 text-[21px]">
                <IconBook width={19} height={19} /> Read now
              </Link>
              <Link
                href={`/create?remix=${comic.id}`}
                className="flex h-12 items-center gap-2 border-2 border-paper/80 px-4 font-display text-[16px] uppercase text-paper hover:bg-paper hover:text-ink"
              >
                <IconRemix width={17} height={17} /> Remix · ${comic.priceUsdc}
              </Link>
              <ShareButton title={comic.title} path={`/c/${comic.id}`} />
            </div>

            <div className="mt-10 max-w-[560px]">
              <ChainProof chain={comic.chain} />
            </div>
          </div>
        </div>
      </section>

      {comic.pages && (
        <section className="mx-auto mt-10 max-w-[1320px] px-4 md:mt-16 md:px-8" aria-labelledby="inside">
          <h2 id="inside" className="masthead text-[44px] text-paper md:text-[64px]">Inside</h2>
          <ul className="no-scrollbar -mx-4 mt-5 flex snap-x gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
            {comic.pages.flatMap((pg) => pg.panels).map((p, i) => (
              <li key={i} className={`relative shrink-0 snap-start overflow-hidden border-[3px] border-paper ${p.shape === "wide" ? "aspect-[16/9] w-[78vw] md:w-[420px]" : "aspect-square w-[44vw] md:w-[236px]"}`}>
                <Link href={`/c/${comic.id}/read#p${Math.floor(i / 4) + 1}`} aria-label={`Jump to page ${Math.floor(i / 4) + 1}`}>
                  <Image src={p.img} alt={p.alt} fill sizes="420px" className="object-cover" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto mt-16 max-w-[1320px] px-4 md:px-8" aria-labelledby="more">
        <h2 id="more" className="masthead text-[44px] text-paper md:text-[64px]">More on the rack</h2>
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 md:gap-x-8">
          {more.map((c, i) => (
            <li key={c.id}>
              <CoverCard comic={c} index={i + 1} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
