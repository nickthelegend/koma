import type { Metadata } from "next";
import Link from "next/link";
import { findComic } from "@/lib/catalog";
import { GENRES } from "@/lib/studio-config";
import type { Genre } from "@/lib/types";
import { Studio } from "@/components/studio/studio";
import { episodeSeries } from "../series";

export const metadata: Metadata = {
  title: "New issue (form)",
  description: "Describe a story, pick a style and cast, and pay a few cents of USDC on Arbitrum to get a finished, minted comic.",
};

export default async function FormPage({ searchParams }: PageProps<"/create/form">) {
  const sp = await searchParams;
  const remix = typeof sp.remix === "string" ? ((await findComic(sp.remix)) ?? undefined) : undefined;
  const genre = GENRES.find((g) => g === sp.genre) as Genre | undefined;
  const job = typeof sp.job === "string" ? sp.job : undefined;
  const series = episodeSeries(sp.series);
  if (series) {
    return (
      <>
        <p className="mx-auto max-w-[1320px] px-4 pt-4 text-right text-[13px] md:px-8">
          <Link href={`/create?series=${series.id}`} className="text-mute hover:text-paper">
            Talk it through with the editor instead
          </Link>
        </p>
        <Studio key={`series-${series.id}`} series={series} genre={genre} job={job} />
      </>
    );
  }
  return (
    <>
      <p className="mx-auto max-w-[1320px] px-4 pt-4 text-right text-[13px] md:px-8">
        <Link href={remix ? `/create?remix=${remix.id}` : genre ? `/create?genre=${genre}` : "/create"} className="text-mute hover:text-paper">
          Talk it through with the editor instead
        </Link>
      </p>
      <Studio key={remix?.id ?? "new"} remix={remix} genre={genre} job={job} />
    </>
  );
}
