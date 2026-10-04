// Demo seed for the video: launches named series (art = real KOMA comic panels), adds trades from
// fresh wallets, graduates one, sets up canon. Local fork only. Run from koma/: node .data/demo/seed.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, pad, parseAbi, parseEventLogs, stringToBytes, toHex } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const RPC = "http://127.0.0.1:18611", BASE = "http://localhost:4310";
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const USDC = LP.usdc, chainId = await chain.getChainId();
const relayer = createWalletClient({ account: privateKeyToAccount(env.SERVER_PRIVATE_KEY), transport: http(RPC) });
const browser = privateKeyToAccount(env.TEST_BROWSER_KEY);
const U = (n) => BigInt(Math.round(n * 1e6));
const fund = (a, n) => chain.request({ method: "anvil_setStorageAt", params: [USDC, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 9n])), pad(toHex(U(n)), { size: 32 })] });
const factoryAbi = parseAbi([
  "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
  "function launch(LaunchParams p) returns (uint256)",
  "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
]);
const curveAbi = parseAbi(["function quoteBuy(uint256) view returns (uint256,uint256,uint256)"]);
const canonAbi = parseAbi(["function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256)", "function seriesOfIssue(uint256) view returns (uint256,uint256,address)"]);
const db = new DatabaseSync(".data/koma.db");
db.exec("PRAGMA busy_timeout = 15000");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wallets = Array.from({ length: 7 }, () => privateKeyToAccount(generatePrivateKey()));
for (const w of wallets) await fund(w.address, 200);
await fund(browser.address, 150);
await relayer.request({ method: "anvil_setBalance", params: [relayer.account.address, "0x56BC75E2D63100000"] }).catch(() => {});

