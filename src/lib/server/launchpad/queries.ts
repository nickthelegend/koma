import { formatUnits } from "viem";
import { CANON_THRESHOLD, TOTAL_SUPPLY, characterAbi, routerAbi } from "@/lib/launchpad/abi";
import type { ActivityEvent, Addr, CanonView, ProposalView, SeriesDetail, SeriesSummary, SignedVote, TradeRow } from "@/lib/launchpad/types";
import { publicClient } from "../config";
import { getIssueByToken } from "../store";
import { launchpad } from "./addresses";
import { db } from "./db";
import { nonHolders } from "./indexer";
import { chainNow } from "./chain-time";

type Row = {
  id: number; creator: Addr; coin: Addr; curve: Addr; vesting: Addr; character_id: number; character_account: Addr; parent_id: number;
  target: string; name: string; symbol: string; launched_at: number; launch_tx: string | null; vu: string; vc: string; raised: string;
  complete: number; graduated: number; pool_id: string | null; pool_usdc: string | null; pool_coins: string | null; last_trade_at: number | null;
  character_name: string | null; character_prompt: string | null; pitch: string | null; genre: string | null; sheet: string | null; demo: number | null;
};

const usd = (raw: string | bigint) => Number(formatUnits(BigInt(raw), 6));
const coins = (raw: string | bigint) => Number(formatUnits(BigInt(raw), 18));
/** USDC per whole coin from the virtual reserves. */
export const priceOf = (vu: string | bigint, vc: string | bigint) => (Number(BigInt(vu)) / 1e6) / (Number(BigInt(vc)) / 1e18);

const SELECT = "SELECT s.*, m.character_name, m.character_prompt, m.pitch, m.genre, m.sheet, m.demo FROM lp_series s LEFT JOIN lp_series_meta m ON m.id = s.id";

function holders(id: number) {
  const skip = nonHolders(id);
  const all = db().prepare("SELECT holder, balance FROM lp_balances WHERE series_id = ?").all(id) as { holder: string; balance: string }[];
  return all.filter((r) => BigInt(r.balance) > BigInt(0) && !skip.includes(r.holder));
}

function episodes(id: number) {
  return (db().prepare("SELECT COUNT(*) AS n FROM lp_slots WHERE series_id = ? AND finalized = 1").get(id) as { n: number }).n;
}

/** Curve price while on the curve; after graduation, the latest pool trade's price. */
function currentPrice(r: Row) {
  if (r.graduated) {
    const t = db().prepare("SELECT vu, vc FROM lp_trades WHERE series_id = ? AND fee = '0' ORDER BY at DESC, log_index DESC LIMIT 1").get(r.id) as { vu: string; vc: string } | undefined;
    if (t) return priceOf(t.vu, t.vc);
  }
  return priceOf(r.vu, r.vc);
}

function summary(r: Row): SeriesSummary {
  const price = currentPrice(r);
  return {
    id: r.id,
    name: r.name,
    symbol: r.symbol,
    characterName: r.character_name ?? r.name,
    sheetUrl: r.sheet ?? "",
    coin: r.coin,
    curve: r.curve,
    characterId: r.character_id,
    characterAccount: r.character_account,
    creator: r.creator,
    parentSeriesId: r.parent_id,
    priceUsdc: price,
    marketCapUsdc: price * TOTAL_SUPPLY,
    raisedUsdc: usd(r.raised),
    targetUsdc: usd(r.target),
    complete: !!r.complete,
    graduated: !!r.graduated,
    demo: !!r.demo,
    holders: holders(r.id).length,
    episodes: episodes(r.id),
    launchedAt: r.launched_at,
    lastTradeAt: r.last_trade_at,
  };
}

export function listSeries(): SeriesSummary[] {
  const rows = db().prepare(`${SELECT} ORDER BY COALESCE(s.last_trade_at, s.launched_at) DESC LIMIT 200`).all() as Row[];
  return rows.map(summary);
}

