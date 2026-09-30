import { NextRequest, NextResponse } from "next/server";
import { POST as launch } from "../route";

export const dynamic = "force-dynamic";

/** POST /api/series/quote — the launch's x402 requirements as a 200 (see /api/comics/quote). */
export async function POST(req: NextRequest) {
  const probe = new NextRequest(new URL("/api/series", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: await req.text(),
  });
  const res = await launch(probe);
  if (res.status !== 402) return res;
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return NextResponse.json({ error: "Quote unavailable" }, { status: 502 });
  return NextResponse.json({ x402: "PAYMENT-REQUIRED" }, { status: 200, headers: { "PAYMENT-REQUIRED": header, "Cache-Control": "no-store" } });
}
