import { NextResponse, type NextRequest } from "next/server";
import { formatUnits, isAddress, isHex } from "viem";
import { canonAbi, voteTypes } from "@/lib/launchpad/abi";
import { clientIp } from "@/lib/server/client-ip";
import { config, publicClient } from "@/lib/server/config";
import { launchpad } from "@/lib/server/launchpad/addresses";
import { db } from "@/lib/server/launchpad/db";
import { limited } from "@/lib/server/rate-limit";
import { chainNow } from "@/lib/server/launchpad/chain-time";

export const dynamic = "force-dynamic";

/**
 * POST /api/canon/[series]/vote { episode, issueId, voter, signature }
 * A free, signed vote. Weight is the voter's coin balance at the slot's
 * snapshot, read from the chain. Voting again before the window closes
 * replaces the earlier vote.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/canon/[series]/vote">) {
  const a = launchpad();
  if (!a) return NextResponse.json({ error: "The launchpad isn't deployed on this network yet." }, { status: 503 });
  if (limited(`vote:${clientIp(req)}`, 10 * 60_000, 60)) return NextResponse.json({ error: "Too many votes from here." }, { status: 429 });
  const seriesId = Number((await ctx.params).series);
  const b = (await req.json().catch(() => null)) as { episode?: number; issueId?: number; voter?: string; signature?: string } | null;
  const episode = Number(b?.episode);
  const issueId = Number(b?.issueId);
  if (!Number.isInteger(episode) || !Number.isInteger(issueId) || !isAddress(String(b?.voter)) || !isHex(b?.signature)) {
    return NextResponse.json({ error: "Send { episode, issueId, voter, signature }." }, { status: 400 });
  }
  const voter = b!.voter as `0x${string}`;
  const d = db();
  const slot = d.prepare("SELECT ends_at, finalized FROM lp_slots WHERE series_id = ? AND episode = ?").get(seriesId, episode) as { ends_at: number; finalized: number } | undefined;
  if (!slot) return NextResponse.json({ error: "That episode isn't open for votes." }, { status: 409 });
  if (slot.finalized || (await chainNow()) >= slot.ends_at) return NextResponse.json({ error: "Voting on this episode has closed." }, { status: 409 });
  if (!d.prepare("SELECT 1 FROM lp_proposals WHERE series_id = ? AND episode = ? AND issue_id = ?").get(seriesId, episode, issueId)) {
    return NextResponse.json({ error: "That issue isn't a proposal for this episode." }, { status: 409 });
  }
  const valid = await publicClient.verifyTypedData({
    address: voter,
    domain: { name: "KOMA Canon", version: "1", chainId: config.network.chain.id, verifyingContract: a.canonRegistry },
    types: voteTypes,
    primaryType: "Vote",
    message: { seriesId: BigInt(seriesId), episode: BigInt(episode), issueId: BigInt(issueId), voter },
    signature: b!.signature as `0x${string}`,
  });
  if (!valid) return NextResponse.json({ error: "Signature doesn't match the voter." }, { status: 401 });
  const weight = await publicClient.readContract({ address: a.canonRegistry, abi: canonAbi, functionName: "votingPower", args: [BigInt(seriesId), BigInt(episode), voter] });
  if (weight === BigInt(0)) return NextResponse.json({ error: "You held no coins of this series when voting opened, so this vote would weigh nothing." }, { status: 403 });
  d.prepare(
    `INSERT INTO lp_votes (series_id, episode, voter, issue_id, weight, signature, at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id, episode, voter) DO UPDATE SET issue_id = excluded.issue_id, weight = excluded.weight, signature = excluded.signature, at = excluded.at`,
  ).run(seriesId, episode, voter.toLowerCase(), issueId, String(weight), b!.signature!, Math.floor(Date.now() / 1000));
  return NextResponse.json({ ok: true, weight: formatUnits(weight, 18) });
}
