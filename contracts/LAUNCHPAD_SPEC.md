# KOMA Launchpad — interface spec

Single source of truth shared by the Solidity, Stylus, server and frontend lanes.
If you need to change a signature here, change this file first and say so in your report.

Units: USDC has 6 decimals. Series coins have 18 decimals. Basis points (bps) out of 10_000.

## Constants

| Name | Value |
|---|---|
| `TOTAL_SUPPLY` | 1_000_000_000e18 |
| `CURVE_SUPPLY` | 950_000_000e18 (95%) — held by the curve |
| `CREATOR_SUPPLY` | 50_000_000e18 (5%) — `VestingWallet`, linear, 30 days, starts at launch |
| `VIRTUAL_USDC_0` | 1_000e6 (so the starting market cap is ~$1,000) |
| `VIRTUAL_COIN_0` | 1_000_000_000e18 |
| `FEE_BPS` | 150 (1.5% of the USDC side of every buy and sell) |
| Fee split | 4000 character TBA / 2000 remix pool / 4000 treasury |
| `GRADUATION_FEE_BPS` | 500 (5% of the USDC raised, sent to the treasury by the Graduator before the pool is sized) |
| Remix pool | ancestor at depth i (1 = parent) gets `REMIX_POOL / 2^i`; max depth 8; leftover goes to the series' own character TBA. No parent → the whole 20% goes to the character |
| `SNIPE_WINDOW` | 600 seconds after launch |
| `SNIPE_CAP` | 20_000_000e18 (2% of supply) max coin balance per recipient during the snipe window |
| `CANON_THRESHOLD` | 1_000_000e18 votes (0.1%) |
| `DEFAULT_GRADUATION_TARGET` | 5_000e6 USDC raised (net of fees). Per-series override at launch (demo series: 25e6) |
| `DEFAULT_VOTING_WINDOW` | 86_400 s. Per-series override at launch (demo: 300 s) |

## Curve math (virtual constant product)

State per curve: `vU` (virtual USDC reserve), `vC` (virtual coin reserve), `k = vU * vC` at launch.
Real USDC held = `vU - VIRTUAL_USDC_0`. Coins sold = `VIRTUAL_COIN_0 - vC`.

- Buy with net USDC `u` (after the 1.5% fee): `coinOut = vC - ceil(k / (vU + u))` — rounds against the buyer.
- Sell `c` coins: `usdcOutGross = vU - ceil(k / (vC + c))` — rounds against the seller; the 1.5% fee comes out of `usdcOutGross`.
- Spot price (USDC per coin, 1e18-scaled, 6-dec USDC per 18-dec coin): `vU * 1e18 / vC` — this is "raw USDC units per 1e18 coin units" scaled by 1e18.
- A buy that would push `raised` past `graduationTarget` is clipped to exactly the target; the unused USDC (and its fee) is not taken. When `raised == graduationTarget` the curve is `complete` and trading stops.

### `ICurveMath` (implemented by Stylus `curve-math`; Solidity reference `CurveMathReference.sol` for tests and localnet)

```solidity
interface ICurveMath {
    function quoteBuy(uint256 vU, uint256 vC, uint256 usdcIn) external pure returns (uint256 coinOut);
    function quoteSell(uint256 vU, uint256 vC, uint256 coinIn) external pure returns (uint256 usdcOut);
    function usdcToReach(uint256 vU, uint256 vC, uint256 targetVU) external pure returns (uint256 usdcIn); // = targetVU - vU, reverts if targetVU < vU
    function spotPrice(uint256 vU, uint256 vC) external pure returns (uint256 priceX18);
}
```
`quoteBuy`/`quoteSell` are fee-free; the curve applies fees. Must revert on `vC == 0` or `vU == 0`. Rounding exactly as above. Stylus and the Solidity reference must return identical results (differential tested).

### `IRoyaltyRouter` (implemented by Stylus `royalty-router`; Solidity reference `RoyaltyRouterReference.sol`)