export function seriesRow(id: number): Row | null {
  return (db().prepare(`${SELECT} WHERE s.id = ?`).get(id) as Row | undefined) ?? null;
}

export async function seriesDetail(id: number): Promise<SeriesDetail | null> {
  const r = seriesRow(id);
  if (!r) return null;
  const a = launchpad()!;
  const d = db();
  const trades = (d.prepare("SELECT * FROM lp_trades WHERE series_id = ? ORDER BY at DESC, log_index DESC LIMIT 60").all(id) as {
    tx: string; trader: Addr; is_buy: number; usdc: string; coins: string; vu: string; vc: string; at: number;
  }[]).map<TradeRow>((t) => ({ tx: t.tx, trader: t.trader, isBuy: !!t.is_buy, usdc: usd(t.usdc), coins: coins(t.coins), price: priceOf(t.vu, t.vc), at: t.at }));
  const chartRows = d.prepare("SELECT vu, vc, at FROM lp_trades WHERE series_id = ? ORDER BY at, log_index").all(id) as { vu: string; vc: string; at: number }[];
  const start = { t: r.launched_at, price: priceOf(BigInt(1_000e6), BigInt(1_000_000_000) * BigInt(1e18)) };
  const chart = [start, ...chartRows.map((c) => ({ t: c.at, price: priceOf(c.vu, c.vc) }))];
  const [owner, earned] = await Promise.all([
    publicClient.readContract({ address: a.characterNft, abi: characterAbi, functionName: "ownerOf", args: [BigInt(r.character_id)] }).catch(() => null),
    publicClient.readContract({ address: a.royaltyRouter, abi: routerAbi, functionName: "earned", args: [r.character_account] }).catch(() => BigInt(0)),
  ]);
  const remixes = d.prepare("SELECT id, name FROM lp_series WHERE parent_id = ? ORDER BY id").all(id) as { id: number; name: string }[];
  const parent = r.parent_id ? ((d.prepare("SELECT id, name FROM lp_series WHERE id = ?").get(r.parent_id) as { id: number; name: string } | undefined) ?? null) : null;
  const royalties = (d.prepare("SELECT recipient, kind, SUM(CAST(amount AS INTEGER)) AS total FROM lp_routed WHERE series_id = ? GROUP BY recipient, kind ORDER BY total DESC").all(id) as {
    recipient: Addr; kind: number; total: number;
  }[]).map((x) => ({ recipient: x.recipient, kind: x.kind, amountUsdc: x.total / 1e6 }));
  // Royalties this character's wallet received from trades in its remixes (counted in `earned`, not in `royalties`).
  const fromRemixes = d.prepare("SELECT SUM(CAST(amount AS INTEGER)) AS total FROM lp_routed WHERE lower(recipient) = lower(?) AND series_id != ?").get(r.character_account, id) as { total: number | null };
  return {
    ...summary(r),
    pitch: r.pitch ?? "",
    genre: r.genre ?? undefined,
    vestingContract: r.vesting,
    characterEarnedUsdc: usd(earned as bigint),
    characterOwner: (owner as Addr | null) ?? null,
    launchTx: r.launch_tx,
    trades,
    chart,
    pool: r.pool_id ? { poolId: r.pool_id, usdc: usd(r.pool_usdc ?? "0"), coins: coins(r.pool_coins ?? "0") } : null,
    remixes,
    parent,
    royalties,
    remixRoyaltiesUsdc: (fromRemixes.total ?? 0) / 1e6,
    chainTime: await chainNow(),
  };
}

