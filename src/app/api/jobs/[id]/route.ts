import { NextResponse, type NextRequest } from "next/server";
import { getJob } from "@/lib/server/store";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/jobs/[id]">) {
  const job = await getJob((await ctx.params).id);
  if (!job) return NextResponse.json({ error: "No such job" }, { status: 404 });
  // Internal working state (full shot list, authorization nonce) stays on the server.
  return NextResponse.json({ ...job, work: undefined, nonce: undefined }, { headers: { "Cache-Control": "no-store" } });
}
