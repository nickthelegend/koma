import { BaseError, ContractFunctionRevertedError, keccak256, parseSignature, stringToBytes, type Hex } from "viem";
import { canonAbi, characterAbi, curveAbi, swapperAbi } from "@/lib/launchpad/abi";
import type { Addr } from "@/lib/launchpad/types";
import { publicClient, serverWallet } from "../config";
import { GASLESS_MIN_USDC } from "@/lib/network";
import { launchpad, requireLaunchpad } from "./addresses";
import { db } from "./db";
import { votesFor } from "./queries";
import { chainNow } from "./chain-time";

// KOMA's relayer: the same server wallet that settles x402 payments submits
// users' signed trade intents and runs the canon keeper, paying the gas.

/** Turn a revert into the contract's error name, which the UI can explain. */
export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    // Custom errors by name; plain `revert("…")` strings (e.g. USDC's) by their text.
    if (revert?.data?.errorName && revert.data.errorName !== "Error") return revert.data.errorName;
    if (revert?.reason) return revert.reason;
    return e.shortMessage;
  }
  return (e as Error).message;
}

function wallet() {
  if (!serverWallet) throw new Error("Relayer offline: server missing SERVER_PRIVATE_KEY.");
  return serverWallet;
}

async function send(req: Parameters<NonNullable<typeof serverWallet>["simulateContract"]>[0]): Promise<Hex> {
  const w = wallet();
  const { request } = await w.simulateContract({ ...req, account: w.account } as never);
  const gas = await w.estimateContractGas({ ...req, account: w.account } as never);
  // Estimates run tight on calls with nested transfers and refunds (a clipped buy ran out at 99.5%).
  const hash = await w.writeContract({ ...(request as object), gas: (gas * BigInt(13)) / BigInt(10) } as never);
  return hash;
}

