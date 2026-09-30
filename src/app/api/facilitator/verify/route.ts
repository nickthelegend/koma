import { NextResponse, type NextRequest } from "next/server";
import { facilitator } from "@/lib/server/x402";

/** Standard x402 facilitator /verify for Arbitrum. */
export async function POST(req: NextRequest) {
  if (!facilitator) return NextResponse.json({ error: "Facilitator not configured" }, { status: 503 });
  const { paymentPayload, paymentRequirements } = await req.json();
  try {
    return NextResponse.json(await facilitator.verify(paymentPayload, paymentRequirements));
  } catch (e) {
    return NextResponse.json({ isValid: false, invalidReason: (e as Error).message }, { status: 400 });
  }
}
