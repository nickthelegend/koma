import { formatUnits, parseUnits } from "viem";
import { CANON_THRESHOLD, characterAbi, coinAbi } from "@/lib/launchpad/abi";
import type { Addr } from "@/lib/launchpad/types";
import { publicClient } from "../config";
import { launchpad } from "./addresses";
import { db } from "./db";
import { seriesRow } from "./queries";
import { propose, reason } from "./relay";
import { nextIndex } from "./indexer";

const THRESHOLD = parseUnits(String(CANON_THRESHOLD), 18);

/**
 * Checked before quoting an episode, so nobody pays for a proposal the
 * registry would refuse: proposers need 1M coins (or to own the character).
 */
export async function canPropose(seriesId: number, proposer: Addr): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = launchpad();
  if (!a) return { ok: false, error: "The launchpad isn't deployed on this network yet." };
  const s = seriesRow(seriesId);
  if (!s) return { ok: false, error: `Series #${seriesId} doesn't exist.` };
  if (s.graduated || s.complete) {
    // Graduated series keep their canon going; nothing to block here.
  }
  const owner = await publicClient.readContract({ address: a.characterNft, abi: characterAbi, functionName: "ownerOf", args: [BigInt(s.character_id)] });
  if (owner.toLowerCase() === proposer.toLowerCase()) return { ok: true };
  const open = db().prepare("SELECT snapshot, ends_at FROM lp_slots WHERE series_id = ? AND finalized = 0").get(seriesId) as { snapshot: number; ends_at: number } | undefined;
  const votes = open
    ? await publicClient.readContract({ address: s.coin, abi: coinAbi, functionName: "getPastVotes", args: [proposer, BigInt(open.snapshot)] })
    : await publicClient.readContract({ address: s.coin, abi: coinAbi, functionName: "getVotes", args: [proposer] });
  if (votes < THRESHOLD) {
    const when = open ? "when this episode's voting opened" : "right now";
    return { ok: false, error: `Proposing needs ${CANON_THRESHOLD.toLocaleString("en-US")} $${s.symbol} ${when}; you had ${Number(formatUnits(votes, 18)).toLocaleString("en-US")}.` };
  }
  return { ok: true };
}

/** After an episode is minted: propose it now, or queue it until the next slot opens. */
export async function proposeOrQueue(seriesId: number, issueId: number, proposer: Addr, jobId: string) {
  try {
    await propose(seriesId, issueId, proposer);
    // Finish only once the canon board (served from the index) shows the proposal.
    await nextIndex();
    await nextIndex();
    return { proposed: true as const };
  } catch (e) {
    const why = reason(e);
    db().prepare(
      "INSERT INTO lp_pending_proposals (issue_id, series_id, proposer, job_id, attempts, error) VALUES (?, ?, ?, ?, 1, ?) ON CONFLICT(issue_id) DO NOTHING",
    ).run(issueId, seriesId, proposer, jobId, why);
    return { proposed: false as const, error: why };
  }
}
