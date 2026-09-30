import { NextResponse, type NextRequest } from "next/server";
import { isAddress, isHex } from "viem";
import { clientIp } from "@/lib/server/client-ip";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { reason, relayBuy, relaySell, relaySwapBuy, type BuyIntent, type SellIntent, type SwapBuyIntent } from "@/lib/server/launchpad/relay";
import { limited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const uint = (x: unknown) => typeof x === "string" && /^\d{1,78}$/.test(x);

/**
 * POST /api/trade/relay — submit a signed, gasless curve trade. The signatures
 * commit to amount, minimum out and deadline, so the relayer can only send it
 * as-is or not at all.
 */
export async function POST(req: NextRequest) {
  if (!launchpad()) return NextResponse.json({ error: "The launchpad isn't deployed on this network yet." }, { status: 503 });
  if (limited(`relay:${clientIp(req)}`, 10 * 60_000, 40) || limited("relay:all", 60 * 60_000, Number(process.env.KOMA_RELAY_PER_HOUR ?? 1500))) {
    return NextResponse.json({ error: "Too many trades from here. Try again in a few minutes." }, { status: 429 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (b?.kind === "buy") {
      const ok = isAddress(String(b.curve)) && isAddress(String(b.buyer)) && [b.usdcIn, b.minCoinOut, b.deadline, b.validAfter, b.validBefore].every(uint) && isHex(b.salt) && isHex(b.signature);
      if (!ok) return NextResponse.json({ error: "Malformed buy intent." }, { status: 400 });
      return NextResponse.json({ txHash: await relayBuy(b as unknown as BuyIntent) });
    }
    if (b?.kind === "sell") {
      const ok = isAddress(String(b.curve)) && isAddress(String(b.seller)) && [b.coinIn, b.minUsdcOut, b.deadline].every(uint) && isHex(b.permit) && isHex(b.intentSignature);
      if (!ok) return NextResponse.json({ error: "Malformed sell intent." }, { status: 400 });
      return NextResponse.json({ txHash: await relaySell(b as unknown as SellIntent) });
    }
    if (b?.kind === "swap-buy") {
      const ok = Number.isInteger(b.seriesId) && isAddress(String(b.buyer)) && [b.usdcIn, b.minCoinOut, b.deadline, b.validAfter, b.validBefore].every(uint) && isHex(b.salt) && isHex(b.signature);
      if (!ok) return NextResponse.json({ error: "Malformed swap intent." }, { status: 400 });
      return NextResponse.json({ txHash: await relaySwapBuy(b as unknown as SwapBuyIntent) });
    }
    return NextResponse.json({ error: 'kind must be "buy", "sell" or "swap-buy".' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: reason(e) }, { status: 422 });
  }
}
