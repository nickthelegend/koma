import { NextResponse } from "next/server";
import { facilitator } from "@/lib/server/x402";

export async function GET() {
  if (!facilitator) return NextResponse.json({ error: "Facilitator not configured" }, { status: 503 });
  return NextResponse.json(facilitator.getSupported());
}
