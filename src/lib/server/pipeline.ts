import { createHash, randomInt } from "node:crypto";
import { keccak256, parseAbi, parseEventLogs, stringToBytes } from "viem";
import { cast as roster, styles } from "@/lib/studio-config";
import { komaAbi } from "@/lib/koma-abi";
import { findComic } from "@/lib/catalog";
import { short } from "@/lib/format";
import type { Balloon, Comic, Job, PanelShape } from "@/lib/types";
import { draw, writeScript, type Corner, type Script, type ScriptBalloon } from "./ai";
import { assertConfigured, config, publicClient, serverWallet } from "./config";
import { artPath, bump, saveArt, saveIssue, saveJob, unfinishedJobs } from "./store";
import { readFile } from "node:fs/promises";
import { seriesRow } from "./launchpad/queries";
import { proposeOrQueue } from "./launchpad/canon";

const SHAPES: PanelShape[] = ["wide", "square", "square", "wide"];

/** Turn a script corner into lettering coordinates for a 1-2-1 panel. */
function place(b: ScriptBalloon, shape: PanelShape, stack: number): Balloon {
  const wide = shape === "wide";
  const left = b.at.endsWith("left");
  const top = b.at.startsWith("top");
  if (b.kind === "sfx") {
    return { kind: "sfx", text: b.text.toUpperCase(), x: left ? 6 : wide ? 62 : 50, y: top ? 12 + stack * 18 : 64 - stack * 18, tilt: left ? 8 : -8 };
  }
  const w = b.kind === "caption" ? (wide ? 40 : 60) : wide ? 32 : 60;
  return {
    kind: b.kind,
    text: b.text,
    x: left ? 3 : 100 - w - 4,
    y: top ? 5 + stack * 22 : 68 - stack * 22,
    w,
    tail: b.kind === "speech" ? (left ? "right" : "left") : undefined,
  };
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: size }, async () => {
    while (queue.length) await run(queue.shift()!);
  }));
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const g = globalThis as unknown as { __komaRunning?: Set<string> };
const running = (g.__komaRunning ??= new Set<string>());

