import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/server/config";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { db } from "@/lib/server/launchpad/db";
import { seriesRow } from "@/lib/server/launchpad/queries";

export const dynamic = "force-dynamic";

/** ERC-721 metadata for CharacterNFT.tokenURI(id): the character sheet and its series. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/characters/[id]">) {
  const id = Number((await ctx.params).id);
  const row = launchpad() && Number.isInteger(id) ? (db().prepare("SELECT id FROM lp_series WHERE character_id = ?").get(id) as { id: number } | undefined) : undefined;
  const s = row ? seriesRow(row.id) : null;
  if (!s) return NextResponse.json({ error: "Unknown character" }, { status: 404 });
  const base = config.publicUrl;
  const name = s.character_name ?? s.name;
  return NextResponse.json({
    name: `${name} · KOMA Character #${id}`,
    description: `Lead of the KOMA series "${s.name}" ($${s.symbol}). ${s.character_prompt ?? ""}`.trim(),
    image: s.sheet ? `${base}${s.sheet}` : undefined,
    external_url: `${base}/s/${s.id}`,
    attributes: [
      { trait_type: "Series", value: s.name },
      { trait_type: "Ticker", value: s.symbol },
      { trait_type: "Character wallet (ERC-6551)", value: s.character_account },
      ...(s.parent_id ? [{ trait_type: "Remix of series", value: s.parent_id, display_type: "number" }] : []),
    ],
  });
}