/** Where a minted issue stands in a series' canon, from the index: still being voted on, canon, or an alternate universe. */
export function canonStatusOfIssue(tokenId: number): { seriesId: number; name: string; symbol: string; episode: number; status: "voting" | "canon" | "alternate" } | null {
  const r = db()
    .prepare(
      `SELECT p.series_id, p.episode, s.name, s.symbol, sl.finalized, sl.winner FROM lp_proposals p
       JOIN lp_series s ON s.id = p.series_id
       LEFT JOIN lp_slots sl ON sl.series_id = p.series_id AND sl.episode = p.episode
       WHERE p.issue_id = ?`,
    )
    .get(tokenId) as { series_id: number; episode: number; name: string; symbol: string; finalized: number | null; winner: number | null } | undefined;
  if (!r) return null;
  const status = !r.finalized ? "voting" : r.winner === tokenId ? "canon" : "alternate";
  return { seriesId: r.series_id, name: r.name, symbol: r.symbol, episode: r.episode, status };
}

/** Balance of one holder according to the index (for quick UI hints; the chain is authoritative). */
export function indexedBalance(seriesId: number, holder: string) {
  const row = db().prepare("SELECT balance FROM lp_balances WHERE series_id = ? AND holder = ?").get(seriesId, holder.toLowerCase()) as { balance: string } | undefined;
  return BigInt(row?.balance ?? "0");
}

async function issueCard(issueId: number): Promise<ProposalView["issue"]> {
  const c = await getIssueByToken(issueId);
  return c ? { id: c.id, title: c.title, cover: c.cover, logline: c.logline } : null;
}

export function votesFor(seriesId: number, episode: number): SignedVote[] {
  return (db().prepare("SELECT * FROM lp_votes WHERE series_id = ? AND episode = ? ORDER BY at").all(seriesId, episode) as {
    series_id: number; episode: number; voter: Addr; issue_id: number; weight: string; signature: `0x${string}`; at: number;
  }[]).map((v) => ({ seriesId: v.series_id, episode: v.episode, issueId: v.issue_id, voter: v.voter, weight: v.weight, signature: v.signature, at: v.at }));
}

export async function canonView(seriesId: number): Promise<CanonView> {
  const d = db();
  const slots = d.prepare("SELECT * FROM lp_slots WHERE series_id = ? ORDER BY episode").all(seriesId) as {
    episode: number; snapshot: number; ends_at: number; finalized: number; winner: number | null; winner_votes: string | null; total_votes: string | null; votes_root: string | null;
  }[];
  const open = slots.find((s) => !s.finalized) ?? null;
  const episode = open?.episode ?? (slots.at(-1)?.episode ?? 0) + 1;
  const now = await chainNow();
  const votes = votesFor(seriesId, episode);
  const props = d.prepare("SELECT * FROM lp_proposals WHERE series_id = ? AND episode = ? ORDER BY at").all(seriesId, episode) as {
    issue_id: number; proposer: Addr; at: number;
  }[];
  const proposals: ProposalView[] = [];
  for (const p of props) {
    const mine = votes.filter((v) => v.issueId === p.issue_id);
    proposals.push({
      issueId: p.issue_id,
      proposer: p.proposer,
      votes: mine.reduce((s, v) => s + coins(v.weight), 0),
      voters: mine.length,
      issue: await issueCard(p.issue_id),
      proposedAt: p.at,
    });
  }
  const canon: CanonView["canon"] = [];
  const alternates: CanonView["alternates"] = [];
  for (const s of slots.filter((x) => x.finalized)) {
    canon.push({
      episode: s.episode,
      issueId: s.winner!,
      issue: await issueCard(s.winner!),
      winnerVotes: coins(s.winner_votes ?? "0"),
      totalVotes: coins(s.total_votes ?? "0"),
      votesRoot: s.votes_root ?? "",
    });
    const losers = d.prepare("SELECT issue_id FROM lp_proposals WHERE series_id = ? AND episode = ? AND issue_id != ?").all(seriesId, s.episode, s.winner) as { issue_id: number }[];
    for (const l of losers) alternates.push({ episode: s.episode, issueId: l.issue_id, issue: await issueCard(l.issue_id) });
  }
  return {
    seriesId,
    episode,
    slot: open ? { snapshot: open.snapshot, endsAt: open.ends_at, finalized: false, winner: 0, open: now < open.ends_at } : null,
    proposals,
    canon,
    alternates,
    votes,
    thresholdCoins: CANON_THRESHOLD,
    chainTime: now,
  };
}