```solidity
interface IRoyaltyRouter {
    event Routed(uint256 indexed seriesId, address indexed recipient, uint256 amount, uint8 kind); // kind: 0 character, 1 ancestor, 2 treasury
    event SeriesRegistered(uint256 indexed seriesId, address curve, address characterAccount, uint256 parentSeriesId);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner); // also emitted by initialize (from 0)

    function initialize(address usdc, address treasury, address owner) external; // once, deployer only
    function setFactory(address factory) external;                                // owner only
    function transferOwnership(address newOwner) external;                        // owner only, newOwner != 0, single step
    function registerSeries(uint256 seriesId, address curve, address characterAccount, uint256 parentSeriesId) external; // factory only; parent must exist or be 0
    function route(uint256 seriesId, uint256 amount) external;                    // only curveOf(seriesId); USDC already transferred to the router
    function parentOf(uint256 seriesId) external view returns (uint256);
    function accountOf(uint256 seriesId) external view returns (address);
    function curveOf(uint256 seriesId) external view returns (address);
    function earned(address recipient) external view returns (uint256);          // lifetime USDC routed to recipient
    function treasury() external view returns (address);
    function usdc() external view returns (address);
    function factory() external view returns (address);
    function owner() external view returns (address);
}
```
`route` pushes USDC immediately with `transfer`. Amounts: `char = amount*4000/10000`, `treasury = amount*4000/10000`, `pool = amount - char - treasury`; ancestors take `pool >> i` for i = 1..depth (depth ≤ 8, stop at the first series with parent 0); the character gets `char + (pool - sum(ancestors))`. Dust always goes to the character, so the total paid out equals `amount` exactly.

## Solidity contracts (`contracts/src/`)

All use OpenZeppelin 5.x, solc 0.8.28, `evm_version = cancun`.

### `SeriesCoin` — ERC20 + ERC20Permit + ERC20Votes
- Constructor `(string name, string symbol, address curve, address vesting)`: mints `CURVE_SUPPLY` to `curve`, `CREATOR_SUPPLY` to `vesting`.
- **Clock is timestamp** (`clock()` returns `uint48(block.timestamp)`, `CLOCK_MODE()` = `"mode=timestamp"`). On Arbitrum, `block.number` is the L1 block number and moves in jumps; do not use it.
- Auto self-delegation: in `_update`, if `to != address(0)` and `delegates(to) == address(0)`, delegate `to` to itself, so holding = voting power with no extra tx.
- `nonces` shared between Permit and Votes as OZ requires.

### `CharacterNFT` — ERC721
- `mint(address to, string name, bytes32 sheetHash) returns (uint256 id, address account)` — only `MINTER_ROLE` (the factory). Creates the ERC-6551 account through the registry `0x000000006551c19487814612e58FE06813775758` with implementation = Tokenbound AccountV3 proxy `0x55266d75D1a14E4572138116aF39863Ed6596E7F`, salt `bytes32(0)`, then calls `initialize(0x41C8f39463A868d3A88af00cd0fe7102F30E44eC)` on the proxy if needed. Registry/proxy/impl addresses are constructor args (so tests and other chains can override).
- `accountOf(uint256 id) view returns (address)`, `sheetHash(uint256 id)`, `nameOf(uint256 id)`.
- `tokenURI` = `baseURI + id`; admin `setBaseURI`.
- Event `CharacterMinted(uint256 indexed id, address indexed to, address account, bytes32 sheetHash, string name)`.

