// End-to-end API checks against a running KOMA server and its chain.
// Every check is real: real x402 signatures from funded keys, real settlement,
// real minting, real FAL generation. Run after `npm run chain` + local-setup.
//   node scripts/e2e-api.mjs [only=B2,B3,...]
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient, decodePaymentRequiredHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";

const BASE = process.env.KOMA_URL ?? "http://localhost:4310";
const envFile = process.env.KOMA_ENV_FILE ?? ".env.local";
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const status = await (await fetch(`${BASE}/api/status`)).json();
// Against a deployed server, chain reads go through its public RPC proxy.
const RPC = process.env.KOMA_RPC ?? env.NEXT_PUBLIC_ARBITRUM_RPC_URL;
const USDC = status.usdc;
const CONTRACT = status.contract;
const PAY_TO = status.payTo;
const only = process.argv.find((a) => a.startsWith("only="))?.slice(5).split(",");

const KEYS = { agent: env.TEST_AGENT_KEY, empty: env.TEST_EMPTY_KEY };
const reason = (res) => {
  const h = res.headers.get("PAYMENT-REQUIRED");
  return h ? decodePaymentRequiredHeader(h).error ?? "" : "";
};
const chain = createPublicClient({ transport: http(RPC) });
const usdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const komaAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function tokenOfPayment(bytes32) view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
  "function issue(uint256) view returns ((bytes32 contentHash, bytes32 paymentTx, uint256 remixOf, uint64 mintedAt, uint16 pages))",
]);
const bal = (a) => chain.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [a] });
// Local runs can also look straight into the database; remote runs use the public API.
// Only the default local server's database; pass KOMA_DB for another local server.
const dbPath = process.env.KOMA_DB ?? (process.env.KOMA_URL ? null : ".data/koma.db");
const db = dbPath && existsSync(dbPath) ? new DatabaseSync(dbPath, { readOnly: true }) : null;
const getJson = async (path) => (await fetch(`${BASE}${path}`)).json();
/** Everything a payer has on the server: unfinished jobs plus minted issues. */
const activity = async (payer) => (await getJson(`/api/jobs?payer=${payer}`)).jobs.length + (await getJson(`/api/comics?owner=${payer}`)).comics.length;