// ——— The board: what happened lately across every series, and each one's recent prices.

/** Price of a fresh curve: the 1,000 virtual USDC against 1B virtual coins it opens with. */
const LAUNCH_PRICE_PER_COIN = priceOf(BigInt(1_000e6), BigInt(1_000_000_000) * BigInt(1e18));

/**
 * Latest launches, trades, graduations and finalized canon episodes across all
 * series, newest first. A read of the index; graduation and canon carry no time
 * of their own there, so they use the trade that filled the curve and the
 * moment the vote closed.
 */
export function recentActivity(limit = 30): ActivityEvent[] {
  const rows = db()
    .prepare(
      `SELECT * FROM (
        SELECT CASE WHEN t.is_buy = 1 THEN 'buy' ELSE 'sell' END AS kind, t.series_id AS sid, t.at AS at, t.log_index AS ord,
               t.tx AS tx, t.trader AS who, t.usdc AS usdc, NULL AS episode, CASE WHEN t.fee = '0' THEN 1 ELSE 0 END AS pool
          FROM lp_trades t
        UNION ALL
        SELECT 'launch', s.id, s.launched_at, -1, s.launch_tx, s.creator, NULL, NULL, 0 FROM lp_series s
        UNION ALL
        SELECT 'graduated', s.id, (SELECT MAX(at) FROM lp_trades WHERE series_id = s.id AND fee != '0'), 1000000000, NULL, NULL, s.raised, NULL, 0
          FROM lp_series s WHERE s.graduated = 1
        UNION ALL
        SELECT 'canon', l.series_id, l.ends_at, 1000000000, NULL, NULL, NULL, l.episode, 0 FROM lp_slots l WHERE l.finalized = 1
      ) e WHERE e.at IS NOT NULL ORDER BY e.at DESC, e.ord DESC LIMIT ?`,
    )
    .all(limit) as { kind: ActivityEvent["kind"]; sid: number; at: number; ord: number; tx: string | null; who: Addr | null; usdc: string | null; episode: number | null; pool: number }[];
  const names = new Map(
    (db().prepare("SELECT id, name, symbol FROM lp_series").all() as { id: number; name: string; symbol: string }[]).map((s) => [s.id, s]),
  );
  return rows.map((r) => ({
    id: `${r.kind}-${r.sid}-${r.tx ?? r.episode ?? ""}-${r.ord}`,
    kind: r.kind,
    seriesId: r.sid,
    name: names.get(r.sid)?.name ?? `Series #${r.sid}`,
    symbol: names.get(r.sid)?.symbol.trim() ?? "",
    at: r.at,
    tx: r.tx,
    who: r.who,
    usdc: r.usdc === null ? null : usd(r.usdc),
    episode: r.episode,
    pool: !!r.pool,
  }));
}

/**
 * The last `points` prices of every series, oldest first, for sparklines. A
 * series with fewer trades than that starts from its launch price.
 */
export function sparklines(points = 24): Record<number, number[]> {
  const rows = db()
    .prepare(
      `SELECT series_id, vu, vc FROM (
        SELECT series_id, vu, vc, at, log_index, ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY at DESC, log_index DESC) AS rn FROM lp_trades
      ) WHERE rn <= ? ORDER BY series_id, at, log_index`,
    )
    .all(points) as { series_id: number; vu: string; vc: string }[];
  const out: Record<number, number[]> = {};
  for (const r of rows) (out[r.series_id] ??= []).push(priceOf(r.vu, r.vc));
  for (const id of Object.keys(out)) if (out[+id].length < points) out[+id].unshift(LAUNCH_PRICE_PER_COIN);
  return out;
}
