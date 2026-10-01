# KOMA launchpad: pre-mainnet security audit

Date: 2026-10-01. Target: Arbitrum One (42161). Auditor: Claude (Claude Code), at the owner's request.
Binding spec: `contracts/LAUNCHPAD_SPEC.md` (its change log records every change made here).

## Scope

| Area | Files |
|---|---|
| Solidity (solc 0.8.28, OZ 5.6.1, Uniswap v4) | `src/BondingCurve.sol`, `Graduator.sol`, `KomaSwapper.sol`, `SeriesFactory.sol`, `SeriesCoin.sol`, `CharacterNFT.sol`, `CanonRegistry.sol`, `KomaIssues.sol`, `RoyaltyRouterReference.sol`, `CurveMathReference.sol`, `deployers/*`, `interfaces/*`, `libraries/LaunchpadConstants.sol` |
| Stylus (stylus-sdk 0.10.9) | `stylus/curve-math`, `stylus/royalty-router` |
| Deploy | `script/DeployLaunchpad.s.sol`, `script/Deploy.s.sol`, `scripts/stylus-deploy.sh` |

Method: line-by-line review of every contract, proofs of concept for every High or Medium finding, and a fix with
regression tests for every Critical, High and Medium finding (plus the cheap Lows). The unit tests now run the real
Circle FiatToken v2.2 and the real Tokenbound ERC-6551 code (see "Test doubles"). Fork tests run against real Arbitrum
Sepolia contracts. The Stylus router was re-checked on a local Nitro devnode (differential vectors plus access control).

**Economics are unchanged.** `FEE_BPS` = 150, split 40/20/40, 5% graduation fee, the curve constants and
`MIN_POOL_COINS` all stay as they were. The one new policy knob is the per-chain launch floor (L-2). It only
rejects launch parameters the server never sends on mainnet.

## Findings

| ID | Severity | Title | Status |
|---|---|---|---|
| H-1 | High | Graduation can be blocked permanently by squatting the predictable v4 pool key | Fixed |
| M-1 | Medium | A USDC-blacklisted fee recipient freezes trading (and graduation) | Fixed |
| M-2 | Medium | Mainnet deploy could use Sepolia defaults, the Solidity engine and a raw key; the deployer kept every admin role | Fixed |
| M-3 | Medium | Stylus program expiry or ArbOS re-activation halts every curve (math is immutable per curve) | Mitigated (ops runbook; router side covered by the M-1 fix) |
| L-1 | Low | Router ownership could not be handed to the admin Safe | Fixed (`transferOwnership`) |
| L-2 | Low | Launch parameters from the relayer are unbounded (canon `endsAt` overflow, demo values reachable on mainnet) | Fixed (bounds) |
| L-3 | Low | A signed sell intent cannot be cancelled before its deadline | Fixed (`invalidateSellNonce`) |
| L-4 | Low | Legacy `script/Deploy.s.sol` could deploy KomaIssues to mainnet with a raw key and a localhost URI | Fixed (refuses 42161) |
| I-1 … I-16 | Info | See "Informational" | Acknowledged / documented |

### H-1: graduation can be blocked permanently by pool squatting