const results = [];
function check(id, name, ok, detail = "") {
  results.push({ id, name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name}${detail ? ` — ${detail}` : ""}`);
}
const run = (id) => !only || only.includes(id);
// While fal is unavailable the server refuses to quote (so it never takes a payment it can't draw for).
// Checks that need a quote or a paid generation are then reported UNTESTED, not passed or failed.
const aiDown = status.ai && status.ai.ok === false;
const untested = [];
function skipPaid(id, name) {
  if (!aiDown) return false;
  untested.push(id);
  console.log(`UNTESTED ${id} ${name} — fal unavailable (${status.ai.reason})`);
  return true;
}
const post = (body, headers = {}) =>
  fetch(`${BASE}/api/comics`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const httpClient = (key) =>
  new x402HTTPClient(
    x402Client.fromConfig({
      schemes: [{ network: status.caip, client: new ExactEvmScheme(privateKeyToAccount(key)) }],
      spendControls: { allowedAssets: [{ network: status.caip, asset: status.usdc, maxAmountPerPayment: "1800000" }] },
    }),
  );

async function quote(order) {
  const res = await post(order);
  const required = decodePaymentRequiredHeader(res.headers.get("PAYMENT-REQUIRED"));
  return { res, required };
}

async function pollJob(id, timeoutMs = 420_000) {
  const end = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < end) {
    const job = await (await fetch(`${BASE}/api/jobs/${id}`)).json();
    const line = `${job.stage}${job.stage === "drawing" ? ` ${job.drawn}/${job.total}` : ""}`;
    if (line !== last) console.log(`     job ${id}: ${line}`);
    last = line;
    if (job.stage === "done" || job.stage === "error") return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("job timeout");
}

// ——— B2 invalid orders ———
if (run("B2")) {
  const cases = [
    ["prompt < 12", { prompt: "too short" }, /at least one sentence/],
    ["prompt > 600", { prompt: "x".repeat(601) }, /under 600/],
    ["pages = 3", { prompt: "A perfectly fine story idea here.", pages: 3 }, /pages must be one of/],
    ["unknown style", { prompt: "A perfectly fine story idea here.", style: "vaporwave" }, /style must be one of/],
    ["3 cast ids", { prompt: "A perfectly fine story idea here.", cast: ["kuro-yami", "aoi-kaze", "bolt-arai"] }, /at most two/],
    ["unknown cast id", { prompt: "A perfectly fine story idea here.", cast: ["nobody"] }, /cast ids must be from/],
    ["custom without look", { prompt: "A perfectly fine story idea here.", custom: [{ name: "Mika", look: "" }] }, /Describe how Mika looks/],
    ["bad genre", { prompt: "A perfectly fine story idea here.", genre: "Western" }, /genre must be one of/],
    ["non-JSON body", "{not json", /at least one sentence/],
  ];
  let all = true;
  for (const [label, body, re] of cases) {
    const res = await post(body);
    const j = await res.json().catch(() => ({}));
    const ok = res.status === 400 && re.test(j.error ?? "") && !res.headers.get("PAYMENT-REQUIRED");
    if (!ok) console.log(`     ✗ ${label}: ${res.status} ${j.error}`);
    all &&= ok;
  }
  check("B2", "invalid orders → 400 with specific errors, no quote", all);
}

// ——— B3 quotes ———
if (run("B3") && !skipPaid("B3", "402 quotes")) {
  let all = true;
  for (const pages of [1, 2, 4, 6]) {
    const { res, required } = await quote({ prompt: "A perfectly fine story idea here.", pages });
    const a = required.accepts[0];
    const ok =
      res.status === 402 && required.x402Version === 2 && a.scheme === "exact" && a.network === status.caip &&
      a.asset.toLowerCase() === USDC.toLowerCase() && a.amount === String(pages * 100000) &&
      a.payTo.toLowerCase() === PAY_TO.toLowerCase() && a.extra?.name === "USD Coin" && a.extra?.version === "2";
    if (!ok) console.log(`     ✗ pages ${pages}:`, res.status, JSON.stringify(a));
    all &&= ok;
  }
  check("B3", "402 quotes: v2, exact, KOMA network, USDC, pages×100000, payTo, USD Coin/2", all);

  const order = { prompt: "A perfectly fine story idea here.", pages: 4 };
  const direct = decodePaymentRequiredHeader((await post(order)).headers.get("PAYMENT-REQUIRED"));
  const q = await fetch(`${BASE}/api/comics/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(order) });
  const viaQuote = decodePaymentRequiredHeader(q.headers.get("PAYMENT-REQUIRED"));
  const same = JSON.stringify([direct.resource, direct.accepts]) === JSON.stringify([viaQuote.resource, viaQuote.accepts]);
  check("B3b", "quote endpoint: 200 with requirements identical to the 402", q.status === 200 && same);
}

// ——— B7 payer without USDC ———
if (run("B7") && !skipPaid("B7", "0-USDC payer")) {
  const order = { prompt: "A lighthouse keeper befriends a lonely sea serpent.", pages: 1 };
  const { required } = await quote(order);
  const h = httpClient(KEYS.empty);
  const header = h.encodePaymentSignatureHeader(await h.createPaymentPayload(required));
  const emptyPayer = privateKeyToAccount(KEYS.empty).address;
  const before = await activity(emptyPayer);
  const res = await post(order, header);
  const why = reason(res);
  check("B7", "0-USDC payer → 402 insufficient funds, no job", res.status === 402 && /insufficient/i.test(why) && (await activity(emptyPayer)) === before, `${res.status} ${why}`);
}

// ——— B5 tampered price ———
if (run("B5") && !skipPaid("B5", "tampered price")) {
  const small = { prompt: "A tiny robot learns to bake bread for its village.", pages: 1 };
  const { required } = await quote(small);
  const h = httpClient(KEYS.agent);
  const header = h.encodePaymentSignatureHeader(await h.createPaymentPayload(required));
  const payer = privateKeyToAccount(KEYS.agent).address;
  const [b0, jobs0] = [await bal(payer), await activity(payer)];
  const res = await post({ ...small, pages: 6 }, header);
  const [b1, jobs1] = [await bal(payer), await activity(payer)];
  const why = reason(res);
  check("B5", "1-page signature on a 6-page order → 402 (amount mismatch), no job, no charge", res.status === 402 && !/signature|insufficient/i.test(why) && jobs1 === jobs0 && b1 === b0, `${res.status} ${why}`);
}

