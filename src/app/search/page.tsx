import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { genres } from "@/lib/studio-config";
import { allComics } from "@/lib/catalog";
import { CoverCard } from "@/components/cover-card";
import { IconSearch } from "@/components/icons";

export const metadata: Metadata = { title: "Search" };

export default async function Search({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const needle = q.toLowerCase();
  const comics = await allComics();
  const results = q
    ? comics.filter((c) =>
        [c.title, c.logline, c.genre, c.style, c.creator.name, c.creator.address, ...(c.cast ?? [])].some((f) => f.toLowerCase().includes(needle)),
      )
    : [];

  return (
    <div className="mx-auto max-w-[1320px] px-4 pt-6 md:px-8 md:pt-10">
      <form action="/search" className="flex items-center gap-3 border-b-2 border-paper pb-3">
        <IconSearch width={26} height={26} className="shrink-0 text-kapow" />
        <label htmlFor="sq" className="sr-only">Search comics</label>
        <input
          id="sq"
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Search"
          className="masthead w-full bg-transparent text-[16vw] text-paper placeholder:text-rule focus:outline-none md:text-[120px]"
        />
      </form>

      {q ? (
        <>
          <p className="mt-5 text-[14px] text-mute">
            {results.length} {results.length === 1 ? "issue" : "issues"} for “{q}”
          </p>
          {results.length === 0 ? (
            <div className="mt-10 max-w-md">
              <p className="font-display text-3xl uppercase text-paper">Nobody&rsquo;s drawn that yet</p>
              <p className="mt-2 text-[14px] text-mute">Turn it into the first issue about it.</p>
              <Link href="/create" className="slant mt-6 h-11 px-6 text-[17px]">Make it</Link>
            </div>
          ) : (
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
              {results.map((c, i) => (
                <li key={c.id}>
                  <CoverCard comic={c} index={i} />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h2 className="mt-10 font-display text-[20px] uppercase tracking-wide text-paper">Browse by genre</h2>
          <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {genres.filter((g) => g !== "All").map((g) => {
              const cover = comics.find((c) => c.genre === g)?.cover;
              return (
                <li key={g}>
                  <Link href={`/?genre=${g}`} className="group relative block aspect-[16/10] overflow-hidden bg-stock">
                    {cover && <Image src={cover} alt="" fill sizes="(min-width:768px) 25vw, 50vw" className="object-cover opacity-60 transition-opacity group-hover:opacity-90" />}
                    <span className="masthead absolute bottom-2 left-3 text-[34px] text-paper drop-shadow-[2px_2px_0_#000] md:text-[44px]">{g}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
