import { parseEventLogs, type Log } from "viem";
import { canonAbi, coinAbi, curveAbi, factoryAbi, graduatorAbi, routerAbi, swapperAbi } from "@/lib/launchpad/abi";
import type { Addr } from "@/lib/launchpad/types";
import { logsClient, publicClient } from "../config";
import { launchpad } from "./addresses";
import { db, meta, setMeta } from "./db";

// Follows the launchpad's events into SQLite so pages load without a dozen RPC
// reads each. Everything here can be rebuilt by clearing lp_* and re-indexing.

const allAbi = [...factoryAbi, ...curveAbi, ...coinAbi, ...canonAbi, ...routerAbi, ...graduatorAbi, ...swapperAbi];
const CHUNK = BigInt(Number(process.env.KOMA_INDEX_CHUNK ?? 20_000));
const DEAD = "0x000000000000000000000000000000000000dead";

const cursorKey = () => {
  const a = launchpad()!;
  return `cursor:${a.chainId}:${a.seriesFactory.toLowerCase()}`;
};

const blockTimes = new Map<bigint, number>();
async function timeOf(block: bigint) {
  let t = blockTimes.get(block);
  if (t === undefined) {
    t = Number((await publicClient.getBlock({ blockNumber: block })).timestamp);
    blockTimes.set(block, t);
    if (blockTimes.size > 5000) blockTimes.clear();
  }
  return t;
}

/** Addresses whose logs we follow: fixed contracts plus every curve and coin. */
function watched(): Addr[] {
  const a = launchpad()!;
  const rows = db().prepare("SELECT coin, curve FROM lp_series").all() as { coin: Addr; curve: Addr }[];
  return [a.canonRegistry, a.royaltyRouter, a.graduator, a.swapper, ...rows.flatMap((r) => [r.coin, r.curve])];
}

function seriesByAddress(addr: string): { id: number; coin: string; curve: string } | null {
  const row = db().prepare("SELECT id, coin, curve FROM lp_series WHERE lower(coin) = ? OR lower(curve) = ?").get(addr.toLowerCase(), addr.toLowerCase()) as
    | { id: number; coin: string; curve: string }
    | undefined;
  return row ?? null;
}

