import { NextResponse, type NextRequest } from "next/server";
import { facilitator } from "@/lib/server/x402";

/** Standard x402 facilitator /settle for Arbitrum. KOMA pays the gas. */
export async function POST(req: NextRequest) {
  if (!facilitator) return NextResponse.json({ error: "Facilitator not configured" }, { status: 503 });
  const { paymentPayload, paymentRequirements } = await req.json();
  try {
    return NextResponse.json(await facilitator.settle(paymentPayload, paymentRequirements));
  } catch (e) {
    return NextResponse.json({ success: false, errorReason: (e as Error).message, transaction: "", network: paymentRequirements?.network }, { status: 400 });
  }
}
