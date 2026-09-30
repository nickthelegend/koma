import { NextResponse, type NextRequest } from "next/server";
import { graduate, reason } from "@/lib/server/launchpad/relay";
import { seriesRow } from "@/lib/server/launchpad/queries";

export const dynamic = "force-dynamic";

/** POST /api/series/[id]/graduate — anyone can ask; the keeper also does it on its own. */
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/series/[id]/graduate">) {
  const id = Number((await ctx.params).id);
  const s = seriesRow(id);
  if (!s) return NextResponse.json({ error: "No such series" }, { status: 404 });
  if (s.graduated) return NextResponse.json({ error: "Already graduated" }, { status: 409 });
  if (!s.complete) return NextResponse.json({ error: "The curve hasn't reached its target yet" }, { status: 409 });
  try {
    return NextResponse.json({ txHash: await graduate(id) });
  } catch (e) {
    return NextResponse.json({ error: reason(e) }, { status: 502 });
  }
}