// ——— B4 paid order + B6 replay + B10 metadata ———
if (run("B4") && !skipPaid("B4", "paid order, B4b genre/cast, B6 replay, B10 token metadata")) {
  const order = {
    prompt: "A retired superhero runs a tiny noodle stand, until her old nemesis orders the special.",
    pages: 1,
    style: "superhero",
    genre: "Superhero",
    custom: [{ name: "Madame Wok", look: "a stocky grey-haired woman in a faded red cape over a noodle-stained apron, with a gold mask pushed up on her forehead" }],
  };
  const { required } = await quote(order);
  const h = httpClient(KEYS.agent);
  const header = h.encodePaymentSignatureHeader(await h.createPaymentPayload(required));
  const payer = privateKeyToAccount(KEYS.agent).address;
  const [pb0, tb0] = [await bal(payer), await bal(PAY_TO)];
  const res = await post(order, header);
  const body = await res.json();
  const settled = h.getPaymentSettleResponse((n) => res.headers.get(n));
  const [pb1, tb1] = [await bal(payer), await bal(PAY_TO)];
  const exact = pb0 - pb1 === 100000n && tb1 - tb0 === 100000n;
  console.log(`     202? ${res.status} job ${body.jobId} tx ${settled?.transaction}; payer −${pb0 - pb1}, payTo +${tb1 - tb0}`);
  const job = await pollJob(body.jobId);
  const issue = (await getJson(`/api/comics?owner=${payer}`)).comics.find((c) => c.id === body.jobId) ?? null;
  let chainOk = false;
  if (job.stage === "done" && issue) {
    const owner = await chain.readContract({ address: CONTRACT, abi: komaAbi, functionName: "ownerOf", args: [BigInt(job.tokenId)] });
    const byPay = await chain.readContract({ address: CONTRACT, abi: komaAbi, functionName: "tokenOfPayment", args: [job.paymentTx] });
    const rec = await chain.readContract({ address: CONTRACT, abi: komaAbi, functionName: "issue", args: [BigInt(job.tokenId)] });
    chainOk = owner.toLowerCase() === payer.toLowerCase() && byPay === BigInt(job.tokenId) && rec.contentHash === issue.chain.contentHash && rec.pages === 1;
    console.log(`     owner ${owner} token ${job.tokenId} tokenOfPayment ${byPay} hash match ${rec.contentHash === issue.chain.contentHash}`);
  }
  const usesCustom = issue && issue.genre === "Superhero" && issue.cast?.includes("Madame Wok");
  check("B4", "paid order: 202, exact USDC moved, done, owner/tokenOfPayment/contentHash on-chain", res.status === 202 && settled?.success && exact && chainOk);
  check("B4b", "genre + designed character stored on the issue", Boolean(usesCustom), `${issue?.genre} / ${issue?.cast}`);

  // B6: replay the same signed payment
  const [rb0, jobsR0] = [await bal(payer), await activity(payer)];
  const replay = await post(order, header);
  const [rb1, jobsR1] = [await bal(payer), await activity(payer)];
  const why = reason(replay);
  check("B6", "replayed PAYMENT-SIGNATURE → rejected (nonce used), no job, no charge", replay.status === 402 && !/signature/i.test(why) && rb1 === rb0 && jobsR1 === jobsR0, `${replay.status} ${why}`);

  // B10: metadata
  if (job.tokenId) {
    const uri = await chain.readContract({ address: CONTRACT, abi: komaAbi, functionName: "tokenURI", args: [BigInt(job.tokenId)] });
    const meta = await (await fetch(uri)).json().catch(() => ({}));
    const img = meta.image ? await fetch(meta.image) : { status: 0, headers: new Headers() };
    const missing = await fetch(`${BASE}/api/tokens/999999`);
    check(
      "B10",
      "tokenURI → metadata; image 200 jpeg; unknown → 404",
      uri === `${status.publicUrl ?? BASE}/api/tokens/${job.tokenId}` && meta.name === `${issue.title} · KOMA #${job.tokenId}` &&
        meta.external_url.endsWith(`/c/${job.id}`) && img.status === 200 && img.headers.get("content-type") === "image/jpeg" && missing.status === 404,
      uri,
    );
  }
}

// ——— B8 jobs lookup ———
if (aiDown && run("B15")) {
  const res = await post({ prompt: "A perfectly fine story idea here.", pages: 1 });
  const j = await res.json().catch(() => ({}));
  check("B15", "fal unavailable → quote refused with 503, no PAYMENT-REQUIRED, says no payment was taken", res.status === 503 && !res.headers.get("PAYMENT-REQUIRED") && /No payment was taken/.test(j.error ?? ""), `${res.status} ${j.error}`);
}