async function onLaunched(log: Log & { args: Record<string, unknown> }, at: number) {
  const a = launchpad()!;
  const id = Number(log.args.seriesId);
  const s = await publicClient.readContract({ address: a.seriesFactory, abi: factoryAbi, functionName: "series", args: [BigInt(id)], blockNumber: log.blockNumber! });
  const st = await publicClient.readContract({ address: s.curve, abi: curveAbi, functionName: "state", blockNumber: log.blockNumber! });
  db().prepare(
    `INSERT INTO lp_series (id, creator, coin, curve, vesting, character_id, character_account, parent_id, target, name, symbol, launched_at, launch_tx, vu, vc, raised)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
  ).run(
    id,
    String(log.args.creator),
    s.coin,
    s.curve,
    s.vesting,
    Number(s.characterId),
    s.characterAccount,
    Number(s.parentSeriesId),
    String(s.graduationTarget),
    String(log.args.name),
    String(log.args.symbol),
    Number(s.launchedAt) || at,
    log.transactionHash,
    String(st[0]),
    String(st[1]),
    String(st[2]),
  );
}

/** Contract-held balances (curve, vesting, burn, pool) don't count as holders. */
export function nonHolders(seriesId: number): string[] {
  const a = launchpad()!;
  const row = db().prepare("SELECT curve, vesting FROM lp_series WHERE id = ?").get(seriesId) as { curve: string; vesting: string } | undefined;
  return [row?.curve, row?.vesting, DEAD, "0x0000000000000000000000000000000000000000", a.graduator, a.poolManager, a.positionManager]
    .filter(Boolean)
    .map((x) => x!.toLowerCase());
}

function addBalance(seriesId: number, holder: string, delta: bigint) {
  const d = db();
  const cur = d.prepare("SELECT balance FROM lp_balances WHERE series_id = ? AND holder = ?").get(seriesId, holder.toLowerCase()) as { balance: string } | undefined;
  const next = BigInt(cur?.balance ?? "0") + delta;
  d.prepare("INSERT INTO lp_balances (series_id, holder, balance) VALUES (?, ?, ?) ON CONFLICT(series_id, holder) DO UPDATE SET balance = excluded.balance").run(
    seriesId,
    holder.toLowerCase(),
    String(next),
  );
}

async function apply(logs: Log[]) {
  const a = launchpad()!;
  const events = parseEventLogs({ abi: allAbi, logs, strict: false }) as (Log & { eventName: string; args: Record<string, unknown> })[];
  for (const e of events) {
    const at = await timeOf(e.blockNumber!);
    const addr = e.address.toLowerCase();
    const d = db();
    switch (e.eventName) {
      case "SeriesLaunched":
        if (addr === a.seriesFactory.toLowerCase()) await onLaunched(e, at);
        break;
      case "Trade": {
        const s = seriesByAddress(addr);
        if (!s || s.curve.toLowerCase() !== addr) break;
        const r = e.args;
        d.prepare(
          `INSERT INTO lp_trades (tx, log_index, series_id, trader, is_buy, usdc, coins, fee, vu, vc, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        ).run(e.transactionHash, e.logIndex, s.id, String(r.trader), r.isBuy ? 1 : 0, String(r.usdcAmount), String(r.coinAmount), String(r.fee), String(r.vU), String(r.vC), at);
        d.prepare("UPDATE lp_series SET vu = ?, vc = ?, raised = ?, last_trade_at = ? WHERE id = ?").run(String(r.vU), String(r.vC), String(r.raised), at, s.id);
        break;
      }
      case "Swapped": {
        // Trades in the graduated v4 pool. Stored like curve trades, with the
        // trade's own amounts as the "reserves", so price = USDC / coins.
        if (addr !== a.swapper.toLowerCase()) break;
        const r = e.args;
        const id = Number(r.seriesId);
        const buy = Boolean(r.buyCoin);
        const usdcAmt = String(buy ? r.amountIn : r.amountOut);
        const coinAmt = String(buy ? r.amountOut : r.amountIn);
        d.prepare(
          `INSERT INTO lp_trades (tx, log_index, series_id, trader, is_buy, usdc, coins, fee, vu, vc, at) VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ?, ?) ON CONFLICT DO NOTHING`,
        ).run(e.transactionHash, e.logIndex, id, String(r.recipient), buy ? 1 : 0, usdcAmt, coinAmt, usdcAmt, coinAmt, at);
        d.prepare("UPDATE lp_series SET last_trade_at = ? WHERE id = ?").run(at, id);
        break;
      }
      case "Completed": {
        const s = seriesByAddress(addr);
        if (s) d.prepare("UPDATE lp_series SET complete = 1 WHERE id = ?").run(s.id);
        break;
      }
      case "Graduated": {
        const s = seriesByAddress(addr);
        if (s) d.prepare("UPDATE lp_series SET graduated = 1, complete = 1, pool_id = ?, pool_usdc = ?, pool_coins = ? WHERE id = ?").run(String(e.args.poolId), String(e.args.usdcToPool), String(e.args.coinToPool), s.id);
        break;
      }
      case "PoolCreated":
        if (addr === a.graduator.toLowerCase())
          d.prepare("UPDATE lp_series SET pool_id = ?, pool_usdc = ?, pool_coins = ? WHERE id = ?").run(String(e.args.poolId), String(e.args.usdcToPool), String(e.args.coinToPool), Number(e.args.seriesId));
        break;
      case "Transfer": {
        const s = seriesByAddress(addr);
        if (!s || s.coin.toLowerCase() !== addr) break;
        const v = BigInt(e.args.value as bigint);
        addBalance(s.id, String(e.args.from), -v);
        addBalance(s.id, String(e.args.to), v);
        break;
      }
      case "Routed":
        if (addr === a.royaltyRouter.toLowerCase())
          d.prepare("INSERT INTO lp_routed (tx, log_index, series_id, recipient, amount, kind) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").run(
            e.transactionHash,
            e.logIndex,
            Number(e.args.seriesId),
            String(e.args.recipient),
            String(e.args.amount),
            Number(e.args.kind),
          );
        break;
      case "SlotOpened":
        if (addr === a.canonRegistry.toLowerCase())
          d.prepare("INSERT INTO lp_slots (series_id, episode, snapshot, ends_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING").run(
            Number(e.args.seriesId),
            Number(e.args.episode),
            Number(e.args.snapshot),
            Number(e.args.endsAt),
          );
        break;
      case "Proposed":
        if (addr === a.canonRegistry.toLowerCase())
          d.prepare("INSERT INTO lp_proposals (series_id, episode, issue_id, proposer, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING").run(
            Number(e.args.seriesId),
            Number(e.args.episode),
            Number(e.args.issueId),
            String(e.args.proposer),
            at,
          );
        break;
      case "CanonFinalized":
        if (addr === a.canonRegistry.toLowerCase())
          d.prepare("UPDATE lp_slots SET finalized = 1, winner = ?, winner_votes = ?, total_votes = ?, votes_root = ? WHERE series_id = ? AND episode = ?").run(
            Number(e.args.winnerIssueId),
            String(e.args.winnerVotes),
            String(e.args.totalVotes),
            String(e.args.votesRoot),
            Number(e.args.seriesId),
            Number(e.args.episode),
          );
        break;
    }
  }
}

