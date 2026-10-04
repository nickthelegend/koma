# KOMA launchpad: Arbitrum One (42161) deploy runbook

Prepared 2026-10-01 alongside `contracts/AUDIT.md`. Nothing in this runbook has been run against a public network.
Costs measured on a local fork and with read-only estimates are in `deploy/mainnet-cost.json`: about
**26.4M gas ≈ 0.00067 ETH** at 0.02 gwei, including the Stylus activation data fees.

## 0. Roles

| Role | What | Holds |
|---|---|---|
| `DEPLOYER` | Foundry keystore EOA (`--account`) or hardware wallet (`--ledger`); used once | nothing after the deploy (asserted by the script) |
| `ADMIN` | Safe multisig (≥ 2-of-3 recommended) | `DEFAULT_ADMIN_ROLE` on CharacterNFT, CanonRegistry, Graduator, SeriesFactory, KomaIssues; Stylus router owner |
| `TREASURY` | Safe (may equal ADMIN) | receives 40% of every fee + 5% graduation fee; immutable once deployed |
| `RELAYER` | server hot key (`SERVER_PRIVATE_KEY` in the app) | `LAUNCHER_ROLE` (factory), `RELAYER_ROLE` (canon), `MINTER_ROLE` (KomaIssues); must differ from ADMIN |

Never paste a private key into a terminal command, a chat or an env file used for mainnet. Create the keystore yourself:
`cast wallet import koma-deployer --interactive`, then store its password in a 0600 file outside the repo.

```bash
export RPC=https://arb1.arbitrum.io/rpc           # or a private arb1 endpoint
export ACCOUNT=koma-deployer PASSWORD_FILE=$HOME/.koma/deployer.pw
export DEPLOYER=$(cast wallet address --account $ACCOUNT --password-file $PASSWORD_FILE)
export ADMIN=0x...    TREASURY=0x...    RELAYER=0x...
export BASE_URI=https://<app-domain>/api/characters/   KOMA_BASE_URI=https://<app-domain>/api/tokens/
export USDC=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
```

## 1. Address book (enforced by `script/DeployLaunchpad.s.sol` on 42161)

