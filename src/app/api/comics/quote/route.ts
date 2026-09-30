import { NextRequest, NextResponse } from "next/server";
import { POST as comics } from "../route";

export const dynamic = "force-dynamic";

/**
 * POST /api/comics/quote — the same x402 payment requirements POST /api/comics
 * answers with, returned as 200 so browsers don't log the quote as a failed
 * request. It runs the real paid route (without a payment) and hands back its
 * PAYMENT-REQUIRED header untouched.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const probe = new NextRequest(new URL("/api/comics", req.url), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  const res = await comics(probe);
  if (res.status !== 402) return res;
  const header = res.headers.get("PAYMENT-REQUIRED");
  if (!header) return NextResponse.json({ error: "Quote unavailable" }, { status: 502 });
  return NextResponse.json({ x402: "PAYMENT-REQUIRED" }, { status: 200, headers: { "PAYMENT-REQUIRED": header, "Cache-Control": "no-store" } });
}
