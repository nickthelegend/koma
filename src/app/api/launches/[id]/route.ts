import { NextResponse, type NextRequest } from "next/server";
import { getLaunchJob } from "@/lib/server/launchpad/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/launches/[id]">) {
  const job = getLaunchJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such launch" }, { status: 404 });
  return NextResponse.json({ ...job, nonce: undefined }, { headers: { "Cache-Control": "no-store" } });
}