### `BondingCurve`
One per series. Holds USDC reserves and the curve coins.
- Immutable: `seriesId`, `coin`, `usdc`, `math` (ICurveMath), `router` (IRoyaltyRouter), `graduator`, `graduationTarget`, `launchedAt`.
- State: `vU`, `vC`, `k`, `raised`, `complete`, `graduated`.
- `quoteBuy(uint256 usdcIn) view returns (uint256 coinOut, uint256 fee, uint256 usdcUsed)` — applies fee and clipping.
- `quoteSell(uint256 coinIn) view returns (uint256 usdcOut, uint256 fee)`.
- `buy(uint256 usdcIn, uint256 minCoinOut, address recipient) returns (uint256 coinOut)` — `transferFrom` the used amount.
- `buyWithAuthorization(address buyer, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s) returns (uint256 coinOut)` — calls `USDC.receiveWithAuthorization(buyer, address(this), usdcIn, validAfter, validBefore, nonce, v, r, s)` where **`nonce = keccak256(abi.encode(BUY_TYPEHASH_TAG, address(this), buyer, usdcIn, minCoinOut, deadline, salt))`** with `BUY_TYPEHASH_TAG = keccak256("KOMA_BUY_V1")`. The buyer's single USDC signature therefore also commits to `minCoinOut` and `deadline`; the relayer cannot change them. Coins go to `buyer`. If clipping leaves unused USDC, refund it to `buyer` in the same tx.
- `sell(uint256 coinIn, uint256 minUsdcOut, address recipient) returns (uint256 usdcOut)`.
- `sellWithPermit(address seller, uint256 coinIn, uint256 minUsdcOut, uint256 deadline, uint8 pv, bytes32 pr, bytes32 ps, bytes intentSig) returns (uint256 usdcOut)` — calls `coin.permit(seller, address(this), coinIn, deadline, pv, pr, ps)` (tolerate an existing sufficient allowance if permit reverts), and verifies `intentSig` as an EIP-712 signature by `seller` over `Sell(address seller,uint256 coinIn,uint256 minUsdcOut,uint256 deadline,uint256 nonce)` with domain `{name: "KOMA Curve", version: "1", chainId, verifyingContract: curve}` and a per-seller `sellNonces(seller)` counter.
- Anti-snipe: during `block.timestamp < launchedAt + SNIPE_WINDOW`, revert if the recipient's coin balance after a buy exceeds `SNIPE_CAP`.
- Fees: buys take 1.5% of the USDC used, sells take 1.5% of gross USDC out. Fee → `usdc.transfer(router, fee)` then `router.route(seriesId, fee)`.
- `graduate()` — anyone, once, when `complete`: transfers all remaining coins and all real USDC to `graduator` and calls `graduator.graduate(seriesId, coin, usdcAmount, coinAmount, vU, vC)`. Sets `graduated`.
- Events: `Trade(address indexed trader, bool indexed isBuy, uint256 usdcAmount, uint256 coinAmount, uint256 fee, uint256 vU, uint256 vC, uint256 raised)`, `Completed(uint256 raised)`, `Graduated(address pool, bytes32 poolId, uint256 usdcToPool, uint256 coinToPool)`.
- Views: `state() returns (uint256 vU, uint256 vC, uint256 raised, uint256 target, bool complete, bool graduated, uint256 launchedAt)`, `spotPrice()`.

