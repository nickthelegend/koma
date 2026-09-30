import type { DatabaseSync } from "node:sqlite";
import type { LaunchJob } from "@/lib/launchpad/types";
import { db as base } from "../store";

// Launchpad tables live in the same SQLite file as issues and jobs. Everything
// here is a cache of on-chain events (rebuildable by re-indexing from the deploy
// block) except launch jobs, series metadata (pitch, sheet) and signed votes.
let ready = false;
export function db(): DatabaseSync {
  const d = base();
  if (ready) return d;
  d.exec(`
    CREATE TABLE IF NOT EXISTS lp_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS lp_series (
      id INTEGER PRIMARY KEY,
      creator TEXT NOT NULL,
      coin TEXT NOT NULL UNIQUE,
      curve TEXT NOT NULL UNIQUE,
      vesting TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      character_account TEXT NOT NULL,
      parent_id INTEGER NOT NULL,
      target TEXT NOT NULL,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      launched_at INTEGER NOT NULL,
      launch_tx TEXT,
      vu TEXT NOT NULL,
      vc TEXT NOT NULL,
      raised TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0,
      graduated INTEGER NOT NULL DEFAULT 0,
      pool_id TEXT,
      pool_usdc TEXT,
      pool_coins TEXT,
      last_trade_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS lp_series_meta (
      id INTEGER PRIMARY KEY,
      character_name TEXT NOT NULL,
      character_prompt TEXT NOT NULL DEFAULT '',
      pitch TEXT NOT NULL,
      genre TEXT,
      sheet TEXT NOT NULL,
      demo INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS lp_trades (
      tx TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      series_id INTEGER NOT NULL,
      trader TEXT NOT NULL,
      is_buy INTEGER NOT NULL,
      usdc TEXT NOT NULL,
      coins TEXT NOT NULL,
      fee TEXT NOT NULL,
      vu TEXT NOT NULL,
      vc TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (tx, log_index)
    );
    CREATE INDEX IF NOT EXISTS lp_trades_series ON lp_trades (series_id, at);
    CREATE TABLE IF NOT EXISTS lp_balances (
      series_id INTEGER NOT NULL,
      holder TEXT NOT NULL,
      balance TEXT NOT NULL,
      PRIMARY KEY (series_id, holder)
    );
    CREATE TABLE IF NOT EXISTS lp_routed (
      tx TEXT NOT NULL,
      log_index INTEGER NOT NULL,
      series_id INTEGER NOT NULL,
      recipient TEXT NOT NULL,
      amount TEXT NOT NULL,
      kind INTEGER NOT NULL,
      PRIMARY KEY (tx, log_index)
    );
    CREATE TABLE IF NOT EXISTS lp_slots (
      series_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      snapshot INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      finalized INTEGER NOT NULL DEFAULT 0,
      winner INTEGER,
      winner_votes TEXT,
      total_votes TEXT,
      votes_root TEXT,
      PRIMARY KEY (series_id, episode)
    );
    CREATE TABLE IF NOT EXISTS lp_proposals (
      series_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      issue_id INTEGER NOT NULL PRIMARY KEY,
      proposer TEXT NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lp_votes (
      series_id INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      voter TEXT NOT NULL,
      issue_id INTEGER NOT NULL,
      weight TEXT NOT NULL,
      signature TEXT NOT NULL,
      at INTEGER NOT NULL,
      PRIMARY KEY (series_id, episode, voter)
    );
    CREATE TABLE IF NOT EXISTS lp_pending_proposals (
      issue_id INTEGER PRIMARY KEY,
      series_id INTEGER NOT NULL,
      proposer TEXT NOT NULL,
      job_id TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS lp_launch_jobs (
      id TEXT PRIMARY KEY,
      payer TEXT NOT NULL,
      stage TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  ready = true;
  return d;
}

export function meta(key: string): string | null {
  const row = db().prepare("SELECT value FROM lp_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
export function setMeta(key: string, value: string) {
  db().prepare("INSERT INTO lp_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function saveLaunchJob(job: LaunchJob) {
  job.updatedAt = new Date().toISOString();
  db().prepare(
    `INSERT INTO lp_launch_jobs (id, payer, stage, updated_at, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at, data = excluded.data`,
  ).run(job.id, job.payer.toLowerCase(), job.stage, job.updatedAt, JSON.stringify(job));
}

export function getLaunchJob(id: string): LaunchJob | null {
  if (!/^[a-z0-9-]{4,64}$/.test(id)) return null;
  const row = db().prepare("SELECT data FROM lp_launch_jobs WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as LaunchJob) : null;
}

export function unfinishedLaunchJobs(): LaunchJob[] {
  return (db().prepare("SELECT data FROM lp_launch_jobs WHERE stage NOT IN ('done', 'error')").all() as { data: string }[]).map((r) => JSON.parse(r.data) as LaunchJob);
}
