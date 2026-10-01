// Read-only checks that a KOMA deployment is safe to open to real money.
// Sends no transactions and reads no private keys: everything comes from the
// addresses file, public chain state and the running server's /api/status.
//
//   node scripts/mainnet-preflight.mjs                      # Arbitrum One, deploy/addresses.42161.json
//   KOMA_RPC=<rpc> KOMA_ADDRESSES=<file> KOMA_URL=<server> KOMA_ADMIN=<safe> KOMA_RELAYER=<addr> node scripts/mainnet-preflight.mjs
//
// Exit code 0 only when every check passes.
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, formatEther, formatUnits, http, keccak256, parseAbi, stringToBytes } from "viem";

const RPC = process.env.KOMA_RPC ?? "https://arb1.arbitrum.io/rpc";
const FILE = process.env.KOMA_ADDRESSES ?? "deploy/addresses.42161.json";
const SERVER = process.env.KOMA_URL ?? null;
const EXPECT_CHAIN = Number(process.env.KOMA_CHAIN_ID ?? 42161);
// Gas float the relayer should keep: ~2,000 relayed trades at ~320k gas, plus x402 settlements and mints.
const MIN_RELAYER_ETH = Number(process.env.KOMA_MIN_RELAYER_ETH ?? 0.02);
const NATIVE_USDC = { 42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 421614: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" };

const chain = createPublicClient({ transport: http(RPC) });
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const role = (name) => keccak256(stringToBytes(name));
const ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
const acl = parseAbi(["function hasRole(bytes32 role, address account) view returns (bool)"]);
const has = (address, r, who) => chain.readContract({ address, abi: acl, functionName: "hasRole", args: [r, who] }).catch(() => false);

const chainId = await chain.getChainId();
check("RPC is the expected chain", chainId === EXPECT_CHAIN, `chain ${chainId}`);

if (!existsSync(FILE)) {
  check("addresses file exists", false, `${FILE} not found — deploy first (deploy/MAINNET.md)`);
  process.exit(1);
}
const a = JSON.parse(readFileSync(FILE, "utf8"));
check("addresses file is for this chain", a.chainId === chainId, `file says ${a.chainId}`);
check("curve math runs on Arbitrum Stylus", a.engine === "stylus", `engine ${a.engine}`);
check("USDC is native Circle USDC", (a.usdc ?? "").toLowerCase() === (NATIVE_USDC[chainId] ?? "").toLowerCase(), a.usdc);

const contracts = ["usdc", "komaIssues", "seriesFactory", "characterNft", "canonRegistry", "graduator", "swapper", "curveMath", "royaltyRouter", "poolManager", "positionManager", "permit2", "erc6551Registry", "accountProxy", "accountImpl", "v4Quoter"];
for (const k of contracts) {
  const code = a[k] ? await chain.getCode({ address: a[k] }) : null;
  check(`${k} has code`, !!code && code !== "0x", a[k] ?? "missing");
}

const admin = process.env.KOMA_ADMIN ?? a.admin;
const relayer = process.env.KOMA_RELAYER ?? a.relayer;
const deployer = a.deployer;
if (admin) {
  const adminCode = await chain.getCode({ address: admin });
  check("admin is a contract (multisig)", !!adminCode && adminCode !== "0x", admin);
  for (const k of ["seriesFactory", "characterNft", "canonRegistry", "graduator", "komaIssues"]) {
    check(`${k}: admin holds DEFAULT_ADMIN_ROLE`, await has(a[k], ADMIN_ROLE, admin));
    if (deployer && deployer.toLowerCase() !== admin.toLowerCase()) check(`${k}: deployer renounced admin`, !(await has(a[k], ADMIN_ROLE, deployer)), deployer);
    if (relayer) check(`${k}: relayer is not admin`, !(await has(a[k], ADMIN_ROLE, relayer)));
  }
} else {
  check("admin address known", false, "set KOMA_ADMIN or add `admin` to the addresses file");
}
if (relayer) {
  check("relayer can launch series", await has(a.seriesFactory, role("LAUNCHER_ROLE"), relayer));
  check("relayer can propose and finalize canon", await has(a.canonRegistry, role("RELAYER_ROLE"), relayer));
  check("relayer can mint issues", await has(a.komaIssues, role("MINTER_ROLE"), relayer));
  const eth = Number(formatEther(await chain.getBalance({ address: relayer })));
  check(`relayer holds ≥ ${MIN_RELAYER_ETH} ETH for gas`, eth >= MIN_RELAYER_ETH, `${eth} ETH`);
} else {
  check("relayer address known", false, "set KOMA_RELAYER or add `relayer` to the addresses file");
}
if (a.treasury) {
  const code = await chain.getCode({ address: a.treasury });
  check("treasury is a contract (multisig)", !!code && code !== "0x", a.treasury);
  const usdcBal = await chain.readContract({ address: a.usdc, abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [a.treasury] });
  console.log(`     treasury holds ${formatUnits(usdcBal, 6)} USDC`);
}

if (SERVER) {
  const s = await (await fetch(`${SERVER}/api/status`)).json();
  check("server is on this chain", s.chainId === chainId, `${s.network} (${s.chainId})`);
  check("server is configured", s.ready === true, s.missing?.join(", "));
  check("server uses this deployment", s.launchpad?.addresses?.seriesFactory?.toLowerCase() === a.seriesFactory.toLowerCase(), s.launchpad?.addresses?.seriesFactory);
  check("server faucet is off", s.faucet === false);
  check("fal is available", s.ai?.ok === true, s.ai?.reason ?? "");
  check("x402 payments go to the treasury", (s.payTo ?? "").toLowerCase() === (a.treasury ?? "").toLowerCase(), s.payTo);
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