async function confirm(hash: Hex) {
  const receipt = await wallet().waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted`);
  return receipt;
}

// Below this a relayed trade costs KOMA more gas than the trade's fee brings in.
const MIN_RELAY = BigInt(Math.round(GASLESS_MIN_USDC * 1e6));
const tooSmall = () => new Error(`Gasless trades start at $${GASLESS_MIN_USDC}. For less, send the trade from your own wallet.`);

function knownCurve(curve: string) {
  const row = db().prepare("SELECT id, complete FROM lp_series WHERE lower(curve) = ?").get(curve.toLowerCase()) as { id: number; complete: number } | undefined;
  if (!row) throw new Error("Unknown curve.");
  if (row.complete) throw new Error("This series has graduated; trade it on Uniswap v4.");
  return row;
}

export type BuyIntent = {
  curve: Addr; buyer: Addr; usdcIn: string; minCoinOut: string; deadline: string; salt: Hex; validAfter: string; validBefore: string; signature: Hex;
};
export async function relayBuy(b: BuyIntent): Promise<Hex> {
  knownCurve(b.curve);
  if (BigInt(b.usdcIn) < MIN_RELAY) throw tooSmall();
  const { v, r, s, yParity } = parseSignature(b.signature);
  return send({
    address: b.curve,
    abi: curveAbi,
    functionName: "buyWithAuthorization",
    args: [b.buyer, BigInt(b.usdcIn), BigInt(b.minCoinOut), BigInt(b.deadline), b.salt, BigInt(b.validAfter), BigInt(b.validBefore), Number(v ?? BigInt(27 + (yParity ?? 0))), r, s],
  });
}

export type SwapBuyIntent = {
  seriesId: number; buyer: Addr; usdcIn: string; minCoinOut: string; deadline: string; salt: Hex; validAfter: string; validBefore: string; signature: Hex;
};
/** Gasless buy through a graduated series' Uniswap v4 pool (KomaSwapper). */
export async function relaySwapBuy(b: SwapBuyIntent): Promise<Hex> {
  const row = db().prepare("SELECT graduated FROM lp_series WHERE id = ?").get(b.seriesId) as { graduated: number } | undefined;
  if (!row) throw new Error("Unknown series.");
  if (!row.graduated) throw new Error("This series still trades on its curve.");
  if (BigInt(b.usdcIn) < MIN_RELAY) throw tooSmall();
  const { v, r, s, yParity } = parseSignature(b.signature);
  return send({
    address: requireLaunchpad().swapper,
    abi: swapperAbi,
    functionName: "swapWithAuthorization",
    args: [b.buyer, BigInt(b.seriesId), BigInt(b.usdcIn), BigInt(b.minCoinOut), BigInt(b.deadline), b.salt, BigInt(b.validAfter), BigInt(b.validBefore), Number(v ?? BigInt(27 + (yParity ?? 0))), r, s],
  });
}

export type SellIntent = {
  curve: Addr; seller: Addr; coinIn: string; minUsdcOut: string; deadline: string; permit: Hex; intentSignature: Hex;
};
export async function relaySell(b: SellIntent): Promise<Hex> {
  knownCurve(b.curve);
  const [out] = await publicClient.readContract({ address: b.curve, abi: curveAbi, functionName: "quoteSell", args: [BigInt(b.coinIn)] });
  if (out < MIN_RELAY) throw tooSmall();
  const p = parseSignature(b.permit);
  return send({
    address: b.curve,
    abi: curveAbi,
    functionName: "sellWithPermit",
    args: [b.seller, BigInt(b.coinIn), BigInt(b.minUsdcOut), BigInt(b.deadline), Number(p.v ?? BigInt(27 + (p.yParity ?? 0))), p.r, p.s, b.intentSignature],
  });
}

const inflight = globalThis as unknown as { __komaInflight?: Set<string> };
const busy = (inflight.__komaInflight ??= new Set());

async function once(key: string, run: () => Promise<void>) {
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await run();
  } catch (e) {
    console.error(`[koma] keeper ${key}: ${reason(e)}`);
  } finally {
    busy.delete(key);
  }
}

export async function graduate(seriesId: number): Promise<Hex> {
  const row = db().prepare("SELECT curve FROM lp_series WHERE id = ?").get(seriesId) as { curve: Addr } | undefined;
  if (!row) throw new Error("Unknown series.");
  const hash = await send({ address: row.curve, abi: curveAbi, functionName: "graduate" });
  await confirm(hash);
  return hash;
}

/** Propose a minted issue for the series' open episode. */
export async function propose(seriesId: number, issueId: number, proposer: Addr) {
  const a = requireLaunchpad();
  const hash = await send({ address: a.canonRegistry, abi: canonAbi, functionName: "propose", args: [BigInt(seriesId), BigInt(issueId), proposer] });
  await confirm(hash);
  return hash;
}

/** Canonical bytes of a slot's votes; the root commits the published list on-chain. */
export function votesRoot(seriesId: number, episode: number) {
  const votes = votesFor(seriesId, episode).map((v) => ({ issueId: v.issueId, voter: v.voter.toLowerCase(), weight: v.weight, signature: v.signature }));
  votes.sort((x, y) => (x.voter < y.voter ? -1 : 1));
  return { root: keccak256(stringToBytes(JSON.stringify(votes))), votes };
}

async function finalizeSlot(seriesId: number, episode: number) {
  const a = requireLaunchpad();
  const props = db().prepare("SELECT issue_id, at FROM lp_proposals WHERE series_id = ? AND episode = ? ORDER BY at, issue_id").all(seriesId, episode) as { issue_id: number; at: number }[];
  if (!props.length) return;
  const { root, votes } = votesRoot(seriesId, episode);
  const tally = new Map<number, bigint>(props.map((p) => [p.issue_id, BigInt(0)]));
  for (const v of votes) if (tally.has(v.issueId)) tally.set(v.issueId, tally.get(v.issueId)! + BigInt(v.weight));
  const best = [...tally.values()].reduce((m, x) => (x > m ? x : m), BigInt(0));
  const tied = props.filter((p) => tally.get(p.issue_id) === best).map((p) => p.issue_id);
  let winner = tied[0];
  if (tied.length > 1) {
    // Ties (including no votes at all) go to the character owner's pick, else the earliest proposal.
    const s = db().prepare("SELECT character_id FROM lp_series WHERE id = ?").get(seriesId) as { character_id: number };
    const owner = (await publicClient.readContract({ address: a.characterNft, abi: characterAbi, functionName: "ownerOf", args: [BigInt(s.character_id)] })).toLowerCase();
    const pick = votes.find((v) => v.voter === owner && tied.includes(v.issueId));
    if (pick) winner = pick.issueId;
  }
  const total = [...tally.values()].reduce((s, x) => s + x, BigInt(0));
  const hash = await send({
    address: a.canonRegistry,
    abi: canonAbi,
    functionName: "finalize",
    args: [BigInt(seriesId), BigInt(episode), BigInt(winner), root, best, total],
  });
  await confirm(hash);
  console.log(`[koma] canon: series ${seriesId} episode ${episode} → issue #${winner} (${hash})`);
}

/** Runs after each index pass: graduations, finalizations, proposals waiting for a slot. */
export async function keeper() {
  if (!launchpad() || !serverWallet) return;
  const d = db();
  const now = await chainNow();
  const ready = d.prepare("SELECT id FROM lp_series WHERE complete = 1 AND graduated = 0").all() as { id: number }[];
  for (const s of ready) await once(`grad:${s.id}`, async () => void (await graduate(s.id)));
  const due = d.prepare("SELECT series_id, episode FROM lp_slots WHERE finalized = 0 AND ends_at < ?").all(now - 2) as { series_id: number; episode: number }[];
  for (const s of due) await once(`fin:${s.series_id}:${s.episode}`, () => finalizeSlot(s.series_id, s.episode));
  const waiting = d.prepare("SELECT * FROM lp_pending_proposals WHERE attempts < 20").all() as { issue_id: number; series_id: number; proposer: Addr; attempts: number }[];
  for (const p of waiting) {
    // A proposal that missed a closing window waits until that slot is finalized, then opens the next one.
    const open = d.prepare("SELECT ends_at FROM lp_slots WHERE series_id = ? AND finalized = 0").get(p.series_id) as { ends_at: number } | undefined;
    if (open && open.ends_at <= now) continue;
    await once(`prop:${p.issue_id}`, async () => {
      try {
        await propose(p.series_id, p.issue_id, p.proposer);
        d.prepare("DELETE FROM lp_pending_proposals WHERE issue_id = ?").run(p.issue_id);
      } catch (e) {
        d.prepare("UPDATE lp_pending_proposals SET attempts = attempts + 1, error = ? WHERE issue_id = ?").run(reason(e), p.issue_id);
        throw e;
      }
    });
  }
}
