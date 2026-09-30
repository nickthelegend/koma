import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/server/config";
import { listIssues } from "@/lib/server/store";

/** ERC-721 metadata for KomaIssues.tokenURI(id). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/tokens/[id]">) {
  const tokenId = Number((await ctx.params).id);
  const c = (await listIssues()).find((i) => i.chain.tokenId === tokenId);
  if (!c) return NextResponse.json({ error: "Unknown token" }, { status: 404 });
  const base = config.publicUrl;
  return NextResponse.json({
    name: `${c.title} · KOMA #${tokenId}`,
    description: c.logline,
    image: `${base}${c.cover}`,
    external_url: `${base}/c/${c.id}`,
    attributes: [
      { trait_type: "Genre", value: c.genre },
      { trait_type: "Style", value: c.style },
      { trait_type: "Pages", value: c.pageCount, display_type: "number" },
      { trait_type: "Paid (USDC)", value: c.chain.paidUsdc },
      ...(c.remixOf ? [{ trait_type: "Remix of", value: c.remixOf.title }] : []),
    ],
    content_hash: c.chain.contentHash,
    payment_tx: c.chain.paymentTx,
  });
}
