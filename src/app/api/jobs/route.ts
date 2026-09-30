import { NextResponse, type NextRequest } from "next/server";
import { unfinishedJobs } from "@/lib/server/store";

export const dynamic = "force-dynamic";

/** GET /api/jobs?payer=0x… — that wallet's paid issues still being made. */
export async function GET(req: NextRequest) {
  const payer = req.nextUrl.searchParams.get("payer");
  if (!payer || !/^0x[0-9a-fA-F]{40}$/.test(payer)) return NextResponse.json({ error: "payer must be an address" }, { status: 400 });
  const jobs = (await unfinishedJobs(payer)).map((j) => ({ id: j.id, stage: j.stage, title: j.script?.title ?? null, drawn: j.drawn, total: j.total, createdAt: j.createdAt }));
  return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
}
