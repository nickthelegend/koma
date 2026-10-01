# KOMA launchpad: Stylus contracts

This directory holds two Arbitrum Stylus contracts (Rust compiled to WASM). They implement the interfaces in
[`contracts/LAUNCHPAD_SPEC.md`](../contracts/LAUNCHPAD_SPEC.md). The Solidity launchpad (`BondingCurve`,
`SeriesFactory`) calls them through the same `ICurveMath` / `IRoyaltyRouter` interfaces it uses for the Solidity
references (`contracts/src/CurveMathReference.sol`, `RoyaltyRouterReference.sol`), so either engine can be plugged in.

| crate | interface | what it does |
|---|---|---|
| `curve-math/` | `ICurveMath` | Pure virtual constant-product quotes. `quoteBuy = vC - ceil(vU·vC / (vU+u))`, `quoteSell = vU - ceil(vU·vC / (vC+c))`, `usdcToReach = targetVU - vU`, `spotPrice = vU·1e18 / vC`. The ceiling always rounds against the trader. It reverts on zero reserves, on overflow (`Panic(0x11)`, like Solidity 0.8) and on `targetVU < vU`. |
| `royalty-router/` | `IRoyaltyRouter` | Receives each curve's 1.5% fee and pushes it out in the same transaction. 40% goes to the character's ERC-6551 account and 40% to the treasury. The remaining 20% is a remix pool: the parent gets pool/2, the grandparent pool/4, and so on up to 8 generations. The character gets whatever is left, plus all rounding dust, so exactly `amount` is paid out. It emits `Routed` / `SeriesRegistered` and keeps `earned(recipient)` lifetime totals. |

The behaviour, the order of checks and the revert data are byte-identical to the Solidity references. The same
2,548 vectors plus 21 revert cases pass against both on a live node. The router's `initialize` can only be called
by the deploying account: the Stylus constructor records `tx.origin`, which mirrors the reference's immutable
`_deployer`. The owner can hand the router over with `transferOwnership(newOwner)` (owner only, non-zero, single
step, emits `OwnershipTransferred`; `initialize` emits it from address 0), so the deploy can initialize with the
deployer as owner, point the router at the factory, and then give it to the admin Safe.

## Why Stylus

- **Showcase**: the curve math and the royalty split are self-contained, pure-ish logic. That makes them the natural
  part of the launchpad to write in Rust for the Arbitrum Stylus track. They are tested with a 512-bit reference
  model and property tests, which would be awkward in Solidity.
- **Gas**: see [`bench/README.md`](bench/README.md), measured, not claimed. Once cached, the router is on par with
  Solidity or slightly cheaper. The tiny pure math functions cost more per call than Solidity, because Stylus has a
  fixed cost for entering a program. Cache both contracts on a real network.
- **Swappable**: the launchpad only depends on the interfaces. Localnet (anvil, which cannot run WASM) uses the
  Solidity references, and Arbitrum uses these contracts.

## Layout

```
stylus/
  Cargo.toml, rust-toolchain.toml (1.91.0), Stylus.toml   workspace; stylus-sdk 0.10.9 (matches cargo-stylus 0.10.9)
  .cargo/config.toml     64 KiB WASM stack (big gas win, see bench/README.md)
  curve-math/src/        math.rs (pure math), lib.rs (entrypoint), tests.rs (unit/property tests + vector generator)
  royalty-router/src/    split.rs (fee split), lib.rs (entrypoint), tests.rs (TestVM tests + vector generator)
  abi/                   exported ABIs (*.stylus.sol) + check-abi.sh (diff against the spec, via solc)
  test-vectors/          curve.json (2,548 cases + 21 reverts with exact revert data), router.json (2,002 split cases)
  integration/           run.sh: live devnode end-to-end (vectors vs Stylus and Solidity, router flow, access control)
  bench/                 run.sh / CurveBench.sol / results.json / README.md
  devnode.sh             local nitro devnode (start|stop|status), default port 8649
```

## Test

```bash
cd stylus
cargo test                                   # 36 unit tests (TestVM); also checks test-vectors/*.json are up to date
KOMA_WRITE_VECTORS=1 cargo test vectors      # regenerate test-vectors/
./abi/check-abi.sh                           # export ABIs and diff them against LAUNCHPAD_SPEC.md (must print IDENTICAL)
./devnode.sh start                           # nitro devnode on http://127.0.0.1:8649 (Docker)
./integration/run.sh                         # deploy + end-to-end on the devnode (prints ALL PASS)
./devnode.sh stop && ./devnode.sh start && ./bench/run.sh   # gas benchmark on a fresh node
./devnode.sh stop
```

The Solidity side can replay `test-vectors/curve.json` (`cases[]` fields are alphabetical, so they `abi.decode`
straight into a struct; integers are decimal strings) and `router.json` (replayed against `RoyaltyRouterReference` by
`contracts/test/RouterVectors.t.sol`).

## Deploy

```bash
scripts/stylus-deploy.sh --endpoint <rpc> --dry-run          # check + read-only gas estimate + CacheManager state
scripts/stylus-deploy.sh --endpoint <rpc> --env-file .env.testnet \
    --usdc <USDC> --treasury <treasury> [--owner <owner>] [--cache-bid <wei>] [--reproducible]
# Arbitrum One: keystore signer and cache bids are mandatory (runbook: deploy/MAINNET.md)
scripts/stylus-deploy.sh --endpoint https://arb1.arbitrum.io/rpc --account <name> --password-file <file> \
    --usdc 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 --treasury <Safe> --cache-bid <wei> --reproducible
```

Off-mainnet the script can read `SERVER_PRIVATE_KEY` from an env file into a 0600 temp file (never printed); on
Arbitrum One it only accepts a keystore (`--account`/`--keystore` + `--password-file`). It then:

1. deploys and activates `curve-math`;
2. deploys `royalty-router` (deploy, activate and constructor happen atomically through the StylusDeployer);
3. checks activation with `ArbWasm.programVersion`;
4. sends `initialize(usdc, treasury, owner)`, which must come from the same key;
5. with `--cache-bid` (required on 42161), bids in the CacheManager for both programs and checks
   `ArbWasmCache.codehashIsCached`;
6. writes `stylus/deployments/<chainId>.json`.

It asks for confirmation on Arbitrum One or Sepolia. After it finishes:

1. Pass `MATH` / `ROUTER` to `forge script script/DeployLaunchpad.s.sol` with the same signer: it sets the factory
   and transfers the router to `ADMIN`.
2. Keep both programs alive: Stylus programs expire 365 days after activation (`ArbWasm.programTimeLeft`), and
   need re-activation after an ArbOS Stylus upgrade; both are permissionless (`cargo stylus codehash-keepalive`,
   `cargo stylus activate`). See deploy/MAINNET.md.

Size (brotli, as reported by `cargo stylus check`): curve-math **9.9 KB**, royalty-router **12.3 KB** (limit 24 KB).
On Arbitrum One (2026-10-01) `cargo stylus check` quoted activation data fees of 0.000065 ETH (curve-math) and
0.000076 ETH (router); deploy + activation gas estimates are in deploy/mainnet-cost.json.
The devnode quoted these activation data fees: curve-math 0.000065 ETH, router 0.000075 ETH (0.000078 / 0.000090
with cargo-stylus' default 20% bump). Fees depend on the chain's current pricing.