/** Paid → script → panels → lettering → mint. Runs after the x402 payment settles. */
export async function runJob(job: Job) {
  if (running.has(job.id)) return;
  running.add(job.id);
  try {
    assertConfigured();
    job.error = undefined;
    job.failedAt = undefined;
    const { order } = job;
    const style = styles.find((s) => s.id === order.style) ?? styles[0];
    const cast = [...roster.filter((c) => order.cast.includes(c.id)), ...(order.custom ?? [])];
    const remix = order.remixOf ? await findComic(order.remixOf) : null;
    // Series episodes star the series' character, drawn from its minted character sheet.
    const series = order.seriesId ? seriesRow(order.seriesId) : null;
    if (order.seriesId && !series) throw new Error(`Series #${order.seriesId} isn't indexed yet.`);
    let refs: string[] | undefined;
    if (series?.sheet) {
      const sheetFile = artPath(series.sheet.split("/")[3], "sheet.jpg");
      const sheetBytes = sheetFile ? await readFile(sheetFile) : null;
      if (!sheetBytes) throw new Error(`Character sheet for series #${series.id} is missing.`);
      refs = [`data:image/jpeg;base64,${sheetBytes.toString("base64")}`];
      if (!cast.some((c) => c.name === series.character_name)) {
        cast.unshift({ name: series.character_name!, look: series.character_prompt || series.character_name! });
      }
    }
    const lead = series ? { refs, character: series.character_name! } : undefined;

    // 1. Script (kept on the job, so a restart continues the same story)
    let script = job.work?.script as Script | undefined;
    if (!script) {
      job.stage = "writing";
      job.drawn = 0;
      await saveJob(job);
      const prompt = series ? `Episode for the series "${series.name}" starring ${series.character_name}. Series pitch: ${series.pitch}. This episode: ${order.prompt}` : order.prompt;
      script = await writeScript({ prompt, title: order.title, pages: order.pages, style: style.label, genre: order.genre, cast, remix: remix ?? undefined });
      job.work = { script, seed: randomInt(1, 2 ** 31) };
      job.script = { title: script.title, logline: script.logline };
      job.pages = script.pages.map((p) => ({
        panels: p.panels.map((pn, i) => ({ img: "", alt: pn.alt, shape: SHAPES[i], balloons: [] })),
      }));
      job.total = order.pages * 4;
    }
    const work = job.work!;
    const seed = work.seed;
    job.stage = "drawing";
    await saveJob(job);

    // 2. Art: every panel plus the cover, a few at a time, saved as they land.
    // Panels already on disk from before a restart are kept, not redrawn.
    const hashes: string[][] = job.pages.map(() => []);
    for (const [pi, p] of job.pages.entries()) {
      for (const [n, pn] of p.panels.entries()) {
        const file = pn.img && artPath(job.id, `p${pi + 1}-${n + 1}.jpg`);
        const bytes = file ? await readFile(file).catch(() => null) : null;
        if (bytes) hashes[pi][n] = sha256(bytes);
        else pn.img = "";
      }
    }
    job.drawn = hashes.flat().filter(Boolean).length;
    const coverFile = work.cover && artPath(job.id, "cover.jpg");
    let cover = coverFile && (await readFile(coverFile).then(() => work.cover!, () => "")) || "";
    const tasks = [
      ...(cover ? [] : [{ kind: "cover" as const }]),
      ...script.pages.flatMap((p, pi) => p.panels.map((pn, n) => ({ kind: "panel" as const, pi, n, shot: pn.shot }))).filter((t) => !hashes[t.pi][t.n]),
    ];
    const s = script;
    await pool(tasks, 5, async (t) => {
      if (t.kind === "cover") {
        const bytes = await draw(`${style.prompt}, comic book cover illustration, bold dynamic composition, ${s.cover}`, "portrait_4_3", seed, lead);
        cover = await saveArt(job.id, "cover.jpg", bytes);
        work.cover = cover;
        await saveJob(job);
        return;
      }
      const shape = SHAPES[t.n];
      const bytes = await draw(`${style.prompt}, ${t.shot}`, shape === "wide" ? "landscape_16_9" : "square_hd", seed + t.pi * 4 + t.n + 1, lead);
      hashes[t.pi][t.n] = sha256(bytes);
      job.pages[t.pi].panels[t.n].img = await saveArt(job.id, `p${t.pi + 1}-${t.n + 1}.jpg`, bytes);
      job.drawn += 1;
      await saveJob(job);
    });

    // 3. Lettering: live text over the art, placed by the script's corners
    job.stage = "lettering";
    job.pages.forEach((p, pi) =>
      p.panels.forEach((pn, n) => {
        const seen = new Map<Corner, number>();
        pn.balloons = script.pages[pi].panels[n].balloons.map((b) => {
          const k = seen.get(b.at) ?? 0;
          seen.set(b.at, k + 1);
          return place(b, pn.shape, k);
        });
      }),
    );
    await saveJob(job);

    // 4. Mint: the token commits to the exact art and words the reader sees
    job.stage = "minting";
    await saveJob(job);
    const contentHash = keccak256(
      stringToBytes(
        JSON.stringify({
          title: script.title,
          logline: script.logline,
          style: style.id,
          pages: job.pages.map((p, pi) => p.panels.map((pn, n) => ({ art: hashes[pi][n], alt: pn.alt, balloons: pn.balloons }))),
        }),
      ),
    );
    const remixToken = remix ? BigInt(remix.chain.tokenId) : BigInt(0);
    // Idempotent: a payment mints once. If a crash hit after the mint went out,
    // adopt that on-chain token, but only if it commits to these exact pages.
    const already = await publicClient.readContract({ address: config.contract!, abi: komaAbi, functionName: "tokenOfPayment", args: [job.paymentTx!] });
    let mintTx: `0x${string}`;
    if (already > BigInt(0)) {
      const onchain = await publicClient.readContract({ address: config.contract!, abi: komaAbi, functionName: "issue", args: [already] });
      if (onchain.contentHash !== contentHash) throw new Error(`This payment already minted token #${already} with different content.`);
      const [log] = await publicClient.getContractEvents({
        address: config.contract!,
        abi: komaAbi,
        eventName: "IssueMinted",
        args: { paymentTx: job.paymentTx! },
        fromBlock: BigInt(job.sinceBlock ?? 0),
      });
      if (!log) throw new Error(`Token #${already} exists but its mint transaction could not be found.`);
      mintTx = log.transactionHash;
      job.tokenId = Number(already);
    } else {
      mintTx = await serverWallet!.writeContract({
        address: config.contract!,
        abi: komaAbi,
        functionName: "mint",
        args: [job.payer, contentHash, job.paymentTx!, order.pages, remixToken],
      });
      job.mintTx = mintTx;
      await saveJob(job);
      const receipt = await serverWallet!.waitForTransactionReceipt({ hash: mintTx, timeout: 90_000 });
      if (receipt.status !== "success") throw new Error("Mint transaction reverted");
      const [minted] = parseEventLogs({ abi: komaAbi, eventName: "IssueMinted", logs: receipt.logs });
      job.tokenId = Number(minted.args.tokenId);
    }
    job.mintTx = mintTx;

    const comic: Comic = {
      id: job.id,
      title: script.title,
      logline: script.logline,
      genre: script.genre,
      style: style.label,
      cover,
      tone: style.tone,
      creator: { name: short(job.payer, 6, 4), address: job.payer },
      pageCount: order.pages,
      priceUsdc: job.amountUsdc,
      reads: 0,
      remixes: 0,
      createdAt: job.createdAt,
      remixOf: remix ? { id: remix.id, title: remix.title } : undefined,
      cast: cast.length ? cast.map((c) => c.name) : undefined,
      series: series ? { id: series.id, name: series.name, symbol: series.symbol } : undefined,
      chain: {
        network: job.network,
        tokenId: job.tokenId,
        contract: config.contract!,
        mintTx,
        paymentTx: job.paymentTx!,
        contentHash,
        paidUsdc: job.amountUsdc,
      },
      pages: job.pages,
    };
    await saveIssue(comic);
    if (remix) await bump(remix.id, "remixes");
    // 5. Canon: propose the episode (or queue it for the next slot if voting just closed)
    if (series && !job.canon?.proposed) {
      job.canon = { seriesId: series.id, ...(await proposeOrQueue(series.id, job.tokenId!, job.payer, job.id)) };
    }
    job.stage = "done";
    await saveJob(job);
  } catch (e) {
    console.error(`[koma] job ${job.id} failed`, e);
    job.failedAt = job.stage;
    job.stage = "error";
    job.error = (e as Error).message.slice(0, 300);
    await saveJob(job);
  } finally {
    running.delete(job.id);
  }
}

