import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/lib/server/config";

export const dynamic = "force-dynamic";

// Public JSON-RPC for wallets and explorers. Standard reads plus signed raw
// transactions only: node-admin and cheat methods (anvil_*, evm_*, debug_*),
// unlocked-account signing and account listing never leave the server.
const ALLOWED = new Set([
  "eth_chainId", "net_version", "net_listening", "web3_clientVersion", "eth_syncing",
  "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_call",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_blobBaseFee",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getBlockTransactionCountByNumber",
  "eth_getLogs", "eth_sendRawTransaction",
]);

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

type Call = { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown };

async function forward(call: Call) {
  if (typeof call?.method !== "string" || !ALLOWED.has(call.method)) {
    return { jsonrpc: "2.0", id: call?.id ?? null, error: { code: -32601, message: `Method not available on this public RPC` } };
  }
  const res = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: call.id ?? 1, method: call.method, params: call.params ?? [] }),
  });
  return res.json();
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Call | Call[] | null;
  if (!body) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  if (Array.isArray(body)) {
    if (body.length > 50) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batch too large" } }, { status: 400, headers: CORS });
    return NextResponse.json(await Promise.all(body.map(forward)), { headers: CORS });
  }
  return NextResponse.json(await forward(body), { headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
