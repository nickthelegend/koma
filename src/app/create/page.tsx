import type { Metadata } from "next";
import { findComic } from "@/lib/catalog";
import { GENRES } from "@/lib/studio-config";
import type { Genre } from "@/lib/types";
import { ChatStudioClient } from "@/components/studio/chat-studio-client";
import { episodeSeries } from "./series";

export const metadata: Metadata = {
  title: "Studio",
  description: "Talk your story through with KOMA's AI editor, then pay a few cents of USDC on Arbitrum and watch it get drawn and minted.",
};

export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const sp = await searchParams;
  const remix = typeof sp.remix === "string" ? ((await findComic(sp.remix)) ?? undefined) : undefined;
  const job = typeof sp.job === "string" ? sp.job : undefined;
  const genre = GENRES.find((g) => g === sp.genre) as Genre | undefined;
  // ?series= makes the issue an episode proposal for a launchpad series (never also a remix).
  const series = episodeSeries(sp.series);
  if (series) return <ChatStudioClient key={`series-${series.id}`} series={series} job={job} genre={genre} />;
  return <ChatStudioClient key={remix?.id ?? "new"} remix={remix} job={job} genre={genre} />;
}