if (run("B8")) {
  const a = await fetch(`${BASE}/api/jobs/ffffffffff`);
  const b = await fetch(`${BASE}/api/jobs/..%2Fx`);
  check("B8", "unknown/malformed job → 404", a.status === 404 && b.status === 404, `${a.status} ${b.status}`);
}

// ——— B9 list ———
if (run("B9")) {
  const all = (await (await fetch(`${BASE}/api/comics`)).json()).comics;
  const agent = privateKeyToAccount(KEYS.agent).address;
  const mine = (await (await fetch(`${BASE}/api/comics?owner=${agent}`)).json()).comics;
  const nobody = (await (await fetch(`${BASE}/api/comics?owner=0x0000000000000000000000000000000000000001`)).json()).comics;
  const sorted = all.every((c, i) => i === 0 || all[i - 1].createdAt >= c.createdAt);
  const dbCount = db ? db.prepare("SELECT count(*) AS n FROM issues").get().n : all.length;
  check(
    "B9",
    "list = DB rows, newest first, no pages; owner filter exact",
    all.length === dbCount && sorted && all.every((c) => c.pages === undefined) && mine.every((c) => c.creator.address.toLowerCase() === agent.toLowerCase()) && nobody.length === 0,
    `${all.length} issues, ${mine.length} for agent`,
  );
}

// ——— B11 art route ———
if (run("B11")) {
  const row = (await getJson("/api/comics")).comics[0];
  const ok1 = row ? (await fetch(`${BASE}/api/art/${row.id}/cover.jpg`)).status === 200 : false;
  const t1 = await fetch(`${BASE}/api/art/..%2F..%2F/koma.db`);
  const t2 = await fetch(`${BASE}/api/art/${row?.id ?? "abcd"}/..%2Fkoma.db`);
  const t3 = await fetch(`${BASE}/api/art/${row?.id ?? "abcd"}/nope.jpg`);
  check("B11", "art 200 for real file; traversal/unknown 404", ok1 && t1.status === 404 && t2.status === 404 && t3.status === 404, `${t1.status} ${t2.status} ${t3.status}`);
}

// ——— B12 facilitator HTTP ———
if (run("B12")) {
  const sup = await (await fetch(`${BASE}/api/facilitator/supported`)).json();
  const hasKind = sup.kinds.some((k) => k.x402Version === 2 && k.scheme === "exact" && k.network === status.caip);
  // The facilitator is independent of the studio: build standard x402 v2 requirements for a 0.10 USDC
  // payment to KOMA's pay-to address straight from /api/status (no studio quote needed).
  const required = {
    x402Version: 2,
    resource: { url: `${BASE}/facilitator-test`, description: "facilitator check", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: status.caip, amount: "100000", asset: USDC, payTo: PAY_TO, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }],
  };
  const h = httpClient(KEYS.agent);
  const payload = await h.createPaymentPayload(required);
  const reqs = required.accepts[0];
  const v = await (await fetch(`${BASE}/api/facilitator/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs }) })).json();
  const bad = structuredClone(payload);
  bad.payload.signature = bad.payload.signature.slice(0, -4) + (bad.payload.signature.endsWith("1b") ? "1c00" : "1b00").slice(0, 4);
  const vb = await (await fetch(`${BASE}/api/facilitator/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x402Version: 2, paymentPayload: bad, paymentRequirements: reqs }) })).json();
  const payer = privateKeyToAccount(KEYS.agent).address;
  const [b0, t0] = [await bal(payer), await bal(PAY_TO)];
  const s = await (await fetch(`${BASE}/api/facilitator/settle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: reqs }) })).json();
  const [b1, t1] = [await bal(payer), await bal(PAY_TO)];
  check(
    "B12",
    "facilitator supported/verify(good,bad)/settle move USDC",
    hasKind && v.isValid === true && vb.isValid === false && s.success === true && /^0x[0-9a-f]{64}$/.test(s.transaction) && b0 - b1 === 100000n && t1 - t0 === 100000n,
    `verify ${v.isValid}/${vb.isValid} (${vb.invalidReason}) settle ${s.success} ${s.transaction}`,
  );
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${untested.length ? `, ${untested.length} untested (${untested.join(", ")})` : ""}`);
process.exit(failed.length ? 1 : 0);
