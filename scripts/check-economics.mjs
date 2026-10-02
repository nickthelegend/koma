// On-chain launchpad checks on the LOCAL fork, through the running server's real relayer:
// fee split, remix royalties, the $3 relay floor, the graduation fee, trading in a graduated
// (Graduator-hooked) v4 pool, slippage/tamper refusal, gasless sells, anti-snipe, and a canon
// proposal ready for a browser vote. Series are launched straight through SeriesFactory with the
// relayer key, so this needs no fal credit (they have no character art).
//   npm run chain & npm run dev, then: npm run check:economics
// Local fork only: it funds test wallets with anvil_setStorageAt.
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createPublicClient, createWalletClient, encodeAbiParameters, http, keccak256, pad, parseAbi, parseEventLogs, stringToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const RPC = "http://127.0.0.1:18611", BASE = "http://localhost:4310";
const chain = createPublicClient({ transport: http(RPC) });
const LP = JSON.parse(readFileSync(".data/addresses.local.json", "utf8"));
const USDC = LP.usdc, chainId = await chain.getChainId();
const relayer = createWalletClient({ account: privateKeyToAccount(env.SERVER_PRIVATE_KEY), transport: http(RPC) });
const agent = privateKeyToAccount(env.TEST_AGENT_KEY), payto = privateKeyToAccount(env.TEST_PAYTO_KEY), creator = privateKeyToAccount(env.TEST_BROWSER_KEY);
const U = (n) => BigInt(Math.round(n * 1e6));
const usdc = (a) => chain.readContract({ address: USDC, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [a] });
const fund = async (a, n) => chain.request({ method: "anvil_setStorageAt", params: [USDC, keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [a, 9n])), pad(toHex(U(n)), { size: 32 })] });
const factoryAbi = parseAbi([
  "struct LaunchParams { address creator; string name; string symbol; string characterName; bytes32 sheetHash; uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow; }",
  "function launch(LaunchParams p) returns (uint256)",
  "event SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)",
]);
const curveAbi = parseAbi(["function quoteBuy(uint256) view returns (uint256,uint256,uint256)"]);
const gradAbi = parseAbi(["event GraduationFee(uint256 indexed seriesId, uint256 usdcFee)", "event PoolCreated(uint256 indexed seriesId, bytes32 poolId, uint160 sqrtPriceX96, uint256 usdcToPool, uint256 coinToPool, uint256 liquidity)"]);
const results = [];
const check = (id, name, ok, detail) => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${id} ${name} — ${detail}`); };
async function launch(name, parent) {
  const hash = await relayer.writeContract({ chain: null, address: LP.seriesFactory, abi: factoryAbi, functionName: "launch", args: [{ creator: creator.address, name, symbol: name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase(), characterName: name, sheetHash: keccak256(stringToBytes(name)), parentSeriesId: BigInt(parent), graduationTarget: U(25), votingWindow: 300n }] });
  const rc = await chain.waitForTransactionReceipt({ hash });
  const [e] = parseEventLogs({ abi: factoryAbi, eventName: "SeriesLaunched", logs: rc.logs });
  for (let i = 0; i < 20 && !(await fetch(`${BASE}/api/series/${e.args.seriesId}`)).ok; i++) await new Promise((r) => setTimeout(r, 1000));
  return e.args;
}
async function buy(acct, curve, n) {
  const usdcIn = U(n);
  const [out] = await chain.readContract({ address: curve, abi: curveAbi, functionName: "quoteBuy", args: [usdcIn] });
  const minCoinOut = (out * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 600), salt = toHex(randomBytes(32));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), curve, acct.address, usdcIn, minCoinOut, deadline, salt]));
  const signature = await acct.signTypedData({ domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: acct.address, to: curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
  const res = await fetch(`${BASE}/api/trade/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "buy", curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature }) });
  const j = await res.json();
  if (!res.ok) return { error: j.error };
  const rc = await chain.waitForTransactionReceipt({ hash: j.txHash });
  return rc.status === "success" ? { rc } : { error: "reverted" };
}
for (const a of [agent, payto, creator]) await fund(a.address, 100);
await relayer.request({ method: "anvil_setBalance", params: [relayer.account.address, "0x56BC75E2D63100000"] }).catch(() => {});

const S = await launch("Fee Check", 0);
let t0 = await usdc(S.characterAccount), tr0 = await usdc(LP.treasury);
const b = await buy(agent, S.curve, 10);
const ch = (await usdc(S.characterAccount)) - t0, tr = (await usdc(LP.treasury)) - tr0;
check("E1", "1.5% fee on a $10 buy, 40/20/40 with no parent → character 0.09, treasury 0.06", !b.error && ch === 90000n && tr === 60000n, b.error ?? `character +${Number(ch) / 1e6}, treasury +${Number(tr) / 1e6}`);

const before = await usdc(agent.address);
const small = await buy(agent, S.curve, 2);
check("E2", "relayer refuses gasless buys under $3, nothing moves", /start at \$3/.test(small.error ?? "") && (await usdc(agent.address)) === before, small.error ?? "relayed");

