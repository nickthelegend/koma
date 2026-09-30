import { NextResponse, type NextRequest } from "next/server";
import { encodeAbiParameters, keccak256, parseAbiParameters, erc20Abi } from "viem";
import { config, publicClient, rpc } from "@/lib/server/config";
import { faucetUsage, recordFaucetClaim } from "@/lib/server/store";
import { clientIp } from "@/lib/server/client-ip";

export const dynamic = "force-dynamic";

// Test USDC for KOMA's hosted localnet only. The chain is a fork running the
// real Circle contract, so the faucet writes the balance slot directly, the way
// a testnet faucet would mint. Limits keep the AI bill of a public demo bounded.
const AMOUNT = BigInt(1_000_000); // 1 USDC = 10 pages
const DAY = 24 * 60 * 60 * 1000;
const PER_ADDRESS = Number(process.env.KOMA_FAUCET_PER_ADDRESS ?? 2);
const PER_IP = Number(process.env.KOMA_FAUCET_PER_IP ?? 4);
const PER_DAY = Number(process.env.KOMA_FAUCET_PER_DAY ?? 40);
const BALANCE_SLOT = BigInt(9); // FiatToken v2: balanceAndBlacklistStates mapping

export async function POST(req: NextRequest) {
  if (!config.network.faucet) return NextResponse.json({ error: "No faucet on this network." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { address?: string } | null;
  const address = body?.address;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return NextResponse.json({ error: "Send a wallet address." }, { status: 400 });
  const ip = clientIp(req);

  const used = await faucetUsage(address, ip, Date.now() - DAY);
  if (used.total >= PER_DAY) return NextResponse.json({ error: "The faucet is dry for today. Try again tomorrow." }, { status: 429 });
  if (used.address >= PER_ADDRESS || used.ip >= PER_IP) {
    return NextResponse.json({ error: "You've already had today's test USDC. Come back tomorrow." }, { status: 429 });
  }

  const usdc = config.network.usdc;
  const before = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
  const slot = keccak256(encodeAbiParameters(parseAbiParameters("address, uint256"), [address as `0x${string}`, BALANCE_SLOT]));
  const next = before + AMOUNT;
  await rpc("anvil_setStorageAt", [usdc, slot, `0x${next.toString(16).padStart(64, "0")}`]);
  const after = await publicClient.readContract({ address: usdc, abi: erc20Abi, functionName: "balanceOf", args: [address as `0x${string}`] });
  if (after !== next) return NextResponse.json({ error: "Faucet write didn't land." }, { status: 502 });
  await recordFaucetClaim(address, ip, Number(AMOUNT));
  return NextResponse.json({ ok: true, balance: Number(after) / 1e6 });
}
