import { NextResponse, type NextRequest } from "next/server";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { seriesDetail } from "@/lib/server/launchpad/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/series/[id]">) {
  const id = Number((await ctx.params).id);
  if (!launchpad() || !Number.isInteger(id) || id < 1) return NextResponse.json({ error: "No such series" }, { status: 404 });
  const s = await seriesDetail(id);
  if (!s) return NextResponse.json({ error: "No such series" }, { status: 404 });
  return NextResponse.json(s, { headers: { "Cache-Control": "no-store" } });
}
