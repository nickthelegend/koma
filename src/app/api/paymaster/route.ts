import { NextResponse, type NextRequest } from "next/server";
import { clientIp } from "@/lib/server/client-ip";
import { config } from "@/lib/server/config";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { db } from "@/lib/server/launchpad/db";
import { limited } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

// ERC-7677 paymaster service for wallets that support EIP-5792 `wallet_sendCalls`
// with the `paymasterService` capability (e.g. Coinbase Smart Wallet). The wallet
// calls this URL; we forward to Pimlico with the server-side API key, so the key
// never reaches the browser. Only KOMA's own contracts get sponsored.
const METHODS = new Set(["pm_getPaymasterStubData", "pm_getPaymasterData"]);

function sponsoredTargets(): string[] {
  const a = launchpad();
  if (!a) return [];
  const curves = (db().prepare("SELECT curve, coin FROM lp_series").all() as { curve: string; coin: string }[]).flatMap((r) => [r.curve, r.coin]);
  return [config.network.usdc, a.swapper, ...curves].filter(Boolean).map((x) => x.toLowerCase().slice(2));
}

/**
 * Smart-account callData encodings differ per wallet, so this is a coarse
 * filter: the operation must name at least one KOMA contract. Pimlico's
 * sponsorship policy (PIMLICO_POLICY_ID) caps spend on top of it.
 */
function touchesKoma(callData: string) {
  const hay = callData.toLowerCase();
  return sponsoredTargets().some((t) => hay.includes(t));
}

export async function POST(req: NextRequest) {
  const key = process.env.PIMLICO_API_KEY;
  if (!key) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Gas sponsorship isn't configured on this server." } }, { status: 503 });
  if (limited(`pm:${clientIp(req)}`, 10 * 60_000, 60) || limited("pm:all", 60 * 60_000, Number(process.env.KOMA_PAYMASTER_PER_HOUR ?? 600))) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "Too many sponsored transactions. Try again later." } }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown; method?: string; params?: unknown[] } | null;
  const id = body?.id ?? null;
  const fail = (message: string, code = -32602) => NextResponse.json({ jsonrpc: "2.0", id, error: { code, message } });
  if (!body?.method || !METHODS.has(body.method) || !Array.isArray(body.params)) return fail("Only pm_getPaymasterStubData and pm_getPaymasterData are served.", -32601);
  const [userOp, , chainId] = body.params as [{ callData?: string }, string, string];
  if (Number(chainId) !== config.network.chain.id) return fail(`Only chain ${config.network.chain.id} is sponsored.`);
  if (!userOp?.callData || !touchesKoma(userOp.callData)) return fail("Only trades with KOMA contracts are sponsored.");
  const context = process.env.PIMLICO_POLICY_ID ? { sponsorshipPolicyId: process.env.PIMLICO_POLICY_ID } : {};
  const params = [...body.params.slice(0, 3), { ...((body.params[3] as object) ?? {}), ...context }];
  const res = await fetch(`https://api.pimlico.io/v2/${config.network.chain.id}/rpc?apikey=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: body.method, params }),
  });
  return NextResponse.json(await res.json(), { status: res.ok ? 200 : 502 });
}
