import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { USDC_DECIMALS, USDC_DOMAIN } from "@/lib/network";
import type { LaunchJob } from "@/lib/launchpad/types";
import { config } from "@/lib/server/config";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { saveLaunchJob } from "@/lib/server/launchpad/db";
import { LAUNCH_PRICE_USDC, parseLaunch } from "@/lib/server/launchpad/launch";
import { listSeries } from "@/lib/server/launchpad/queries";
import { network, pendingByNonce, resourceServer } from "@/lib/server/x402";
import { assertBudget, BudgetExceededError, estimate } from "@/lib/server/budget";
import { FAL_DOWN_MESSAGE, falHealth } from "@/lib/server/fal-health";

export const dynamic = "force-dynamic";

async function create(req: NextRequest): Promise<NextResponse> {
  const parsed = parseLaunch(await req.json());
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const header = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
  const payment = decodePaymentSignatureHeader(header!);
  const auth = (payment.payload as { authorization?: { from: `0x${string}`; nonce: `0x${string}`; validBefore: string } }).authorization;
  if (!auth) return NextResponse.json({ error: "Only USDC transfer authorizations (EIP-3009) are accepted." }, { status: 400 });
  const now = new Date().toISOString();
  const job: LaunchJob = {
    id: randomBytes(5).toString("hex"),
    stage: "settling",
    payer: auth.from,
    nonce: auth.nonce,
    validBefore: Number(auth.validBefore),
    request: parsed.request,
    createdAt: now,
    updatedAt: now,
  };
  saveLaunchJob(job);
  pendingByNonce.set(auth.nonce, { launch: job });
  return NextResponse.json({ jobId: job.id, status: `/api/launches/${job.id}` }, { status: 202 });
}

let paidHandler: ((req: NextRequest) => Promise<NextResponse>) | null = null;
const paid = (req: NextRequest) =>
  (paidHandler ??= withX402(
    create,
    {
      accepts: {
        scheme: "exact",
        network,
        payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
        price: { amount: String(Math.round(LAUNCH_PRICE_USDC * 10 ** USDC_DECIMALS)), asset: config.network.usdc, extra: { ...USDC_DOMAIN } },
        maxTimeoutSeconds: 300,
      },
      description: "Launch a KOMA series: an AI character sheet, a Character NFT with its own wallet, and a Series Coin on a USDC bonding curve.",
      mimeType: "application/json",
    },
    resourceServer,
  ))(req);

/** POST /api/series { name, symbol, characterName, characterPrompt, pitch, genre?, parentSeriesId?, demo? } → 402, then 202 { jobId }. */
export async function POST(req: NextRequest) {
  if (config.missing.length) return NextResponse.json({ error: `Launchpad offline: server missing ${config.missing.join(", ")}` }, { status: 503 });
  if (!launchpad()) return NextResponse.json({ error: "The launchpad isn't deployed on this network yet." }, { status: 503 });
  const parsed = parseLaunch(await req.clone().json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await falHealth()).ok) return NextResponse.json({ error: FAL_DOWN_MESSAGE }, { status: 503 });
  try {
    assertBudget(estimate.sheet());
  } catch (e) {
    if (e instanceof BudgetExceededError) return NextResponse.json({ error: "The studio has drawn its fill for today. Come back tomorrow (UTC)." }, { status: 503 });
    throw e;
  }
  return paid(req);
}

/** GET /api/series → every launched series, most recently active first. */
export async function GET() {
  if (!launchpad()) return NextResponse.json({ series: [], deployed: false });
  return NextResponse.json({ series: listSeries(), deployed: true }, { headers: { "Cache-Control": "no-store" } });
}
