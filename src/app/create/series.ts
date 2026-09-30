import type { EpisodeSeries } from "@/components/launchpad/episode-banner";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { seriesRow } from "@/lib/server/launchpad/queries";

/** The launchpad series named by ?series=, if it exists here. */
export function episodeSeries(param: string | string[] | undefined): EpisodeSeries | undefined {
  const id = Number(param);
  if (typeof param !== "string" || !Number.isInteger(id) || id < 1 || !launchpad()) return undefined;
  const r = seriesRow(id);
  return r ? { id: r.id, name: r.name, symbol: r.symbol, characterName: r.character_name ?? r.name } : undefined;
}
