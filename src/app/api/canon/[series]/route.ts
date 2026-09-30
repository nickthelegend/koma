import { NextResponse, type NextRequest } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { canonView, seriesRow } from "@/lib/server/launchpad/queries";

export const dynamic = "force-dynamic";

/** GET /api/canon/[series] — open episode, proposals with live tallies, canon so far, and every signed vote. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/canon/[series]">) {
  const id = Number((await ctx.params).series);
  if (!launchpad() || !seriesRow(id)) return NextResponse.json({ error: "No such series" }, { status: 404 });
  return NextResponse.json(await canonView(id), { headers: { "Cache-Control": "no-store" } });
}