/**
 * A new launchpad deployment restarts series ids at 1, so rows indexed from the
 * previous one would collide with (and shadow) the new series. When the factory
 * changes, clear everything derived from the old deployment and start over.
 */
function followDeployment() {
  const a = launchpad()!;
  const current = `${a.chainId}:${a.seriesFactory.toLowerCase()}`;
  if (meta("deployment") === current) return;
  const d = db();
  d.exec(`
    DELETE FROM lp_series; DELETE FROM lp_series_meta; DELETE FROM lp_trades; DELETE FROM lp_balances;
    DELETE FROM lp_routed; DELETE FROM lp_slots; DELETE FROM lp_proposals; DELETE FROM lp_votes; DELETE FROM lp_pending_proposals;
    DELETE FROM lp_meta WHERE key LIKE 'cursor:%';
  `);
  setMeta("deployment", current);
  console.log(`[koma] indexer: following launchpad ${current}`);
}

/** Index up to the chain head once. Returns the block it reached. */
export async function indexOnce(): Promise<bigint | null> {
  const a = launchpad();
  if (!a) return null;
  followDeployment();
  const key = cursorKey();
  const head = await logsClient.getBlockNumber();
  let from = BigInt(meta(key) ?? a.deployBlock);
  let chunk = CHUNK;
  while (from <= head) {
    const to = from + chunk - BigInt(1) > head ? head : from + chunk - BigInt(1);
    try {
      const launches = await logsClient.getLogs({ address: a.seriesFactory, fromBlock: from, toBlock: to });
      await apply(launches);
      const rest = await logsClient.getLogs({ address: watched(), fromBlock: from, toBlock: to });
      await apply(rest);
    } catch (e) {
      // Some RPCs cap log ranges: shrink and retry.
      if (chunk > BigInt(100)) {
        chunk /= BigInt(4);
        continue;
      }
      throw e;
    }
    setMeta(key, String(to + BigInt(1)));
    from = to + BigInt(1);
  }
  return head;
}

const loop = globalThis as unknown as { __komaIndexer?: boolean; __komaIndexWaiters?: (() => void)[] };

/** Background follower; `afterTick` runs the keeper (graduations, canon finalization). */
export function startIndexer(afterTick: () => Promise<void>) {
  if (loop.__komaIndexer || !launchpad()) return;
  loop.__komaIndexer = true;
  const tick = async () => {
    try {
      await indexOnce();
      await afterTick();
    } catch (e) {
      console.error("[koma] indexer", (e as Error).message);
    }
    for (const w of loop.__komaIndexWaiters?.splice(0) ?? []) w();
    setTimeout(tick, Number(process.env.KOMA_INDEX_MS ?? 3000));
  };
  void tick();
}

/** Wait for the indexer's next pass (so an API can return fresh data after a tx). */
export function nextIndex(timeoutMs = 8000) {
  return new Promise<void>((resolve) => {
    (loop.__komaIndexWaiters ??= []).push(resolve);
    setTimeout(resolve, timeoutMs);
  });
}