const usdcAbi = parseAbi([
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)",
]);

/**
 * After a restart: finish every job that took payment. A job the crash caught
 * between settlement and bookkeeping is matched to its on-chain settlement by
 * the USDC authorization nonce.
 */
export async function recoverJobs() {
  if (config.missing.length) return;
  for (const job of await unfinishedJobs()) {
    if (running.has(job.id)) continue;
    try {
      if (!job.paymentTx) {
        if (!job.nonce) throw new Error("Payment record incomplete.");
        const used = await publicClient.readContract({ address: config.network.usdc, abi: usdcAbi, functionName: "authorizationState", args: [job.payer, job.nonce] });
        if (!used) {
          if (Date.now() / 1000 < (job.validBefore ?? 0)) {
            setTimeout(() => void recoverJobs(), 30_000);
            continue;
          }
          job.stage = "error";
          job.failedAt = "settling";
          job.error = "The payment never settled, so no USDC moved. You can try again.";
          await saveJob(job);
          continue;
        }
        const [log] = await publicClient.getLogs({
          address: config.network.usdc,
          event: usdcAbi[1],
          args: { authorizer: job.payer, nonce: job.nonce },
          fromBlock: BigInt(job.sinceBlock ?? 0),
        });
        if (!log) throw new Error("Payment settled but its transaction could not be found.");
        job.paymentTx = log.transactionHash;
      }
      console.log(`[koma] resuming job ${job.id} from ${job.stage}`);
      void runJob(job);
    } catch (e) {
      job.stage = "error";
      job.error = (e as Error).message;
      await saveJob(job);
    }
  }
}