| | Arbitrum One | Arbitrum Sepolia |
|---|---|---|
| USDC (Circle native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| v4 PoolManager | `0x360e68faccca8ca495c1b759fd9eee466db9fb32` | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |
| v4 PositionManager | `0xd88f38f930b7952f2db2432cb002e7abbf3dd869` | `0xAc631556d3d4019C95769033B5E719dD77124BAc` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same |
| v4 Quoter (→ `v4Quoter` in the addresses JSON) | `0x3972c00f7ed4885e145823eb7c655375d275a1c5` | `0x7de51022d70a725b508085468052e25e22b5c4c9` |
| ERC-6551 registry / AccountProxy / AccountV3 | `0x000000006551c19487814612e58FE06813775758` / `0x55266d75D1a14E4572138116aF39863Ed6596E7F` / `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC` | same (same code) |
| CREATE2 proxy (Graduator) / StylusDeployer / CacheManager | `0x4e59b44847b379578588920cA78FbF26c0B4956C` / `0xcEcba2F1DC234f70Dd89F2041029807F8D03A990` / `0x51dEDBD2f190E0696AFbEE5E60bFdE96d86464ec` | |

## 2. Preflight (read-only)

```bash
[ "$(cast chain-id -r $RPC)" = 42161 ] || echo "WRONG CHAIN"
cast balance -r $RPC -e $DEPLOYER                     # need >= 0.002 ETH (cost ~0.0007 ETH + bids + 2x gas headroom)
for a in $USDC 0x360e68faccca8ca495c1b759fd9eee466db9fb32 0xd88f38f930b7952f2db2432cb002e7abbf3dd869 \
         0x000000000022D473030F116dDEE9F6B43aC78BA3 0x3972c00f7ed4885e145823eb7c655375d275a1c5 \
         0x000000006551c19487814612e58FE06813775758 0x55266d75D1a14E4572138116aF39863Ed6596E7F \
         0x41C8f39463A868d3A88af00cd0fe7102F30E44eC 0x4e59b44847b379578588920cA78FbF26c0B4956C \
         0xcEcba2F1DC234f70Dd89F2041029807F8D03A990; do
  [ "$(cast code -r $RPC $a)" != 0x ] && echo "ok   $a" || echo "NO CODE $a"; done
cast call -r $RPC $ADMIN 'getThreshold()(uint256)'; cast call -r $RPC $ADMIN 'getOwners()(address[])'   # ADMIN is a Safe
cast call -r $RPC $TREASURY 'getThreshold()(uint256)'
[ "$RELAYER" != "$ADMIN" ] && [ "$ADMIN" != "$DEPLOYER" ] && echo "role separation ok"
cast call -r $RPC 0x0000000000000000000000000000000000000071 'stylusVersion()(uint16)'   # 3 on 2026-10-01
scripts/stylus-deploy.sh --endpoint $RPC --dry-run --cache-bid 0        # size, data fee, gas estimate, cache state
cd contracts && forge build --sizes && forge test && FORK_TESTS=1 forge test --match-path "test/fork/*"
cd ../stylus && cargo test && ./abi/check-abi.sh
```

**Rehearse the full mainnet path on a local fork** (not optional). It exercises the guards, role hand-over and
post-checks with Solidity stand-ins for the Stylus programs, since anvil cannot run WASM:

```bash
anvil --fork-url $RPC --chain-id 42161 --port 18755 --auto-impersonate &
cast rpc -r http://127.0.0.1:18755 anvil_setBalance 0x00000000000000000000000000000000000De910 0x8AC7230489E80000
cd contracts && ADMIN=$ADMIN TREASURY=$TREASURY RELAYER=$RELAYER BASE_URI=$BASE_URI KOMA_BASE_URI=$KOMA_BASE_URI \
  ADDRESSES_OUT=none forge script script/MeasureMainnetDeploy.s.sol --rpc-url http://127.0.0.1:18755 \
  --broadcast --unlocked --sender 0x00000000000000000000000000000000000De910
rm -rf broadcast/MeasureMainnetDeploy.s.sol cache/MeasureMainnetDeploy.s.sol; kill %1
```
(Add `ALLOW_EOA_ADMIN=true` only if ADMIN on the fork is not a contract.)

## 3. Deploy (exact sequence)

**Step A: Stylus programs.** Deploy, activate, `initialize(usdc, treasury, owner = DEPLOYER)` and cache. `initialize`
is deployer-only (the router records `tx.origin` at construction), so it cannot be front-run.
`--reproducible` builds in cargo-stylus' Docker image, which `cargo stylus verify` needs.
```bash
scripts/stylus-deploy.sh --endpoint $RPC --account $ACCOUNT --password-file $PASSWORD_FILE \
  --usdc $USDC --treasury $TREASURY --cache-bid 0 --reproducible
# -> stylus/deployments/42161.json; note the two deployment tx hashes it prints
export MATH=$(jq -r .curveMath ../stylus/deployments/42161.json) ROUTER=$(jq -r .royaltyRouter ../stylus/deployments/42161.json)
```
Use a non-zero `--cache-bid` if `cargo stylus cache suggest-bid $MATH -e $RPC` says the cache is full. Today's min bid
is 0 wei and the cache is about 26% full. The script fails if a program is not cached after its bid.

**Step B: Solidity contracts**, signed by the **same** keystore. The router owner must equal the signer, so the
script can call `setFactory` and then `transferOwnership(ADMIN)`.
```bash
cd contracts
MATH=$MATH ROUTER=$ROUTER ADMIN=$ADMIN TREASURY=$TREASURY RELAYER=$RELAYER BASE_URI=$BASE_URI KOMA_BASE_URI=$KOMA_BASE_URI \
forge script script/DeployLaunchpad.s.sol --rpc-url $RPC --account $ACCOUNT --password-file $PASSWORD_FILE \
  --sender $DEPLOYER --slow            # simulate first; read the printed config and checklist
#   ...then the same command with --broadcast
```
On 42161 the script refuses to continue unless:
- `MATH`/`ROUTER` are Stylus programs (`0xEFF000` code prefix);
- `ADMIN` has code, `ADMIN != RELAYER` and `ADMIN != deployer`;
- the URIs are not localhost, and the signer is not `DEPLOYER_KEY` or forge's default sender;
- no book address is overridden.

It deploys KomaIssues (admin ADMIN, minter RELAYER), CharacterNFT, CanonRegistry, the Graduator (CREATE2, mined hook
address), SeriesFactory (launch floors of 1,000 USDC / 1 h), KomaSwapper and the two deployer helpers. It grants the
operational roles, wires and hands over the router, grants `DEFAULT_ADMIN_ROLE` to ADMIN, **renounces the deployer's
roles**, asserts all of this on-chain, and writes `deploy/addresses.42161.json` (with `v4Quoter`, `admin` and
`routerWired`).

If the router was already handed to ADMIN, `routerWired` is false. ADMIN must then send
`setFactory(<SeriesFactory>)` on the router from the Safe, and launches revert until it does.

**Step C: app.** Point the server at `deploy/addresses.42161.json` (`KOMA_LAUNCHPAD_ADDRESSES`) and give the relayer
ETH for gas. The deployer key can be retired.

## 4. Source verification (Arbiscan, Etherscan v2 API)

Foundry ≥ 1.x uses the Etherscan v2 multichain API: one `ETHERSCAN_API_KEY` with `--chain 42161`. An explicit
`--verifier-url "https://api.etherscan.io/v2/api?chainid=42161"` also works. Compiler settings come from
`foundry.toml` (0.8.28, 500 runs, cancun). Read the addresses from `deploy/addresses.42161.json`.

```bash
V="--chain 42161 --verifier etherscan --etherscan-api-key $ETHERSCAN_API_KEY --watch"
J=../deploy/addresses.42161.json; a() { jq -r .$1 $J; }
forge verify-contract $(a komaIssues) src/KomaIssues.sol:KomaIssues $V \
  --constructor-args $(cast abi-encode 'c(address,address,string)' $ADMIN $RELAYER "$KOMA_BASE_URI")
forge verify-contract $(a characterNft) src/CharacterNFT.sol:CharacterNFT $V \
  --constructor-args $(cast abi-encode 'c(address,address,address,address,string)' $DEPLOYER $(a erc6551Registry) $(a accountProxy) $(a accountImpl) "$BASE_URI")
forge verify-contract $(a canonRegistry) src/CanonRegistry.sol:CanonRegistry $V --constructor-args $(cast abi-encode 'c(address)' $DEPLOYER)
forge verify-contract $(a graduator) src/Graduator.sol:Graduator $V \
  --constructor-args $(cast abi-encode 'c(address,address,address,address,address,address)' $DEPLOYER $(a poolManager) $(a positionManager) $(a permit2) $USDC $TREASURY)
CD=$(cast call -r $RPC $(a seriesFactory) 'curveDeployer()(address)'); KD=$(cast call -r $RPC $(a seriesFactory) 'coinDeployer()(address)')
forge verify-contract $CD src/deployers/CurveDeployer.sol:CurveDeployer $V
forge verify-contract $KD src/deployers/CoinDeployer.sol:CoinDeployer $V
forge verify-contract $(a seriesFactory) src/SeriesFactory.sol:SeriesFactory $V \
  --constructor-args $(cast abi-encode 'c(address,address,address,address,address,address,address,address,address,address,uint256,uint64)' \
    $DEPLOYER $USDC $MATH $ROUTER $(a characterNft) $(a canonRegistry) $(a graduator) $TREASURY $CD $KD $(a minGraduationTarget) $(a minVotingWindow))
forge verify-contract $(a swapper) src/KomaSwapper.sol:KomaSwapper $V \
  --constructor-args $(cast abi-encode 'c(address,address,address)' $(a poolManager) $(a graduator) $USDC)
# per series (optional): BondingCurve(seriesId, usdc, math, router, graduator, target, factory),
#   SeriesCoin(name, symbol, curve, vesting), VestingWallet(creator, launchedAt, 2592000)
```
Stylus. Prove the deployed WASM matches the reproducible build, then publish on Arbiscan ("Verify & Publish → Stylus":
repo at the deployed commit, cargo-stylus 0.10.9, toolchain from `stylus/rust-toolchain.toml`):
```bash
(cd ../stylus/curve-math && cargo stylus verify --deployment-tx <curve-math deploy tx> -e $RPC)
(cd ../stylus/royalty-router && cargo stylus verify --deployment-tx <router deploy tx> -e $RPC)
```

## 5. Post-deploy checks (all must print the expected value)

```bash
ADM=0x0000000000000000000000000000000000000000000000000000000000000000
role() { cast call -r $RPC $1 'hasRole(bytes32,address)(bool)' $2 $3; }
for c in $(a characterNft) $(a canonRegistry) $(a graduator) $(a seriesFactory) $(a komaIssues); do
  echo "$c admin:$(role $c $ADM $ADMIN) deployer:$(role $c $ADM $DEPLOYER) relayer:$(role $c $ADM $RELAYER)"; done   # true false false
role $(a seriesFactory) $(cast keccak LAUNCHER_ROLE) $RELAYER                 # true
role $(a canonRegistry) $(cast keccak RELAYER_ROLE) $RELAYER                  # true
role $(a canonRegistry) $(cast keccak FACTORY_ROLE) $(a seriesFactory)        # true
role $(a graduator) $(cast keccak FACTORY_ROLE) $(a seriesFactory)            # true
role $(a characterNft) $(cast keccak MINTER_ROLE) $(a seriesFactory)          # true
role $(a komaIssues) $(cast keccak MINTER_ROLE) $RELAYER                      # true
cast call -r $RPC $ROUTER 'owner()(address)'      # ADMIN
cast call -r $RPC $ROUTER 'factory()(address)'    # SeriesFactory
cast call -r $RPC $ROUTER 'treasury()(address)'; cast call -r $RPC $(a graduator) 'treasury()(address)'   # TREASURY, TREASURY
cast call -r $RPC $ROUTER 'usdc()(address)'       # USDC
python3 -c "print(hex(int('$(a graduator)',16) & 0x3fff))"   # 0x2000 (BEFORE_INITIALIZE hook flag only)
cast call -r $RPC $(a seriesFactory) 'minGraduationTarget()(uint256)'   # 1000000000
for p in $MATH $ROUTER; do cast call -r $RPC 0x0000000000000000000000000000000000000071 'programTimeLeft(address)(uint64)' $p; \
  cast call -r $RPC 0x0000000000000000000000000000000000000072 'codehashIsCached(bytes32)(bool)' $(cast codehash -r $RPC $p); done
```

## 6. Smoke test (smallest amounts, real funds)

1. **Launch** one series through the app (x402 launch, default target 5,000 USDC; demo launches are refused on-chain).
   Check `SeriesLaunched` and that `characterAccount` has code (a Tokenbound account).
2. **Buy 1 USDC** from a fresh wallet with a gasless buy, after the 10-minute snipe window or below its cap. The fee
   is 0.015 USDC: check `Routed` to the character TBA (0.009), to the treasury (0.006), and that the router holds 0.
3. **Sell** half the coins with `sellWithPermit`, and check `Trade(isBuy=false)` and the USDC received.
4. **Withdraw** as the Character NFT owner: `execute(USDC, 0, transfer(owner, bal), 0)` on the TBA. Check the
   `Transfer` event.
5. **Canon:** propose an issue as the creator (NFT owner). After the window (≥ 1 h) the relayer finalizes it. Check
   `CanonFinalized`.
6. **Graduation** needs ≥ 1,000 USDC raised, so do not test it with real money. It was rehearsed on the real v4
   contracts (Sepolia fork tests, and the arb1 fork if you extend the rehearsal script). If a real series graduates,
   check `GraduationFee` (5%), `PoolCreated` (sqrt price = curve price) and that the position NFT owner is `0x…dEaD`.
7. Check `unroutedFees() == 0` on the curve and `treasuryOwed() == 0` on the Graduator.

## 7. Monitoring (ongoing)

- **Stylus liveness (AUDIT M-3).** Alert when `ArbWasm.programTimeLeft(MATH|ROUTER)` < 60 days. Run
  `cargo stylus codehash-keepalive --codehash $(cast codehash -r $RPC <p>) -e $RPC --keystore-path ~/.foundry/keystores/$ACCOUNT --keystore-password-path $PASSWORD_FILE` (permissionless, small fee) at least every 6
  months. After every ArbOS upgrade, check `programVersion(p) == stylusVersion()`. If they differ, run
  `cargo stylus activate --address <p>` (permissionless). While MATH is inactive, every buy and sell reverts.
- **Cache.** `codehashIsCached` should stay true. If evicted, re-bid with `cargo stylus cache bid`. Eviction only
  raises gas.
- **Deferred payments (AUDIT M-1).** Watch `FeeRoutingDeferred` (curves) and `TreasuryPaymentDeferred` (Graduator).
  They mean Circle blacklisted or paused a recipient. Once resolved, anyone calls `flushFees()` / `flushTreasury()`.
- **Relayer ETH balance**, and role changes (`RoleGranted`/`RoleRevoked` events on the five AccessControl contracts).

## 8. Rollback and incidents

The contracts are immutable and have **no pause** (by design; nobody can freeze or move user funds). Responses:

| Incident | Response (Safe = ADMIN) |
|---|---|
| Deploy fails mid-way | Nothing is live until the factory is wired. Fix and re-run Step B with the same signer. The Graduator salt miner skips addresses that already have code, and an initialized router owned by the deployer is reused (`setFactory` re-points it). If the router was already transferred, ADMIN sends `setFactory`. |
| Wrong config after deploy (URI, roles) | `setBaseURI`, `grantRole`/`revokeRole` from the Safe. Wrong treasury, USDC or v4 addresses: redeploy (they are immutable). Old series keep working as deployed. |
| Relayer key compromised | Safe: `revokeRole(LAUNCHER_ROLE)` on the factory, `revokeRole(RELAYER_ROLE)` on canon, `revokeRole(MINTER_ROLE)` on KomaIssues. Rotate `SERVER_PRIVATE_KEY` and grant the new key. Funds are not at risk. |
| Bug in factory / launch flow | Revoke `LAUNCHER_ROLE` (stops new series). Deploy a fixed factory, then `router.setFactory(newFactory)` and the FACTORY/MINTER grants from the Safe. Existing curves keep trading and graduating. |
| Bug in a live curve / graduator | No admin path into live curves. Users can always sell back to the curve. Communicate, stop launches, redeploy. |
| Stylus program expired / needs re-activation | `cargo stylus activate` / keepalive (anyone). Deferred router fees are flushed after. |
| USDC blacklist or pause | Pause: wait (trading halts atomically). Blacklist: fees and treasury payments are parked; flush after it is lifted. |
| Rehearsal artifacts | Delete `contracts/broadcast/*/42161` and `contracts/cache/*/42161` from any local-fork rehearsal before committing. |

## Notes from the Arbitrum Sepolia deployment (2026-10-02)

- KOMA uses Alchemy as its node provider (`ARBITRUM_SEPOLIA_RPC_URL` / `KOMA_SERVER_RPC_URL`); Alchemy allows Stylus activation simulation. On the free tier `eth_getLogs` is capped at 10 blocks, so set `KOMA_LOGS_RPC_URL` for the indexer.
- Use an RPC that allows Stylus activation simulation. `sepolia-rollup.arbitrum.io` refuses it ("stylus activations not allowed for this request"); `arbitrum-sepolia-rpc.publicnode.com` works. On Arbitrum One, use your provider's endpoint and run `scripts/stylus-deploy.sh --dry-run` against it first.
- `DeployLaunchpad.s.sol` never calls the Stylus programs (Foundry's EVM can't run WASM). After it finishes, send the printed `cast send <router> 'setFactory(address)' <factory>` from the deployer, then `transferOwnership(<ADMIN>)`, and check `factory()`, `owner()`, `usdc()`, `treasury()`.
- Sourcify verification needs no API key: `forge verify-contract --verifier sourcify --chain <id> --rpc-url <rpc> --guess-constructor-args <address> <path>:<Contract>`.
- Measured on Sepolia: Stylus deploy + activation 0.00059 ETH, Solidity suite 0.00063 ETH, router wiring 0.000004 ETH, one launch 5.38M gas.
