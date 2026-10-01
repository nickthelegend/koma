import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { withX402 } from "@x402/next";
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { pagePrice, parseOrder } from "@/lib/order";
import { USDC_DECIMALS, USDC_DOMAIN } from "@/lib/network";
import { config, publicClient } from "@/lib/server/config";
import { listIssues, saveJob } from "@/lib/server/store";
import { network, pendingByNonce, resourceServer } from "@/lib/server/x402";
import { assertBudget, BudgetExceededError, estimate } from "@/lib/server/budget";
import { canPropose } from "@/lib/server/launchpad/canon";
import { FAL_DOWN_MESSAGE, falHealth } from "@/lib/server/fal-health";
import type { Job } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The paid part: runs only after the x402 payment verifies; it settles when this returns < 400. */
async function create(req: NextRequest): Promise<NextResponse> {
  const parsed = parseOrder(await req.json());
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const header = req.headers.get("PAYMENT-SIGNATURE") ?? req.headers.get("X-PAYMENT");
  const payment = decodePaymentSignatureHeader(header!);
  const auth = (payment.payload as { authorization?: { from: `0x${string}`; value: string; nonce: string; validBefore: string } }).authorization;
  if (!auth) return NextResponse.json({ error: "Only USDC transfer authorizations (EIP-3009) are accepted." }, { status: 400 });
  // Refusing here (before settlement) means no USDC moves for a proposal the canon registry would reject.
  if (parsed.order.seriesId) {
    const ok = await canPropose(parsed.order.seriesId, auth.from);
    if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 403 });
  }

  const now = new Date().toISOString();
  const job: Job = {
    id: randomBytes(5).toString("hex"),
    stage: "settling",
    order: parsed.order,
    payer: auth.from,
    nonce: auth.nonce as `0x${string}`,
    validBefore: Number(auth.validBefore),
    sinceBlock: Number(await publicClient.getBlockNumber()),
    amountUsdc: (Number(auth.value) / 1e6).toFixed(2),
    network: config.network.key,
    pages: [],
    drawn: 0,
    total: parsed.order.pages * 4,
    createdAt: now,
    updatedAt: now,
  };
  await saveJob(job);
  pendingByNonce.set(auth.nonce, { job });
  return NextResponse.json({ jobId: job.id, status: `/api/jobs/${job.id}`, issue: `/c/${job.id}` }, { status: 202 });
}

// Built on the first request so the facilitator sync happens at runtime, never
// at import time (next build) or on a server that isn't configured yet.
let paidHandler: ((req: NextRequest) => Promise<NextResponse>) | null = null;
const paid = (req: NextRequest) => (paidHandler ??= makePaid())(req);

const makePaid = () =>
  withX402(
    create,
    {
      accepts: {
        scheme: "exact",
        network,
        payTo: config.payTo ?? "0x0000000000000000000000000000000000000000",
        // Priced in USDC atomic units with the asset spelled out, so it works on any
        // Arbitrum network KOMA runs on, including the localnet.
        price: async (ctx) => {
          const parsed = parseOrder(await ctx.adapter.getBody?.());
          const pages = "order" in parsed ? parsed.order.pages : 1;
          const episode = "order" in parsed && Boolean(parsed.order.seriesId);
          return {
            amount: String(Math.round(pages * pagePrice(episode) * 10 ** USDC_DECIMALS)),
            asset: config.network.usdc,
            extra: { ...USDC_DOMAIN },
          };
        },
        maxTimeoutSeconds: 300,
      },
      description: "One AI-written, AI-drawn comic issue, lettered and minted to the payer on Arbitrum. $0.10 per page; $0.30 per page for a series episode.",
      mimeType: "application/json",
    },
    resourceServer,
  );

/**
 * POST /api/comics  { prompt, pages: 1|2|4|6, style?, cast?, remixOf? }
 * → 402 with the USDC quote, then 202 { jobId } once paid.
 */
export async function POST(req: NextRequest) {
  if (config.missing.length) {
    return NextResponse.json({ error: `Studio offline: server missing ${config.missing.join(", ")}` }, { status: 503 });
  }
  // Reject bad orders before quoting, so nobody signs for a request that can't run.
  const parsed = parseOrder(await req.clone().json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (!(await falHealth()).ok) return NextResponse.json({ error: FAL_DOWN_MESSAGE }, { status: 503 });
  try {
    assertBudget(estimate.comic(parsed.order.pages, { refs: parsed.order.seriesId ? 1 : 0 }));
  } catch (e) {
    if (e instanceof BudgetExceededError) return NextResponse.json({ error: "The studio has drawn its fill for today. Come back tomorrow (UTC)." }, { status: 503 });
    throw e;
  }
  return paid(req);
}

/** GET /api/comics?owner=0x… lists live issues (without pages). */
export async function GET(req: NextRequest) {
  const owner = req.nextUrl.searchParams.get("owner")?.toLowerCase();
  const list = (await listIssues())
    .filter((c) => !owner || c.creator.address.toLowerCase() === owner)
    .map((c) => ({ ...c, pages: undefined }));
  return NextResponse.json({ comics: list });
}
