import type { Metadata } from "next";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { seriesRow } from "@/lib/server/launchpad/queries";
import { LaunchStudio, type ParentSeries } from "@/components/launchpad/launch-studio";
import { BuiltOnArbitrum } from "@/components/launchpad/built-on-arbitrum";
import { config } from "@/lib/server/config";
import { LAUNCH_PRICE } from "@/lib/network";

export const metadata: Metadata = {
  title: "Launch a series",
  description: `Describe a character and pitch a story. For $${LAUNCH_PRICE} in USDC KOMA draws the character sheet, mints a Character NFT with its own wallet and opens its coin on a curve.`,
};

export const dynamic = "force-dynamic";

export default async function LaunchPage({ searchParams }: PageProps<"/launch">) {
  const sp = await searchParams;
  const lp = launchpad();
  const deployed = lp !== null;
  const parentId = Number(sp.parent);
  const row = deployed && Number.isInteger(parentId) && parentId > 0 ? seriesRow(parentId) : null;
  const parent: ParentSeries | null = row ? { id: row.id, name: row.name, symbol: row.symbol, characterName: row.character_name ?? row.name } : null;
  const job = typeof sp.job === "string" ? sp.job : undefined;
  return (
    <LaunchStudio
      key={parent?.id ?? "new"}
      deployed={deployed}
      parent={parent}
      job={job}
      arbitrum={<BuiltOnArbitrum lp={lp} facilitator={config.account?.address ?? null} />}
    />
  );
}