async function launch({ name, symbol, character, art, pitch, genre, parent = 0, window = 300n, creator = browser.address }) {
  const bytes = readFileSync(`.data/art/${art}`);
  // Idempotent: a series already launched under this name is reused (its metadata is refreshed below).
  for (let i = 0; i < 15 && !db.prepare("SELECT 1 FROM lp_series WHERE name = ?").get(name) && name === "Storm Chasers"; i++) await sleep(1000);
  const existing = db.prepare("SELECT id, coin, curve, character_account AS characterAccount FROM lp_series WHERE name = ?").get(name);
  if (existing) {
    const id = existing.id;
    mkdirSync(`.data/art/s-demo-${id}`, { recursive: true });
    copyFileSync(`.data/art/${art}`, `.data/art/s-demo-${id}/sheet.jpg`);
    db.prepare(`INSERT INTO lp_series_meta (id, character_name, character_prompt, pitch, genre, sheet, demo) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET character_name=excluded.character_name, pitch=excluded.pitch, genre=excluded.genre, sheet=excluded.sheet, demo=1`)
      .run(id, character, "", pitch, genre, `/api/art/s-demo-${id}/sheet.jpg`);
    console.log(`reused #${id} ${name}`);
    return { ...existing, seriesId: BigInt(id), id, reused: true };
  }
  const sheetHash = keccak256(new Uint8Array(bytes));
  let rc;
  for (let attempt = 0; attempt < 4 && !rc; attempt++) {
    // The keeper sends from the same key; a nonce clash drops one of the two, so retry.
    const hash = await relayer.writeContract({ chain: null, address: LP.seriesFactory, abi: factoryAbi, functionName: "launch", args: [{ creator, name, symbol, characterName: character, sheetHash, parentSeriesId: BigInt(parent), graduationTarget: U(25), votingWindow: window }] });
    rc = await chain.waitForTransactionReceipt({ hash, timeout: 25_000 }).catch(() => null);
  }
  const [e] = parseEventLogs({ abi: factoryAbi, eventName: "SeriesLaunched", logs: rc.logs });
  const id = Number(e.args.seriesId);
  mkdirSync(`.data/art/s-demo-${id}`, { recursive: true });
  copyFileSync(`.data/art/${art}`, `.data/art/s-demo-${id}/sheet.jpg`);
  db.prepare(`INSERT INTO lp_series_meta (id, character_name, character_prompt, pitch, genre, sheet, demo) VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET character_name=excluded.character_name, pitch=excluded.pitch, genre=excluded.genre, sheet=excluded.sheet, demo=1`)
    .run(id, character, "", pitch, genre, `/api/art/s-demo-${id}/sheet.jpg`);
  for (let i = 0; i < 30 && !(await fetch(`${BASE}/api/series/${id}`)).ok; i++) await sleep(1000);
  console.log(`launched #${id} ${name} $${symbol}`);
  return { ...e.args, id };
}
async function buy(acct, curve, n) {
  const usdcIn = U(n);
  const [out] = await chain.readContract({ address: curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  const minCoinOut = (out * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 3600), salt = toHex(randomBytes(32));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), curve, acct.address, usdcIn, minCoinOut, deadline, salt]));
  const signature = await acct.signTypedData({ domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: acct.address, to: curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
  const res = await fetch(`${BASE}/api/trade/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "buy", curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature }) });
  const j = await res.json();
  if (!res.ok) { console.log("  buy failed:", j.error); return; }
  await chain.waitForTransactionReceipt({ hash: j.txHash });
}
const free = [];
for (const t of [29, 24, 22, 26, 21, 19, 11, 10, 25, 14, 17, 16, 18, 20]) {
  const [s] = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "seriesOfIssue", args: [BigInt(t)] });
  if (s === 0n) free.push(t);
}
console.log("unproposed issues:", free.join(","));

const out = {};
// 1. Storm Chasers — graduates during seeding (shows the v4 pool on the board).
const storm = await launch({ name: "Storm Chasers", symbol: "STORM", character: "Aoi Kaze", art: "95600cc3ea/cover.jpg", pitch: "Two rival racers share one car to outrun a storm that eats cities.", genre: "Sci-fi" });
if (!storm.reused) for (const [w, n] of [[0, 9], [1, 8], [2, 6], [3, 5]]) await buy(wallets[w], storm.curve, n);
out.storm = storm.id;
// 2. The Last Bowl (Madame Wok) — parked near graduation; the browser finishes it on camera.
const wok = await launch({ name: "The Last Bowl", symbol: "WOK", character: "Madame Wok", art: "6993e02218/cover.jpg", pitch: "A retired superhero runs a noodle stand. Her old enemies keep ordering lunch.", genre: "Superhero" });
for (const [w, n] of [[0, 7], [1, 6], [4, 5], [5, 3]]) await buy(wallets[w], wok.curve, n);
out.wok = wok.id;
// 3. Moon Bowl — a remix of The Last Bowl.
const moon = await launch({ name: "Moon Bowl", symbol: "MOON", character: "Takeshi", art: "462059bc8d/cover.jpg", pitch: "A former sumo wrestler serves ramen on the moon. Sky pirates learn manners.", genre: "Sci-fi", parent: wok.id });
for (const [w, n] of [[2, 6], [3, 4]]) await buy(wallets[w], moon.curve, n);
out.moon = moon.id;
// 4. Junkyard Heart (Juniper Vex) — canon: 60s votes, owned by the browser wallet; episode 1 decided live on camera.
const junk = await launch({ name: "Junkyard Heart", symbol: "JUNK", character: "Juniper Vex", art: "50cf57e973/cover.jpg", pitch: "Juniper steals a racing engine from the junkyard. The engine has opinions.", genre: "Sci-fi", window: 60n });
for (const [w, n] of [[4, 8], [5, 6], [6, 4]]) await buy(wallets[w], junk.curve, n);
await buy(browser, junk.curve, 5);
out.junk = junk.id;
// 5. Fog Keeper (The Keeper) — noir.
const fog = await launch({ name: "Fog Keeper", symbol: "FOG", character: "The Keeper", art: "6d2b1a6c37/cover.jpg", pitch: "A lighthouse keeper makes deals with the fog. The fog keeps its side.", genre: "Noir" });
for (const [w, n] of [[6, 5], [1, 3]]) await buy(wallets[w], fog.curve, n);
out.fog = fog.id;
out.free = free;
out.wallets = wallets.map((w) => w.address);
writeFileSync(".data/demo/seeded.json", JSON.stringify(out, null, 2));
console.log(out);
