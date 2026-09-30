import { mkdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Comic, Job } from "@/lib/types";
import { config } from "./config";

// SQLite (Node's built-in driver) for issues and jobs; generated art stays on
// disk next to it. One file, one server, durable across restarts.
function open() {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, "koma.db"));
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS issues (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      creator TEXT NOT NULL,
      token_id INTEGER NOT NULL UNIQUE,
      payment_tx TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS issues_creator ON issues (creator);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      payer TEXT NOT NULL,
      stage TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_payer ON jobs (payer, stage);
    CREATE TABLE IF NOT EXISTS faucet_claims (
      address TEXT NOT NULL,
      ip TEXT NOT NULL,
      at INTEGER NOT NULL,
      amount INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS faucet_at ON faucet_claims (at);
  `);
  return db;
}

// Opened on first use, so importing this module (e.g. during `next build`) never touches the file.
const g = globalThis as unknown as { __komaDb?: DatabaseSync };
const conn = () => (g.__komaDb ??= open());
/** Shared handle for modules that keep their own tables (each creates its tables on first use). */
export const db = conn;

const safeId = (id: string) => /^[a-z0-9-]{4,64}$/.test(id);
const parse = <T>(row: unknown) => (row ? (JSON.parse((row as { data: string }).data) as T) : null);

// ——— Jobs ———
export async function saveJob(job: Job) {
  job.updatedAt = new Date().toISOString();
  conn().prepare(
    `INSERT INTO jobs (id, payer, stage, updated_at, data) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET stage = excluded.stage, updated_at = excluded.updated_at, data = excluded.data`,
  ).run(job.id, job.payer.toLowerCase(), job.stage, job.updatedAt, JSON.stringify(job));
}

export async function getJob(id: string) {
  if (!safeId(id)) return null;
  return parse<Job>(conn().prepare("SELECT data FROM jobs WHERE id = ?").get(id));
}

/** Jobs that took payment but haven't finished. */
export async function unfinishedJobs(payer?: string) {
  const rows = payer
    ? conn().prepare("SELECT data FROM jobs WHERE payer = ? AND stage NOT IN ('done', 'error') ORDER BY updated_at DESC").all(payer.toLowerCase())
    : conn().prepare("SELECT data FROM jobs WHERE stage NOT IN ('done', 'error')").all();
  return rows.map((r) => parse<Job>(r)!);
}

// ——— Issues ———
export async function saveIssue(comic: Comic) {
  conn().prepare(
    `INSERT INTO issues (id, created_at, creator, token_id, payment_tx, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
  ).run(comic.id, comic.createdAt, comic.creator.address.toLowerCase(), comic.chain.tokenId, comic.chain.paymentTx, JSON.stringify(comic));
}

export async function listIssues(owner?: string): Promise<Comic[]> {
  const rows = owner
    ? conn().prepare("SELECT data FROM issues WHERE creator = ? ORDER BY created_at DESC").all(owner.toLowerCase())
    : conn().prepare("SELECT data FROM issues ORDER BY created_at DESC").all();
  return rows.map((r) => parse<Comic>(r)!);
}

export async function getIssue(id: string) {
  if (!safeId(id)) return null;
  return parse<Comic>(conn().prepare("SELECT data FROM issues WHERE id = ?").get(id));
}

export async function getIssueByToken(tokenId: number) {
  return parse<Comic>(conn().prepare("SELECT data FROM issues WHERE token_id = ?").get(tokenId));
}

/** Atomic counter bump inside the JSON document. */
export async function bump(id: string, field: "reads" | "remixes") {
  conn().prepare(`UPDATE issues SET data = json_set(data, '$.${field}', json_extract(data, '$.${field}') + 1) WHERE id = ?`).run(id);
}

// ——— Art ———
export function artPath(issueId: string, file: string) {
  if (!safeId(issueId) || !/^[a-z0-9-]+\.jpg$/.test(file)) return null;
  return path.join(config.dataDir, "art", issueId, file);
}

export async function saveArt(issueId: string, file: string, bytes: Uint8Array) {
  const p = artPath(issueId, file);
  if (!p) throw new Error(`bad art path ${issueId}/${file}`);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, bytes);
  return `/api/art/${issueId}/${file}`;
}

export async function getIssueByTx(hash: string) {
  const h = hash.toLowerCase();
  return parse<Comic>(
    conn().prepare("SELECT data FROM issues WHERE lower(payment_tx) = ? OR lower(json_extract(data, '$.chain.mintTx')) = ?").get(h, h),
  );
}

// ——— Localnet faucet ———
export async function faucetUsage(address: string, ip: string, sinceMs: number) {
  const q = (sql: string, ...args: (string | number)[]) => (conn().prepare(sql).get(...args) as { n: number }).n;
  return {
    address: q("SELECT count(*) AS n FROM faucet_claims WHERE address = ? AND at > ?", address.toLowerCase(), sinceMs),
    ip: q("SELECT count(*) AS n FROM faucet_claims WHERE ip = ? AND at > ?", ip, sinceMs),
    total: q("SELECT count(*) AS n FROM faucet_claims WHERE at > ?", sinceMs),
  };
}

export async function recordFaucetClaim(address: string, ip: string, amount: number) {
  conn().prepare("INSERT INTO faucet_claims (address, ip, at, amount) VALUES (?, ?, ?, ?)").run(address.toLowerCase(), ip, Date.now(), amount);
}
