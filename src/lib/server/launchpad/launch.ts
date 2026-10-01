import { keccak256, parseEventLogs } from "viem";
import { factoryAbi, usdcAbi } from "@/lib/launchpad/abi";
import { LAUNCH_PRICE } from "@/lib/network";
import type { LaunchJob } from "@/lib/launchpad/types";
import { characterSheet } from "../ai";
import { config, publicClient, serverWallet } from "../config";
import { artPath, saveArt } from "../store";
import { readFile } from "node:fs/promises";
import { requireLaunchpad } from "./addresses";
import { db, saveLaunchJob, unfinishedLaunchJobs } from "./db";
import { reason } from "./relay";

export const LAUNCH_PRICE_USDC = LAUNCH_PRICE;
const DEMO_TARGET = BigInt(25e6);
const DEMO_WINDOW = BigInt(300);

/** Validates a launch request; shared by the quote and the paid handler. */
export function parseLaunch(body: unknown): { request: LaunchJob["request"] } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");
  const name = str("name");
  const symbol = str("symbol").toUpperCase();
  const characterName = str("characterName");
  const characterPrompt = str("characterPrompt");
  const pitch = str("pitch");
  if (name.length < 2 || name.length > 32) return { error: "Series name must be 2 to 32 characters." };
  if (!/^[A-Z0-9]{2,8}$/.test(symbol)) return { error: "Ticker must be 2 to 8 letters or digits." };
  if (characterName.length < 2 || characterName.length > 30) return { error: "Character name must be 2 to 30 characters." };
  if (characterPrompt.length < 20 || characterPrompt.length > 400) return { error: "Describe the character's look in 20 to 400 characters." };
  if (pitch.length < 12 || pitch.length > 600) return { error: "Pitch the series in 12 to 600 characters." };
  const parentSeriesId = Number(b.parentSeriesId ?? 0);
  if (!Number.isInteger(parentSeriesId) || parentSeriesId < 0) return { error: "parentSeriesId must be a series id." };
  if (parentSeriesId && !db().prepare("SELECT 1 FROM lp_series WHERE id = ?").get(parentSeriesId)) return { error: `Series #${parentSeriesId} doesn't exist.` };
  // Demo series (25 USDC graduation, 5-minute canon votes) exist so a graduation can be shown with faucet USDC.
  const demo = b.demo === true && config.network.key !== "arbitrum-one";
  const genre = str("genre") || undefined;
  return { request: { name, symbol, characterName, characterPrompt, pitch, genre, parentSeriesId, demo } };
}

const g = globalThis as unknown as { __komaLaunching?: Set<string> };
const running = (g.__komaLaunching ??= new Set());

/** Paid → character sheet → one launch transaction (Character NFT + TBA, coin, curve, vesting). */
export async function runLaunch(job: LaunchJob) {
  if (running.has(job.id)) return;
  running.add(job.id);
  try {
    const a = requireLaunchpad();
    if (!serverWallet) throw new Error("Relayer offline.");
    job.error = undefined;
    const r = job.request;

    // 1. Character sheet (kept on disk, so a restart doesn't pay fal twice)
    const file = artPath(`s-${job.id}`, "sheet.jpg")!;
    let bytes = await readFile(file).catch(() => null);
    if (!bytes) {
      job.stage = "sheet";
      saveLaunchJob(job);
      const sheet = await characterSheet({ name: r.characterName, prompt: r.characterPrompt, style: r.genre });
      job.sheet = await saveArt(`s-${job.id}`, "sheet.jpg", sheet.bytes);
      bytes = Buffer.from(sheet.bytes);
    }
    job.sheet = `/api/art/s-${job.id}/sheet.jpg`;
    job.sheetHash = keccak256(new Uint8Array(bytes));

    // 2. Launch. Idempotent across restarts: a sent tx is awaited, not resent.
    job.stage = "launching";
    saveLaunchJob(job);
    if (!job.launchTx) {
      const { request } = await serverWallet.simulateContract({
        account: serverWallet.account,
        address: a.seriesFactory,
        abi: factoryAbi,
        functionName: "launch",
        args: [
          {
            creator: job.payer,
            name: r.name,
            symbol: r.symbol,
            characterName: r.characterName,
            sheetHash: job.sheetHash,
            parentSeriesId: BigInt(r.parentSeriesId),
            graduationTarget: r.demo ? DEMO_TARGET : BigInt(0),
            votingWindow: r.demo ? DEMO_WINDOW : BigInt(0),
          },
        ],
      });
      const gas = await serverWallet.estimateContractGas(request);
      job.launchTx = await serverWallet.writeContract({ ...request, gas: (gas * BigInt(13)) / BigInt(10) });
      saveLaunchJob(job);
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: job.launchTx, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("Launch transaction reverted");
    const [launched] = parseEventLogs({ abi: factoryAbi, eventName: "SeriesLaunched", logs: receipt.logs });
    job.seriesId = Number(launched.args.seriesId);
    db().prepare(
      `INSERT INTO lp_series_meta (id, character_name, character_prompt, pitch, genre, sheet, demo) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET character_name = excluded.character_name, character_prompt = excluded.character_prompt, pitch = excluded.pitch, genre = excluded.genre, sheet = excluded.sheet, demo = excluded.demo`,
    ).run(job.seriesId, r.characterName, r.characterPrompt, r.pitch, r.genre ?? null, job.sheet, r.demo ? 1 : 0);
    job.stage = "done";
    saveLaunchJob(job);
  } catch (e) {
    console.error(`[koma] launch ${job.id} failed`, e);
    job.failedAt = job.stage;
    job.stage = "error";
    job.error = reason(e).slice(0, 300);
    saveLaunchJob(job);
  } finally {
    running.delete(job.id);
  }
}

/** Resume launches that were paid for (settled) before a restart. */
export async function recoverLaunches() {
  for (const job of unfinishedLaunchJobs()) {
    if (job.stage === "settling" && !job.paymentTx) {
      // Crash between settlement and bookkeeping: the USDC authorization tells us if it went through.
      const used = await publicClient
        .readContract({ address: config.network.usdc, abi: usdcAbi, functionName: "authorizationState", args: [job.payer, job.nonce] })
        .catch(() => false);
      if (used) {
        void runLaunch(job);
        continue;
      }
      if (Date.now() / 1000 > job.validBefore + 60) {
        job.stage = "error";
        job.error = "The payment never settled, so no USDC moved. You can try again.";
        saveLaunchJob(job);
      }
      continue;
    }
    void runLaunch(job);
  }
}