### `Graduator`
- `graduate(uint256 seriesId, address coin, uint256 usdcAmount, uint256 coinAmount, uint256 vU, uint256 vC)` — only registered curves (factory registers). **Graduation fee first:** `fee = usdcAmount * GRADUATION_FEE_BPS / 10_000` (5%, floor) → `usdc.safeTransfer(treasury, fee)`, event `GraduationFee(seriesId, fee)`. The LP is then sized from `usdc' = usdcAmount - fee`. Final price `P = vU/vC` (the pool still opens exactly at the curve's final price). Uses as much as possible of both sides at price `P`: if `usdc' > coinAmount*P`, LP gets all coins plus `coinAmount*P` USDC and the extra USDC goes to the treasury; otherwise LP gets all of `usdc'` plus `usdc'/P` coins and the extra coins are burned (sent to `0x…dEaD`).
- Creates a Uniswap v4 pool: `PoolKey{currency0, currency1 (sorted), fee: 3000, tickSpacing: 60, hooks: Graduator}` (see deviation 5: the Graduator is an initialize-only hook), `PoolManager.initialize(key, sqrtPriceX96)` with the price from `P` (mind token ordering and decimals). Adds full-range liquidity through `PositionManager.modifyLiquidities` (MINT_POSITION + SETTLE_PAIR, Permit2 approvals) and sends the position NFT to `0x000000000000000000000000000000000000dEaD`.
- Arbitrum Sepolia: PoolManager `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317`, PositionManager `0xAc631556d3d4019C95769033B5E719dD77124BAc`, Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3`; Arbitrum One: PoolManager `0x360e68faccca8ca495c1b759fd9eee466db9fb32`, PositionManager `0xd88f38f930b7952f2db2432cb002e7abbf3dd869`, same Permit2 — constructor args.
- Events `GraduationFee(uint256 indexed seriesId, uint256 usdcFee)` (emitted before `PoolCreated`, in the same tx) and `PoolCreated(uint256 indexed seriesId, bytes32 poolId, uint160 sqrtPriceX96, uint256 usdcToPool, uint256 coinToPool, uint256 liquidity)` (unchanged). Views `poolKeyOf(uint256 seriesId)`, `GRADUATION_FEE_BPS()`.

### `KomaSwapper` (post-graduation trading)
- Implements `IUnlockCallback` against the v4 PoolManager.
- `swapExactIn(uint256 seriesId, bool buyCoin, uint256 amountIn, uint256 minOut, address recipient) returns (uint256 amountOut)` — `transferFrom` the input.
- `swapWithAuthorization(...)` — buy side only, same EIP-3009 nonce-commitment trick as the curve (`keccak256("KOMA_SWAP_V1")` tag).
- `quote` is done off-chain via the v4 Quoter.

### `CanonRegistry`
- Roles: `RELAYER_ROLE` (server), `FACTORY_ROLE` (factory registers series).
- `registerSeries(uint256 seriesId, address coin, address characterNft, uint256 characterId, uint64 votingWindow)` — factory only.
- `propose(uint256 seriesId, uint256 issueId, address proposer) returns (uint256 episode)` — relayer only. Proposes for the currently open episode `nextEpisode(seriesId)`. If the slot isn't open yet, opens it: `snapshot = block.timestamp - 1`, `endsAt = block.timestamp + votingWindow`. Allowed when `coin.getPastVotes(proposer, snapshot) >= CANON_THRESHOLD` **or** `proposer` owns the Character NFT. Reverts after `endsAt`. An issue can be proposed once.
- `finalize(uint256 seriesId, uint256 episode, uint256 winnerIssueId, bytes32 votesRoot, uint256 winnerVotes, uint256 totalVotes)` — relayer only, after `endsAt`, once; winner must be a proposal of that slot. Sets canon, `nextEpisode++`.
- Views: `nextEpisode(uint256 seriesId)`, `slot(uint256 seriesId, uint256 episode) returns (uint64 snapshot, uint64 endsAt, bool finalized, uint256 winner, uint256 proposalCount)`, `proposals(uint256 seriesId, uint256 episode) returns (uint256[] issueIds)`, `canonOf(uint256 seriesId, uint256 episode)`, `seriesOfIssue(uint256 issueId) returns (uint256 seriesId, uint256 episode, address proposer)`, `votingPower(uint256 seriesId, uint256 episode, address voter) view` (= `getPastVotes(voter, snapshot)`).
- Events: `SlotOpened(uint256 indexed seriesId, uint256 indexed episode, uint64 snapshot, uint64 endsAt)`, `Proposed(uint256 indexed seriesId, uint256 indexed episode, uint256 indexed issueId, address proposer)`, `CanonFinalized(uint256 indexed seriesId, uint256 indexed episode, uint256 winnerIssueId, bytes32 votesRoot, uint256 winnerVotes, uint256 totalVotes)`.
- Off-chain vote (EIP-712): domain `{name: "KOMA Canon", version: "1", chainId, verifyingContract: CanonRegistry}`, type `Vote(uint256 seriesId,uint256 episode,uint256 issueId,address voter)`. Weight = `votingPower(...)`. `votesRoot` = keccak256 of the canonical JSON of all accepted votes (published at `/api/canon/[series]`).

### `SeriesFactory`
- Roles: `LAUNCHER_ROLE` (server relayer).
- Constructor wires `usdc, math, router, characterNft, canon, graduator, treasury`.
- `launch(LaunchParams p) returns (uint256 seriesId)` where
  ```solidity
  struct LaunchParams {
      address creator; string name; string symbol; string characterName; bytes32 sheetHash;
      uint256 parentSeriesId; uint256 graduationTarget; uint64 votingWindow;
  }
  ```
  One tx: mint Character NFT (+ TBA) to `creator` → deploy `VestingWallet(creator, now, 30 days)` → deploy curve → deploy coin (curve + vesting get supply) → set curve's coin → `router.registerSeries` → `canon.registerSeries` → graduator registers curve. `graduationTarget == 0` → default; `votingWindow == 0` → default. Use small deployer contracts (or CREATE2 with precomputed addresses) so the factory stays under the 24 KB size limit.
- `series(uint256 id) returns (Series)` with `{coin, curve, vesting, characterId, characterAccount, creator, parentSeriesId, graduationTarget, votingWindow, launchedAt}`; `seriesCount()`.
- Event `SeriesLaunched(uint256 indexed seriesId, address indexed creator, address coin, address curve, uint256 characterId, address characterAccount, uint256 parentSeriesId, uint256 graduationTarget, string name, string symbol)`.

### `KomaIssues` — unchanged (already deployed and used by the pipeline). Series/episode linkage lives in `CanonRegistry.seriesOfIssue`.

## Deployment

- Arbitrum Sepolia: Stylus `curve-math` + `royalty-router` (`cargo stylus deploy`), then `forge script script/DeployLaunchpad.s.sol` with env `MATH`, `ROUTER` (Stylus addresses), `USDC`, `TREASURY`, `RELAYER`, and v4/6551 addresses; then `router.initialize(...)`/`setFactory`.
- KOMA localnet (anvil fork, no Stylus support): same script with `MATH`/`ROUTER` unset → deploys `CurveMathReference` and `RoyaltyRouterReference`. `/api/status` reports `engine: "stylus" | "solidity-reference"`.
- Output: `deploy/addresses.<network>.json` `{ chainId, usdc, komaIssues, seriesFactory, characterNft, canonRegistry, graduator, swapper, curveMath, royaltyRouter, engine, poolManager, positionManager, permit2, erc6551Registry, accountProxy, accountImpl, treasury, relayer, deployBlock }`.

## Server API (Next.js, `src/app/api/`)

- `GET /api/series` → `{ series: SeriesSummary[] }` sorted by recent activity.
- `GET /api/series/[id]` → `SeriesDetail`.
- `GET /api/series/quote` / `POST /api/series` → x402-paid launch ($0.10). Body `{ name, symbol, characterName, characterPrompt, pitch, parentSeriesId?, demo?: boolean }`; returns `{ jobId }`; job stages `sheet → launching → done` with result `{ seriesId, txHash }`.
- `POST /api/trade/relay` → body `{ kind: "buy", curve, buyer, usdcIn, minCoinOut, deadline, salt, validAfter, validBefore, signature }` or `{ kind: "sell", curve, seller, coinIn, minUsdcOut, deadline, permit: {v,r,s}, intentSignature }` → `{ txHash }`.
- `POST /api/series/[id]/graduate` → anyone; server submits `graduate()` → `{ txHash }` (also automatic).
- `GET /api/canon/[series]` → `{ episode, slot, proposals: [{issueId, proposer, votes, issue}], canon: [{episode, issueId}], votes: SignedVote[] }`.
- Episode proposal: existing `/api/comics` x402 route with body fields `seriesId` (+ proposer = payer); the pipeline mints the issue then calls `CanonRegistry.propose`.
- `POST /api/canon/[series]/vote` → `{ episode, issueId, voter, signature }` → `{ ok, weight }`.
- `GET /api/status` adds `launchpad: { engine, addresses, relayerEth }`.

```ts
type SeriesSummary = {
  id: number; name: string; symbol: string; characterName: string; sheetUrl: string;
  coin: `0x${string}`; curve: `0x${string}`; characterId: number; characterAccount: `0x${string}`;
  creator: `0x${string}`; parentSeriesId: number; priceUsdc: number; marketCapUsdc: number;
  raisedUsdc: number; targetUsdc: number; complete: boolean; graduated: boolean; demo: boolean;
  holders: number; episodes: number; launchedAt: number; lastTradeAt: number | null;
};
type SeriesDetail = SeriesSummary & {
  pitch: string; vestingContract: `0x${string}`; characterEarnedUsdc: number;
  trades: { tx: string; trader: string; isBuy: boolean; usdc: number; coins: number; price: number; at: number }[];
  chart: { t: number; price: number }[];
  pool: { poolId: string; usdc: number; coins: number } | null;
  remixes: { id: number; name: string }[];
};
```

## Deviations (Solidity lane, as implemented)

1. **`BondingCurve.coin` is set-once storage, not immutable.** The launch order (curve → coin minted to the curve → "set curve's coin") makes an immutable impossible. `setCoin(address)` is callable once by the curve's `factory` (new last constructor arg). Constructor also rejects targets the 950M curve coins cannot fill (`quoteBuy(U0, C0, target) > CURVE_SUPPLY`, i.e. target > 19,000 USDC) with `InvalidTarget`. Since 2026-10-01 it also requires `MIN_POOL_COINS` (10M) to stay unsold, capping targets at 15,666 USDC.
2. **Fee rounding** (unspecified before): `fee = ceil(amount * FEE_BPS / 10_000)` on both sides. A clipped buy uses `usdcUsed = remaining + ceil(remaining * FEE_BPS / (10_000 - FEE_BPS))` (with `FEE_BPS = 150`: `ceil(remaining * 150 / 9_850)`), the smallest spend whose net is exactly `remaining`. `Trade.usdcAmount` = USDC paid incl. fee (buys) / USDC received net of fee (sells).
3. **Sells revert with `InsufficientReserve`** if the gross payout exceeds `raised` (possible only with coins that never came from the curve, e.g. vested creator coins).
4. **`graduate()`** moves the curve's full USDC/coin balances (sweeps donations). `Graduator.graduate(...)` returns `(bytes32 poolId, uint256 usdcToPool, uint256 coinToPool)`; the curve's `Graduated.pool` is the PoolManager address. Graduator adds `registerCurve(seriesId, curve)` (FACTORY_ROLE), constructor `(admin, poolManager, positionManager, permit2, usdc, treasury)`; dust left after the mint goes the same way as surplus (USDC → treasury, coins → 0x…dEaD).
5. **Pool-squatting defence (addition; reworked 2026-10-01, AUDIT.md H-1).** The pool key's `hooks` is the Graduator itself, deployed with CREATE2 at an address whose low 14 bits are exactly `BEFORE_INITIALIZE_FLAG` (the constructor reverts otherwise). Its `beforeInitialize` rejects every caller and the Graduator's own `initialize` skips the hook (v4 `noSelfCall`), so nobody else can create a series pool and the PoolManager refuses swaps / liquidity / donations on the key until graduation. The price-correction swap, `unlockCallback` and `PoolPriceCorrected` are gone. `SeriesCoin` still reverts transfers *to the v4 PoolManager* until `curve.graduated()` (no pre-graduation trading in any other v4 pool).
6. **`KomaSwapper.swapWithAuthorization(address buyer, uint256 seriesId, uint256 usdcIn, uint256 minCoinOut, uint256 deadline, bytes32 salt, uint256 validAfter, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)`**, nonce `keccak256(abi.encode(keccak256("KOMA_SWAP_V1"), swapper, buyer, seriesId, usdcIn, minCoinOut, deadline, salt))`. Helper views `BondingCurve.buyNonce(buyer, usdcIn, minCoinOut, deadline, salt)` and `KomaSwapper.swapNonce(...)` return the exact nonce to sign. Event `Swapped(seriesId, payer, recipient, buyCoin, amountIn, amountOut)`.
7. **`ICurveMath`**: all four functions revert on `vU == 0 || vC == 0`. `spotPrice` is the literal `vU * 1e18 / vC`, which is **1** at launch (≈36 at a $5k raise) — too coarse for a UI; the frontend should compute price from `state()`. If "scaled by 1e18" was meant (`vU * 1e36 / vC`), both engines must change together.
8. **`RoyaltyRouterReference`**: `initialize` is callable only by the deployer (prevents front-running); zero-amount legs are skipped (no transfer, no `Routed` event); `registerSeries` rejects id 0, zero addresses and duplicates; `setFactory` can be re-pointed by the owner.
9. **`CanonRegistry`**: `propose` allowed while `block.timestamp < endsAt`, `finalize` when `>= endsAt`; `issueId == 0` rejected; `winnerVotes <= totalVotes` enforced; extra view `seriesConfig(seriesId)` and event `SeriesRegistered`.
10. **Constructors**: `CharacterNFT(admin, registry, accountProxy, accountImpl, baseURI)` (uses `_mint`, `initialize` wrapped in try/catch so a pre-created account is tolerated; on Arbitrum One and Sepolia the Tokenbound guardian trusts no implementation, so `initialize` always reverts and accounts run the proxy's immutable initial implementation, AccountV3); `SeriesFactory(admin, usdc, math, router, characterNft, canon, graduator, treasury, curveDeployer, coinDeployer, minGraduationTarget, minVotingWindow)`; `CanonRegistry(admin)`; `KomaSwapper(poolManager, graduator, usdc)`.
11. **Deploy output** is `deploy/addresses.<chainId>.json` (override with `ADDRESSES_OUT`, `none` to skip). `deployBlock` is the L2 block number from the RPC (EVM `block.number` is L1 on Arbitrum). When `KOMA_ISSUES` is unset a fresh `KomaIssues(ADMIN, RELAYER, KOMA_BASE_URI)` is deployed. `MATH`/`ROUTER` must be both set or both unset (and are mandatory Stylus programs on 42161). Added fields: `v4Quoter` (every chain), `admin`, `routerWired`, `minGraduationTarget`, `minVotingWindow`. Runbook: `deploy/MAINNET.md`.
12. **Fee routing never blocks a trade (AUDIT.md M-1).** `BondingCurve._routeFee` pushes the fee through a self-call (`pushFee`, self-only) inside `try`; if routing fails (a recipient is USDC-blacklisted, the router program is inactive, ...) the fee stays in the curve as `unroutedFees` (event `FeeRoutingDeferred(fee)`), outside the reserves and never sent to the Graduator; anyone can retry with `flushFees()` (event `FeesFlushed(amount)`). An out-of-gas inside the self-call reverts the trade (`FeeRoutingOutOfGas`). The Graduator likewise parks failed treasury payments in `treasuryOwed` (event `TreasuryPaymentDeferred`) and `flushTreasury()` (anyone, event `TreasuryFlushed`) retries; owed USDC is never pooled.
13. **`BondingCurve.invalidateSellNonce()`** (AUDIT.md L-3): the caller burns its next `Sell` intent nonce (event `SellNonceInvalidated(seller, nonce)`), cancelling a signed intent before its deadline.
14. **Launch bounds (AUDIT.md L-2).** `SeriesFactory` reverts `TargetTooLow` below the immutable `minGraduationTarget` and `InvalidVotingWindow` outside `[minVotingWindow, MAX_VOTING_WINDOW = 30 days]` (applied after the 0 → default substitution; floors above the defaults are rejected at construction). The deploy sets 1,000 USDC / 1 h on Arbitrum One and 1 USDC / 60 s elsewhere, so the testnet demo values (25 USDC / 300 s) cannot launch on mainnet.

## Changes log

- **2026-10-01 — pre-mainnet audit (contracts/AUDIT.md).** Economics unchanged (fees, split, graduation fee, curve). `IRoyaltyRouter` gains `transferOwnership(address)` and `OwnershipTransferred(previousOwner, newOwner)` (also emitted by `initialize`), in Stylus and the Solidity reference; ABI re-exported (`stylus/abi/check-abi.sh` IDENTICAL), router vectors unchanged. Graduator becomes the pool's initialize-gating hook (deviation 5); deferred fee / treasury payments (12); `invalidateSellNonce` (13); launch bounds and two new `SeriesFactory` constructor args (14); per-chain deploy address book with Arbitrum One guards (11). Unit tests now run Circle's real FiatToken v2.2 and the real Tokenbound registry / AccountProxy / AccountV3 (runtime code from Arbitrum One, etched); the mocks are deleted.

- **2026-10-01 — fee economics (owner decision).** `FEE_BPS` 100 → **150** (1.5%, still on the USDC side of every curve buy and sell, still `ceil`, against the trader). Fee split 5000/2000/3000 → **4000/2000/4000** (character TBA / remix pool / treasury; remix-pool mechanics unchanged, dust to the character, total paid = `amount`). New **`GRADUATION_FEE_BPS = 500`**: `Graduator.graduate` sends `usdcAmount * 500 / 10_000` to the treasury before sizing the LP and emits the new event `GraduationFee(uint256 indexed seriesId, uint256 usdcFee)`; `PoolCreated` is unchanged, and `usdcToPool` in `PoolCreated`/`Graduated` is now net of the fee. Stylus `royalty-router` updated identically (`MAX_AMOUNT` overflow bound is now `(2^256-1)/4000`, matching Solidity's `amount * 4000`); `stylus/test-vectors/router.json` regenerated (curve vectors unchanged: the curve math is fee-free). `DEFAULT_GRADUATION_TARGET` is still measured net of trading fees.
- **Fixed 2026-10-01:** a series launched with the old maximum target (19,000 USDC) sold every curve coin, so `graduate()` had no coins to pair and reverted (`CannotUpdateEmptyPosition`), stranding its USDC. The curve now requires at least `MIN_POOL_COINS` = 10M coins to remain unsold at the target (max target 15,666 USDC); a fuzz test graduates targets across the whole allowed range.