- **Location:** `Graduator._preparePool` / `_correctPrice` (pre-fix).
- **Description:** the pool key `(USDC, coin, 3000, 60, hooks = 0)` is known from launch. Anyone could `initialize` it at a
  bad price, and graduation then had to swap the pool back to the curve price. `SeriesCoin` blocks coin deposits
  into the PoolManager, but USDC-only positions ("bids") were still possible, and they break the correction:
  1. **Tick spam.** I initialized the pool at 1000x the curve price and minted 1,500 positions of 1 wei of USDC, one
     per tick spacing, between that price and the target. The correction swap has to cross every initialized tick, and
     `graduate()` used **37.8M gas**, above Arbitrum's 32M per-transaction cap. The squatter's cost is 1,500 cheap
     mints (about $10–20 of gas at today's prices).
  2. **Bid wall.** Bids worth more than every remaining curve coin made the swap sell all the coins. `_provide` then
     had nothing to pair and reverted (`CannotUpdateEmptyPosition`). The attacker's capital is never spent, because
     the revert unwinds the swap.
- **Impact:** the curve is `complete`, so trading stops, and `graduate()` can never succeed. All raised USDC and the
  remaining coins are frozen for good. This is a griefing attack: there is no direct profit, but it is cheap and
  permanent. It also defeats the "already mitigated" squatting defence.
- **Fix:** the Graduator is now the pool's **hook**. It is deployed with CREATE2 at a mined address whose low 14 bits
  are exactly `BEFORE_INITIALIZE_FLAG`, and the constructor calls `Hooks.validateHookPermissions` so it cannot
  exist at any other address. `beforeInitialize` rejects every caller. The Graduator's own `initialize` skips its
  hook (v4 `noSelfCall`). So only the Graduator can create a series pool, and until it does the PoolManager rejects
  swaps, liquidity and donations on that key (`PoolNotInitialized`). The correction swap, `unlockCallback` and
  `PoolPriceCorrected` are removed, which shrinks the code and the attack surface. The deploy script mines the
  salt and deploys through the deterministic CREATE2 proxy. A front-runner who replays the salt deploys the
  identical contract, whose admin is our deployer.
- **Tests:** `GraduatorTest.test_SquattedHooklessKeyCannotBlockGraduation` replays both PoCs on the old hookless key:
  graduation still succeeds at the curve price for under 2M gas. Also `test_RevertWhen_SomeoneElseInitializesThePool`,
  `test_RevertWhen_HookCalledDirectly`, `test_RevertWhen_GraduatorAddressHasWrongHookFlags`, and on the real
  Sepolia v4 deployment `LaunchpadForkTest.test_Fork_LaunchBuyGraduateSwap`.
- **Trade-off:** the graduated pool carries a hook address (initialize-only, no swap or liquidity callbacks). The app
  reads the key from `Graduator.poolKeyOf`, so it is unaffected. Some routers or UIs list hooked pools separately (I-13).

### M-1: a USDC-blacklisted fee recipient freezes trading

- **Location:** `BondingCurve._routeFee` → router `route` push payments; `Graduator` treasury transfers.
- **Description:** every buy and sell pushes the fee to the character TBA, to each ancestor TBA and to the treasury in
  the same transaction. If Circle blacklists any of these addresses, the USDC transfer reverts, and so does the
  trade. One blacklisted TBA freezes its own curve and every remix below it (up to 8 levels). A blacklisted treasury
  freezes every curve, and every graduation, since the treasury address is immutable.
- **Impact:** holders cannot sell and the raised USDC is locked until Circle lifts the blacklist. Likelihood is low,
  impact is high.
- **Fix:** `_routeFee` now runs `transfer + route` as a self-call (`pushFee`, callable only by the curve itself) inside
  `try`. If routing fails, the fee stays in the curve as `unroutedFees` (event `FeeRoutingDeferred`), outside the
  reserves, and it is never sent to the Graduator. Anyone can retry with `flushFees()`, which works after graduation
  too. The Graduator parks failed treasury payments in `treasuryOwed` (event `TreasuryPaymentDeferred`), never pools
  them, and anyone can retry with `flushTreasury()`. A deliberately short gas limit cannot force the deferral: an
  out-of-gas inside the self-call reverts the trade (`FeeRoutingOutOfGas`). Even without that guard, the rest of a
  trade costs more than the 1/64 of gas left after an out-of-gas, and the property test sweeps gas limits from 100k
  to 1.5M. This also keeps trading alive if the Stylus router program is ever inactive (M-3).
- **Tests (real Circle blacklist code):** `AuditRegressionsTest.test_BlacklistedCharacterAccountDoesNotBlockTrading`,
  `..._BlacklistedAncestorAccountDoesNotBlockRemixTrading`, `..._BlacklistedTreasuryDoesNotBlockTrading`,
  `test_GraduationExcludesUnroutedFees`, `test_RevertWhen_PushFeeCalledExternally`,
  `test_GasGriefingCannotForceFeeDeferral`, `GraduatorTest.test_BlacklistedTreasuryDoesNotBlockGraduation`, and
  `test_OwedTreasuryUsdcIsNotPooledByLaterGraduations`.

### M-2: mainnet deploy pipeline

- **Location:** `script/DeployLaunchpad.s.sol` (pre-fix).
- **Description:** on any chain the script silently fell back to Arbitrum Sepolia USDC, PoolManager and
  PositionManager, to `TREASURY = RELAYER = deployer`, and to localhost base URIs. With `MATH`/`ROUTER` unset it
  deployed the Solidity reference engine. It also took a raw `DEPLOYER_KEY`, and the deployer kept
  `DEFAULT_ADMIN_ROLE` on every contract plus the router ownership.
- **Fix:** the script now uses a per-chain address book (42161, and 421614 for Sepolia and its forks; other chains
  must supply every address). On 42161 an env override that differs from the book is refused, and the script
  requires:
  - Stylus `MATH`/`ROUTER`, checked by the `0xEFF000` code prefix, which EVM code cannot have;
  - explicit `ADMIN` (with code, i.e. a Safe), `TREASURY` and `RELAYER`, with `RELAYER != ADMIN` and `ADMIN != deployer`;
  - non-localhost URIs, a keystore signer (`DEPLOYER_KEY` is refused, and so is forge's default sender);
  - code at every book address, the CREATE2 proxy and the v4 Quoter.

  The router is initialized, pointed at the factory and transferred to ADMIN in a front-run-safe order. ADMIN gets
  `DEFAULT_ADMIN_ROLE` everywhere, the deployer renounces its own, and the relayer only gets operational roles.
  These post-conditions are asserted on-chain at the end of the script. `v4Quoter`, `admin`, `routerWired` and the
  launch floors are written to the addresses JSON.
- **Tests:** `DeployGuardsTest` (9 tests), and the fork deploys in `LaunchpadForkTest`, `CharacterWithdrawForkTest` and
  `SafeAdminForkTest` (Safe as admin and treasury). A full mainnet-path run on a local arb1 fork is recorded in
  `deploy/mainnet-cost.json`.

### M-3: Stylus program liveness (operational)

Each `BondingCurve` holds an immutable `math`. Stylus programs expire 365 days after activation
(`ArbWasm.expiryDays() = 365` on arb1) and must be re-activated after an ArbOS Stylus version bump
(`stylusVersion() = 3` today). Until then, calls into the program revert, so every buy and sell reverts.
Re-activation and keepalive are permissionless and cheap (`cargo stylus activate`, `cargo stylus codehash-keepalive`),
so this is a liveness risk, not a loss of funds. The router side no longer blocks trades (M-1).
**Mitigation:** `deploy/MAINNET.md` §7 adds monitoring of `programTimeLeft` with a keepalive at least every
6 months, and re-activation right after ArbOS upgrades. Making `math` upgradeable would add an admin key over every
curve's pricing, so I did not do it.

### L-1: router ownership hand-over

Neither router could change its owner, so the deployer EOA would have stayed owner forever, or ADMIN had to be the
owner from `initialize` on and send `setFactory` itself. I added `transferOwnership(address)` to **both** the Stylus
router and the Solidity reference: owner only, non-zero, single step, emits
`OwnershipTransferred(previousOwner, newOwner)`, which `initialize` also emits from `address(0)`. The ABI was
re-exported and `check-abi.sh` reports IDENTICAL. Router vectors are unchanged (the split did not change).
Tests: Stylus `transfer_ownership_owner_only_and_hands_over_set_factory`,
`ownership_transferred_event_matches_alloy_encoding`, devnode `integration/run.sh` ("transferOwnership: …"), and
Solidity `RoyaltyRouterReferenceTest.test_TransferOwnership` and `test_InitializeEmitsOwnership`.
It is single-step on purpose: the target is a Safe, and the deploy script checks the result. Two-step is an option
if ownership will ever move to an EOA.

### L-2: unbounded launch parameters

`votingWindow` (uint64) reached `CanonRegistry.propose` as `uint64(block.timestamp) + votingWindow`. A large value
overflows and reverts every `propose` for that series. The testnet demo values (25 USDC target, 300 s window)
were only kept off mainnet by server code. **Fix:** `SeriesFactory` has immutable `minGraduationTarget` and
`minVotingWindow` (the deploy sets 1,000 USDC / 1 h on 42161, and 1 USDC / 60 s elsewhere) plus
`MAX_VOTING_WINDOW = 30 days`. Floors above the defaults are rejected at construction, so the default launch
(`0, 0` → 5,000 USDC / 1 day) always works. Tests: `SeriesFactoryTest.test_RevertWhen_LaunchOutsideBounds`,
`test_MainnetFloorsRejectDemoValues`, `test_RevertWhen_FloorsAboveDefaults`.

### L-3: sell intents could not be cancelled

The `Sell` intent nonce only advanced on use, so a signed intent stayed executable by anyone (it is relayed) until
its deadline. New `invalidateSellNonce()` burns the caller's next nonce (event `SellNonceInvalidated`).
Test: `BondingCurveTest.test_InvalidateSellNonceCancelsSignedIntent`.

### L-4: legacy KomaIssues deploy script

`script/Deploy.s.sol` (raw `DEPLOYER_PRIVATE_KEY`, localhost default URI, deployer as admin) now reverts on
42161. On mainnet KomaIssues is deployed by `DeployLaunchpad` with ADMIN as admin and RELAYER as minter.

## Required confirmations

### 1. Trading fee: a compile-time constant

- `LaunchpadConstants.FEE_BPS = 150` is an `internal constant`. Nothing writes it: there is no setter, no storage
  slot, no admin path and no proxy, so it cannot be set to an absurd value, or changed at all, without deploying new
  contracts. The same holds for `GRADUATION_FEE_BPS = 500` and the 4000/2000/4000 split, which are constants in both
  routers.
- **Trade-off (no change made):** a bounded admin-settable fee (for example ≤ 3%, behind a Safe and a timelock) would
  let the protocol tune economics without redeploying. The cost is a trust assumption and an attack surface: a
  compromised admin could raise fees up to the cap on every live curve. The constant is the stronger guarantee for
  traders. Existing curves would keep 150 bps forever, and a change means a new factory (old series keep the old fee).
- **Accrual math:** buys charge `ceil(usdcUsed × 150 / 10 000)` and sells charge `ceil(gross × 150 / 10 000)`, both
  rounded against the trader. A clipped final buy charges `ceil(remaining × 150 / 9 850)`, the smallest fee whose net
  is exactly `remaining`. The router pays `char = floor(fee × 0.4)`, `treasury = floor(fee × 0.4)` and
  `pool = fee − char − treasury`. Ancestor *i* gets `pool >> i` (i ≤ 8). The character gets `char` plus the rest of
  the pool plus all dust, so `Σ = fee` exactly and the router keeps 0.
- **Recipients are exactly** `accountOf(seriesId)` (the series' character TBA, set at launch by the factory),
  `accountOf(ancestor)` for up to 8 ancestors, and `treasury` (set once at `initialize`). Nobody else can be paid, since
  `route` is callable only by the registered curve and registrations are factory-only and write-once. Tests:
  `AuditRegressionsTest.test_FeeRecipientsAreExactlyCharacterAncestorTreasury` (checks every `Routed` recipient),
  `BondingCurveTest.test_BuyMatchesQuoteAndChargesOnePointFivePercent`, `test_FeeRoundsUp`, `testFuzz_ClipNetIsExact`,
  `RoyaltyRouterReferenceTest.testFuzz_RoutePaysExactlyAmount`, `RouterVectorsTest` (2,002 Stylus vectors) and the
  devnode differential.

### 2. Treasury address

- **Where it is set:** `router.initialize(usdc, treasury, owner)`, once and only by the deployer, and
  `Graduator` (constructor, `immutable`). `SeriesFactory.treasury` is an informational immutable that nothing uses.
  `DeployLaunchpad` passes the same `TREASURY` to both and asserts that `router.treasury() == graduator.treasury()`.
- **Who can change it:** nobody. Neither router has a setter (ownership controls only `setFactory` and
  `transferOwnership`), and the Graduator's treasury is immutable. Rotating it means deploying a new router,
  graduator and factory. Live curves keep paying the old treasury.
- **Safe multisig:** this works. The treasury is a plain ERC-20 `transfer` recipient with no callback and no
  `payable` path, so a Safe receives fees and the graduation fee like an EOA. Proven on the real Safe v1.4.1 factory
  and singleton on Arbitrum Sepolia: `SafeAdminForkTest.test_Fork_SafeIsTreasuryAndAdmin` (Safe = TREASURY and ADMIN,
  fees and the graduation fee arrive, the deployer holds no role, and a 2-of-2 Safe transaction exercises
  `setBaseURI` and router `setFactory`). If Circle ever blacklists the treasury, its payments are parked, not lost (M-1).

### 3. Withdrawals

There is no pooled balance and nothing to withdraw from the protocol. The router pushes USDC out in the trade
itself and keeps nothing; the tests assert `balanceOf(router) == 0`. A character's earnings sit in its Tokenbound
AccountV3 (ERC-6551), and only the current Character NFT holder can move them, with
`execute(to, value, data, operation=0)`. Proven on a fork of Arbitrum Sepolia (Tenderly gateway, real Circle USDC,
real registry and AccountV3, launchpad deployed by the real script) in
`test/fork/CharacterWithdrawFork.t.sol::test_Fork_CharacterEarningsWithdrawnOnlyByNftOwner`:
1. A real 100 USDC curve buy puts exactly 0.9 USDC in the TBA (60% of the 1.5 USDC fee when there is no parent), puts
   0.6 USDC in the treasury, and leaves the router at 0.
2. `execute` by a stranger and by the relayer reverts.
3. The owner withdraws 0.4 USDC. The USDC `Transfer(account → owner, 0.4e6)` event is asserted and the balances are exact.
4. After `transferFrom` of the NFT, more fees accrue. The old owner's `execute` reverts, and the new owner withdraws
   the exact 0.59 USDC.

Unit tests run the same flow on the etched real AccountV3 (`CharacterNFTTest.test_AccountFollowsNftOwner`), plus the
AccountV3 lock caveat (`test_LockedAccountBlocksWithdrawUntilExpiry`, I-3).

## Review notes by area

- **Reentrancy:** every state-changing curve entry point (`buy`, `buyWithAuthorization`, `sell`, `sellWithPermit`,
  `graduate`, `flushFees`) is `nonReentrant`, and so are both swapper entry points. Effects come before interactions
  (`_buyEffects`, `_sell`). USDC and SeriesCoin have no transfer hooks. `Graduator.graduate` is reachable only from the
  registered (non-reentrant) curve, and its only external callback is the v4 hook, which is view-only and
  reject-all. `CanonRegistry` and `CharacterNFT` make no value transfers. `KomaIssues._safeMint` runs after all
  state writes and is MINTER-only. No reentrancy path found.
- **Integer / rounding:** curve math uses `ceil(k / (x + dx))`, so the live `vU × vC` only grows and the trader always
  gets the floor. Sells revert `InsufficientReserve` beyond `raised`, and the USDC balance equals
  `raised + unroutedFees` (+ donations). Fees round up. Repeated dust trades revert `ZeroAmount` (1 wei sells and
  1 unit buys give 0 out), so rounding cannot drain reserves. Covered by `testFuzz_RoundTripNeverProfits`,
  `testFuzz_SolventAfterRandomTrades`, `testFuzz_PriceMonotonicInBuys` and `CurveMathReference` fuzzing. Stylus math
  uses checked U256 and `Panic(0x11)` parity, and its 10,192 vectors are byte-identical on the devnode. Overflow
  bound: `route` reverts above `(2^256−1)/4000`, the same in both engines.
- **Access control:**

| Function | Who | Note |
|---|---|---|
| `SeriesFactory.launch` | `LAUNCHER_ROLE` (relayer) | bounded params (L-2) |
| `CharacterNFT.mint` | `MINTER_ROLE` (factory) | |
| `CharacterNFT.setBaseURI`, `KomaIssues.setBaseURI` | `DEFAULT_ADMIN_ROLE` (Safe) | |
| `KomaIssues.mint` | `MINTER_ROLE` (relayer) | |
| `CanonRegistry.registerSeries` | `FACTORY_ROLE` (factory) | write-once |
| `CanonRegistry.propose`/`finalize` | `RELAYER_ROLE` | tally trusted (I-6) |
| `Graduator.registerCurve` | `FACTORY_ROLE` (factory) | write-once |
| `Graduator.graduate` | the registered curve | |
| `BondingCurve.setCoin` | factory (immutable) | once |
| `BondingCurve.pushFee` | the curve itself | |
| router `initialize` | deploying account (Stylus: `tx.origin` at construction; reference: immutable deployer) | once, front-run safe |
| router `setFactory`, `transferOwnership` | router owner (Safe after deploy) | |
| router `registerSeries` / `route` | factory / registered curve | write-once |
| `flushFees`, `flushTreasury`, `graduate`, `invalidateSellNonce` | anyone (caller's own nonce) | |

- **Unchecked calls:** all ERC-20 moves use SafeERC20. `trySafeTransfer` (Graduator) and `try this.pushFee` (curve)
  are deliberate and record the deferral. The Stylus router checks the `transfer` bool and bubbles revert data.
  `try initialize {} catch {}` in `CharacterNFT` is deliberate (I-4).
- **Signature replay and domain separation:** the EIP-3009 nonce binds `(tag, curve|swapper, buyer, usdcIn,
  minCoinOut, deadline, salt)`. The USDC domain binds the chain id and the token, and `receiveWithAuthorization`
  requires `msg.sender == to`, so only that curve can consume it and the relayer cannot alter the terms. A
  `TransferWithAuthorization` signature cannot be substituted because the type hash differs. The `Sell` intent is
  EIP-712 (`KOMA Curve`/`1`, chainId, the curve), with a sequential per-seller nonce and a deadline. The domain is
  rebuilt if the chain id changes (fork safe). Permit is OZ ERC20Permit. Canon votes use an off-chain EIP-712
  domain bound to CanonRegistry and the chain id. Sepolia and mainnet signatures cannot be replayed on each other
  (different chain id and USDC).
- **Front-running and MEV:** front-running a relayed intent produces the identical trade. Sandwiching is bounded by
  `minCoinOut`/`minUsdcOut`. Graduation is permissionless and its price is fixed by curve state. Pool squatting is
  closed (H-1).
- **DoS:** the router loop is capped at 8. The remix tree only references earlier series. There are no unbounded
  loops in user paths. `CanonRegistry.proposals` grows per slot but is only read in a view. Blacklist and Stylus
  liveness are covered by M-1 and M-3.

## Informational

| ID | Note |
|---|---|
| I-1 | Fee constant trade-off: see confirmation 1. |
| I-2 | Treasury immutable everywhere; rotating it needs a redeploy (confirmation 2). |
| I-3 | ERC-6551: earnings travel with the NFT. A seller can drain the TBA right before a sale settles, and AccountV3 lets the holder `lock` the account for up to a year (a buyer must check `isLocked`; test `test_LockedAccountBlocksWithdrawUntilExpiry`). Marketplaces should snapshot the TBA balance. |
| I-4 | The Tokenbound guardian (`0x2FE5…5D57`) trusts **no** implementation on Arbitrum One or Sepolia (checked on both). `CharacterNFT`'s `initialize(accountImpl)` therefore always reverts and is swallowed, and accounts run the proxy's immutable initial implementation (AccountV3), which is the intended behaviour. If Tokenbound ever trusts implementations, anyone could initialize a still-uninitialized character account to one of them. The ownership model stays NFT-bound. `accountImpl` is effectively unused today. |
| I-5 | Anti-snipe is per recipient address and applies to curve buys only, so it can be bypassed with N addresses (sybil). It rate-limits casual sniping; it does not prevent it. |
| I-6 | Canon is relayer-trusted: `finalize` accepts any proposal of the slot and any tally with `winnerVotes ≤ totalVotes`. `votesRoot` is only a public commitment to the off-chain votes. Liveness of `nextEpisode` depends on the relayer. Holders can buy votes just before opening a slot (≈3% round-trip cost). |
| I-7 | Direct `buy`/`sell`/`swapExactIn` have no deadline (they rely on `min*Out`). The relayed variants have deadlines. On Arbitrum the sequencer is FCFS, with an optional Timeboost express lane. |
| I-8 | A Circle `pause` halts every trade and graduation atomically, leaving no partial state (`test_UsdcPauseHaltsAndResumes`). Nothing to fix. |
| I-9 | EIP-7702-delegated EOAs: FiatToken v2.2 checks ERC-1271 when `from` has code, so `buyWithAuthorization` works for such wallets only if their delegate implements ERC-1271. Sell intents use OZ `SignatureChecker`, which tries ECDSA first. |
| I-10 | Post-graduation swaps pay the 0.3% pool fee to the burned LP position, not to the character or the treasury (economic choice). |
| I-11 | Voting power held by contracts that cannot vote (curve, vesting wallet, PoolManager, 0xdEaD) is harmless because canon has no quorum. |
| I-12 | `CurveDeployer`/`CoinDeployer` are permissionless, but their outputs are unregistered and cannot route or graduate. |
| I-13 | The graduated pool uses a hook address (H-1 fix). Discoverability by third-party routers can differ from hookless pools. |
| I-14 | Admin (Safe) powers: grant or revoke roles (including a new LAUNCHER/MINTER/FACTORY/RELAYER), `setBaseURI`, router `setFactory`/`transferOwnership`. The admin **cannot** move user or curve funds, change fees, prices or the treasury, or pause. A compromised relayer key can launch spam series within the bounds, mint KomaIssues, and propose or finalize canon. It cannot touch funds. Response: the Safe revokes its roles (MAINNET.md §8). |
| I-15 | There is no emergency pause anywhere, by design (non-custodial). Incidents are handled by revoking roles and redeploying the factory (MAINNET.md §8). |
| I-16 | `spotPrice()` is coarse (spec deviation 7); the UI derives price from `state()`. |

## Test doubles (Phase 2)

- **Tokenbound: replaced.** `test/utils/Mock6551.sol` is deleted. `test/utils/Tokenbound.sol` etches the runtime code
  from Arbitrum One (`cast code` at block 510,584,332, stored in `test/utils/bytecode/`) at the canonical
  addresses. It covers the ERC-6551 registry `0x0000…6551…5758`, AccountProxy `0x5526…6E7F`, AccountV3
  `0x41C8…44eC` and its immutable dependencies: AccountGuardian `0x2FE5…5D57` (owner in slot 0, no trusted
  implementations, as on chain), ERC-4337 EntryPoint v0.6 `0x5FF1…2789` and the MulticallForwarder `0xcA11…DCCD`.
  The same code is deployed at the same addresses on Sepolia (code hashes compared).
- **USDC: replaced.** `test/utils/TestUSDC.sol` is deleted. `test/utils/CircleUSDC.sol` etches Arbitrum One's
  FiatTokenProxy (`0xaf88…5831`), its FiatTokenV2_2 implementation (`0x86E7…57B3`, read from the proxy's
  implementation slot) and the `SignatureChecker` library it is linked against (`0x4e7D…3247`, needed by EIP-3009).
  The proxy's implementation and admin slots are written, and it is initialized through Circle's own `initialize`,
  `initializeV2`, `initializeV2_1` and `initializeV2_2`, plus `configureMinter`. The unit tests therefore run
  Circle's real EIP-3009, EIP-2612, blacklist and pause code. This immediately exposed one behaviour the mock
  missed: FiatToken rejects zero-amount mints.
- Not replaced: `stylus/integration/TestToken.sol`, the 6-decimal token on the Nitro devnode used only to receive
  router transfers. Circle's code cannot be etched on a real node without a full Circle deployment, and the
  router only needs `transfer` there.
- The devnode integration script no longer generates keys. It uses the public anvil test mnemonic, local devnode only.

## Testnet shortcuts reviewed

`src/` has no chain-specific code. Demo targets and windows enter only through relayer launch parameters, which are
now bounded on-chain (L-2). The server already disables demo launches on `arbitrum-one`. The deploy script's
Sepolia addresses, localhost URIs and deployer defaults can no longer reach 42161 (M-2). `Deploy.s.sol` refuses
42161 (L-4). `stylus-deploy.sh` refuses raw env-file keys on 42161 and requires cache bids and canonical USDC
there. Faucets live only in the app (`src/`, out of scope).

## Residual risks

1. Off-chain trust: relayer key (canon tally, launches), server-side vote collection, and fal/IPFS metadata behind
   `setBaseURI`.
2. Stylus program liveness depends on monitoring and keepalive (M-3). CacheManager eviction only raises gas.
3. ERC-6551 secondary-market caveats (I-3) and Circle's ability to freeze individual accounts (deferred fees
   are flushable, a frozen trader cannot trade).
4. No pause and no upgradability (I-15): a bug found after launch requires a new factory, and live curves keep
   their code.
5. This is a single-reviewer audit. An independent audit is recommended before significant TVL.
