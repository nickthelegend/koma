// Buys one comic over x402 the way an AI agent would: no UI, just a wallet.
//   BUYER_KEY=0x… node scripts/buy-comic.mjs "a kaiju on its lunch break" [pages] [style] [genre] [cast ids…]
//   KOMA_URL defaults to http://localhost:4310
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const base = process.env.KOMA_URL ?? "http://localhost:4310";
const key = process.env.BUYER_KEY;
if (!key) throw new Error("BUYER_KEY missing");
const [prompt = "A tired courier races a thunderstorm to deliver a cake to the moon.", pages = "1", style = "pop-art", genre, ...cast] = process.argv.slice(2);

const account = privateKeyToAccount(key);
// Allow exactly the USDC this KOMA server charges in, on its network.
const status = await (await fetch(`${base}/api/status`)).json();
const client = x402Client.fromConfig({
  schemes: [{ network: status.caip, client: new ExactEvmScheme(account) }],
  spendControls: { allowedAssets: [{ network: status.caip, asset: status.usdc, maxAmountPerPayment: "1800000" }] },
});
const pay = wrapFetchWithPayment(fetch, client);

console.log(`buyer ${account.address}`);
const res = await pay(`${base}/api/comics`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt, pages: Number(pages), style, genre, cast }),
});
const body = await res.json();
if (res.status !== 202) {
  console.error(res.status, body);
  process.exit(1);
}
const settled = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
console.log(`paid: ${settled?.transaction} · job ${body.jobId}`);

let last = "";
for (;;) {
  let job;
  try {
    job = await (await fetch(`${base}/api/jobs/${body.jobId}`)).json();
  } catch {
    // Server restarting: the job is safe in its database and resumes on boot.
    if (last !== "waiting") console.log("server unreachable, retrying…");
    last = "waiting";
    await new Promise((r) => setTimeout(r, 3000));
    continue;
  }
  const line = `${job.stage}${job.stage === "drawing" ? ` ${job.drawn}/${job.total}` : ""}${job.script ? ` · “${job.script.title}”` : ""}`;
  if (line !== last) console.log(line);
  last = line;
  if (job.stage === "done") {
    console.log(`minted token #${job.tokenId} (${job.mintTx}) → ${base}/c/${job.id}`);
    break;
  }
  if (job.stage === "error") {
    console.error(`failed at ${job.failedAt}: ${job.error}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