const R = await launch("Fee Remix", Number(S.seriesId));
t0 = await usdc(S.characterAccount); const c0 = await usdc(R.characterAccount); tr0 = await usdc(LP.treasury);
const r = await buy(agent, R.curve, 10);
const par = (await usdc(S.characterAccount)) - t0, kid = (await usdc(R.characterAccount)) - c0, tr2 = (await usdc(LP.treasury)) - tr0;
check("E3", "remix: parent 10% (0.015), child 50% (0.075), treasury 40% (0.06)", !r.error && par === 15000n && kid === 75000n && tr2 === 60000n, r.error ?? `parent +${Number(par) / 1e6}, child +${Number(kid) / 1e6}, treasury +${Number(tr2) / 1e6}`);

const G = await launch("Grad Check", 0);
await buy(agent, G.curve, 12); await buy(payto, G.curve, 9); await buy(creator, G.curve, 8);
let fee = null, pool = null;
for (let i = 0; i < 60 && !pool; i++) {
  const logs = await chain.getLogs({ address: LP.graduator, fromBlock: "earliest" });
  const ev = parseEventLogs({ abi: gradAbi, logs }).filter((x) => x.args.seriesId === G.seriesId);
  fee = ev.find((x) => x.eventName === "GraduationFee"); pool = ev.find((x) => x.eventName === "PoolCreated");
  if (!pool) await new Promise((r2) => setTimeout(r2, 2000));
}
check("E4", "graduation at 25 USDC: 5% (1.25) to treasury, 23.75 into the v4 pool, by the keeper", !!fee && fee.args.usdcFee === 1250000n && !!pool && pool.args.usdcToPool === 23750000n, fee && pool ? `fee ${Number(fee.args.usdcFee) / 1e6}, pool ${Number(pool.args.usdcToPool) / 1e6} USDC` : "not graduated");
// E5: trade in the graduated pool (its hook is the Graduator) — quote via the v4 Quoter, gasless buy via the relayer.
if (pool) {
  for (let i = 0; i < 30; i++) { const x = await (await fetch(`${BASE}/api/series/${G.seriesId}`)).json(); if (x.graduated) break; await new Promise((r) => setTimeout(r, 1000)); }
  const swapAbi = parseAbi(["function swapNonce(address,uint256,uint256,uint256,uint256,bytes32) view returns (bytes32)"]);
  const keyAbi = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "function poolKeyOf(uint256) view returns (PoolKey)"]);
  const quoterAbi = parseAbi(["struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }", "struct Q { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }", "function quoteExactInputSingle(Q params) returns (uint256 amountOut, uint256 gasEstimate)"]);
  const key = await chain.readContract({ address: LP.graduator, abi: keyAbi, functionName: "poolKeyOf", args: [G.seriesId] });
  const { result } = await chain.simulateContract({ address: LP.v4Quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: key.currency0.toLowerCase() === USDC.toLowerCase(), exactAmount: U(3), hookData: "0x" }] });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600), salt = toHex(randomBytes(32)), minOut = (result[0] * 99n) / 100n;
  const nonce = await chain.readContract({ address: LP.swapper, abi: swapAbi, functionName: "swapNonce", args: [payto.address, G.seriesId, U(3), minOut, deadline, salt] });
  const signature = await payto.signTypedData({ domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: payto.address, to: LP.swapper, value: U(3), validAfter: 0n, validBefore: deadline, nonce } });
  const coin = parseAbi(["function balanceOf(address) view returns (uint256)"]);
  const before = await chain.readContract({ address: G.coin, abi: coin, functionName: "balanceOf", args: [payto.address] });
  const res = await fetch(`${BASE}/api/trade/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "swap-buy", seriesId: Number(G.seriesId), buyer: payto.address, usdcIn: String(U(3)), minCoinOut: String(minOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature }) });
  const j = await res.json();
  const rc = j.txHash ? await chain.waitForTransactionReceipt({ hash: j.txHash }) : null;
  const got = (await chain.readContract({ address: G.coin, abi: coin, functionName: "balanceOf", args: [payto.address] })) - before;
  check("E5", "graduated pool (Graduator hook): Quoter prices it and a gasless $3 buy through the relayer returns ≥ the quote less 1%", rc?.status === "success" && got >= minOut, j.error ?? `hooks=${key.hooks.slice(0, 10)}… quoted ${result[0]}, got ${got}`);
}
// ——— E6–E9: slippage/tamper, gasless sell, anti-snipe, canon proposal for the browser vote ———
async function signedBuy(acct, curve, usdcIn, minCoinOut) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600), salt = toHex(randomBytes(32));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }], [keccak256(stringToBytes("KOMA_BUY_V1")), curve, acct.address, usdcIn, minCoinOut, deadline, salt]));
  const signature = await acct.signTypedData({ domain: { name: "USD Coin", version: "2", chainId, verifyingContract: USDC }, types: { ReceiveWithAuthorization: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" }, { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" }] }, primaryType: "ReceiveWithAuthorization", message: { from: acct.address, to: curve, value: usdcIn, validAfter: 0n, validBefore: deadline, nonce } });
  return { kind: "buy", curve, buyer: acct.address, usdcIn: String(usdcIn), minCoinOut: String(minCoinOut), deadline: String(deadline), salt, validAfter: "0", validBefore: String(deadline), signature };
}
const relayPost = async (body) => { const r = await fetch(`${BASE}/api/trade/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) return { error: j.error }; const rc = await chain.waitForTransactionReceipt({ hash: j.txHash }); return rc.status === "success" ? { rc } : { error: "reverted" }; };
const [q3] = await chain.readContract({ address: S.curve, abi: curveAbi, functionName: "quoteBuy", args: [U(3)] });
const b6 = await usdc(agent.address);
const tooHigh = await relayPost(await signedBuy(agent, S.curve, U(3), q3 * 2n));
const tampered = await signedBuy(agent, S.curve, U(3), q3);
tampered.minCoinOut = "1";
const tamperRes = await relayPost(tampered);
check("E6", "slippage: min-out above the quote refused; a relayer-loosened min-out refused by USDC; no USDC moves", !!tooHigh.error && !!tamperRes.error && (await usdc(agent.address)) === b6, `${tooHigh.error} / ${tamperRes.error}`);

const coinAbi = parseAbi(["function balanceOf(address) view returns (uint256)", "function name() view returns (string)", "function nonces(address) view returns (uint256)"]);
const sellNonceAbi = parseAbi(["function sellNonces(address) view returns (uint256)", "function quoteSell(uint256) view returns (uint256,uint256)"]);
const held = await chain.readContract({ address: S.coin, abi: coinAbi, functionName: "balanceOf", args: [agent.address] });
const part = held / 2n;
const [outGross] = await chain.readContract({ address: S.curve, abi: sellNonceAbi, functionName: "quoteSell", args: [part] });
const minOut = (outGross * 99n) / 100n, deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
const [cname, pnonce, snonce] = await Promise.all([chain.readContract({ address: S.coin, abi: coinAbi, functionName: "name" }), chain.readContract({ address: S.coin, abi: coinAbi, functionName: "nonces", args: [agent.address] }), chain.readContract({ address: S.curve, abi: sellNonceAbi, functionName: "sellNonces", args: [agent.address] })]);
const permit = await agent.signTypedData({ domain: { name: cname, version: "1", chainId, verifyingContract: S.coin }, types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] }, primaryType: "Permit", message: { owner: agent.address, spender: S.curve, value: part, nonce: pnonce, deadline } });
const intentSignature = await agent.signTypedData({ domain: { name: "KOMA Curve", version: "1", chainId, verifyingContract: S.curve }, types: { Sell: [{ name: "seller", type: "address" }, { name: "coinIn", type: "uint256" }, { name: "minUsdcOut", type: "uint256" }, { name: "deadline", type: "uint256" }, { name: "nonce", type: "uint256" }] }, primaryType: "Sell", message: { seller: agent.address, coinIn: part, minUsdcOut: minOut, deadline, nonce: snonce } });
const b7 = await usdc(agent.address);
const sold = await relayPost({ kind: "sell", curve: S.curve, seller: agent.address, coinIn: String(part), minUsdcOut: String(minOut), deadline: String(deadline), permit, intentSignature });
const gained = (await usdc(agent.address)) - b7;
check("E7", "gasless sell (permit + signed intent) relayed; seller receives ≥ the 1% floor", !sold.error && gained >= minOut, sold.error ?? `sold half for ${Number(gained) / 1e6} USDC`);

const N = await launch("Snipe Check", 0);
const snipe = await buy(agent, N.curve, 23);
check("E8", "anti-snipe: one wallet taking >2% of supply in the first 10 minutes is refused", !!snipe.error, snipe.error ?? "went through");

// Canon: the character owner (browser test wallet) buys first so the snapshot gives it weight, then the relayer proposes an existing minted issue.
await buy(creator, S.curve, 3);
const issues = await (await fetch(`${BASE}/api/comics`)).json();
const canonAbi = parseAbi(["function propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256)", "function seriesOfIssue(uint256) view returns (uint256 seriesId, uint256 episode, address proposer)"]);
// An issue can be proposed only once, ever, so take the newest one no earlier run has used.
let pick;
for (const id of issues.comics.map((c) => c.chain.tokenId).sort((x, y) => y - x)) {
  const [taken] = await chain.readContract({ address: LP.canonRegistry, abi: canonAbi, functionName: "seriesOfIssue", args: [BigInt(id)] });
  if (taken === 0n) { pick = id; break; }
}
if (pick === undefined) throw new Error("E9 needs a minted issue that has never been proposed; make one in the studio first");
await new Promise((r) => setTimeout(r, 2000));
const ph = await relayer.writeContract({ chain: null, address: LP.canonRegistry, abi: canonAbi, functionName: "propose", args: [S.seriesId, BigInt(pick), creator.address] });
const prc = await chain.waitForTransactionReceipt({ hash: ph });
check("E9", "relayer proposes an existing minted issue for episode 1 (owner of the character as proposer)", prc.status === "success", `series #${S.seriesId}, issue #${pick}, tx ${ph}`);
console.log(`     browser vote target: /s/${S.seriesId}`);
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
