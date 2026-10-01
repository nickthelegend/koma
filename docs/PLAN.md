# KOMA Launchpad — Plan

Planning document. Written 2026-09-30 after a full repo audit and a 10-question decision session.
Nothing in this file has been built yet unless tagged **[DONE]**.

---

## 1. Executive summary

KOMA today is a working AI comic studio on Arbitrum: you chat with an AI editor, pay USDC over x402 (gasless, KOMA runs its own facilitator), fal.ai writes and draws the issue, and it is minted as an ERC-721. It is live at https://koma-arbitrum.vercel.app on a hosted Arbitrum Sepolia fork.

The plan turns KOMA into a **comics launchpad**: every series launches a **Character NFT** (with its own ERC-6551 wallet and a reference character sheet) and a **Series Coin** on a **USDC bonding curve** whose math runs in **Arbitrum Stylus (Rust)**. Coin holders **write the canon**: they propose the next episode with the AI studio, vote gaslessly with their coin weight, and the winner becomes canon. Trading fees flow to the character's wallet, up the remix tree (Stylus royalty router), and to KOMA. When a curve raises its target it **graduates** into a locked Uniswap v4 pool.

Target: **Arbitrum Open House Singapore** — Buildathon submission **October 4, 2026**, Founder House **October 23–25, 2026**. User decision: ship everything by Oct 4.

The single hard blocker is **Arbitrum Sepolia ETH**: every wallet on this machine has 0 on Arbitrum Sepolia and Ethereum Sepolia (checked 2026-09-30). Nothing public can deploy until at least ~0.02 ETH arrives.

## 2. Vision, problem, users

**Vision.** Comics where the fans own the story. A character is an onchain asset that earns; a series is a market; canon is decided by the people who hold it.

**Problem.** Webcomic and manga fandoms produce enormous derivative work (fan comics, remixes, AUs) with no ownership, no revenue path, and no way to decide what counts. AI makes drawing cheap but characters drift from panel to panel, so AI comics feel disposable.

**Users.**
- *Creators* — launch a character and a series in minutes, earn from trading fees through the character's wallet, keep a vested 5% stake.
- *Fans / holders* — buy into series early, propose episodes, vote on canon, remix.
- *Readers* — read free, pay cents to commission an issue.
- *Judges (Oct 4)* — need to see real contracts on Arbitrum, Stylus in a meaningful role, a repo that matches the demo, and a loop that works live.

## 3. Goals and definition of done

**Product done.** A new user with a browser wallet and test USDC can: launch a series (Character NFT + coin), buy and sell the coin, propose an episode, vote, see a canon episode finalized, remix a series, and watch a series graduate — all without holding ETH.

**Technical done.**
- All contracts deployed and verified on Arbitrum Sepolia (421614); Stylus contracts activated.
- Foundry tests (unit + fuzz on curve invariants) and `cargo test` for Stylus pass.
- Zero mocks: real fal, real chain, real SQLite, real x402 settlement.
- `scripts/e2e-api.mjs` extended and passing against the public deployment.

**Demo done.** A 3-minute video and a live URL showing the full loop, including one real graduation into Uniswap v4 and a Stylus-vs-Solidity gas comparison.

**Hackathon done.** Public GitHub repo with history, README with architecture + contract addresses, demo video, submission on HackQuest/Open House before the Oct 4 deadline.

**MVP done (Founder House).** Same as above plus paymaster-sponsored direct trades, motion cover on graduation, monitoring and a daily fal spend cap proven under load.

## 4. Constraints and decisions

Decisions from the grilling session (Q1–Q10):

| # | Decision | Choice |
|---|---|---|
| Q1 | Target | Open House Singapore + keep building after |
| Q2 | Launch unit | Both: Series Coin (ERC-20) **and** Character NFT (ERC-721) |
| Q3 | Core loop | Holders write canon |
| Q4 | Chain | Public Arbitrum Sepolia; the hosted localnet stays as a rehearsal environment |
| Q5 | Payments / gas | USDC curves. Episode payments and votes gasless via KOMA's x402 facilitator/relayer. Curve trades are user-signed; Pimlico paymaster sponsors gas where the wallet supports it |
| Q6 | Economics | 1B supply; **5% creator allocation, linear vest over 30 days**; 95% on a virtual constant-product curve (~$1K starting market cap); graduate at **5,000 USDC** raised into a locked Uniswap v4 coin/USDC pool; **1% trade fee** split 50% Character TBA / 20% remix parent (else character) / 30% treasury; canon threshold **1M coins (0.1%)**; anti-snipe **max 2% of supply per wallet for the first 10 min** |
| Q7 | Stylus | Hybrid: Solidity for money path (factory, coins, curve custody, graduation, NFTs, vesting); **Stylus for curve math and the remix royalty router** |
| Q8 | Canon | ≥1M-coin holders propose (x402-paid, minted as draft issue) → EIP-712 coin-weighted votes at a snapshot block → relayer finalizes onchain; losers stay as alt-universe issues. Window 5 min in demo mode, 24 h default |
| Q9 | AI stack | Claude Sonnet via `openrouter/router` (replaces deprecated `fal-ai/any-llm`); FLUX.2 character sheet per Character NFT; panels via `fal-ai/flux-2/edit` with the sheet as reference (~$0.024/panel, same as today); motion cover is a stretch |
| — | Episode price | Stays **$0.10/page** (fal cost ≈ $0.10/page) |
| Q10 | Scope by Oct 4 | Everything |

**Red-team amendments (made while writing this plan, see §15):**
- **Gasless trading fallback.** Nobody (including judges) can easily get Arbitrum Sepolia ETH, so "user pays gas" would block most demo users. The curve also accepts **relayed intents**: a buy is a signed USDC `receiveWithAuthorization` (EIP-3009, same mechanism x402 already uses) plus a signed min-out; a sell is a signed EIP-2612 permit on the Series Coin plus min-out. KOMA's relayer submits. Direct wallet transactions (with Pimlico sponsorship when available) remain the primary path for wallets that have gas.
- **Demo graduation threshold.** 5,000 test USDC is unreachable with faucet USDC. The factory takes the threshold per series; production default stays 5,000 USDC, the flagged demo series uses **25 USDC** and the UI says so.
- **Snapshot voting power** uses `ERC20Votes` checkpoints with automatic self-delegation, so `getPastVotes(snapshotBlock)` is verifiable onchain instead of trusting an archive RPC.

**Hard constraints.**
- Testnet only. No mainnet deployment, no real-money flows, no revenue-share promises in copy ("collectible utility token on testnet").
- fal spend is real money: daily budget cap required.
- Arbitrum Sepolia ETH must come from the user (faucets need logins/CAPTCHAs — Claude cannot do them).
- Publishing the GitHub repo is an outward-facing action: requires the user's explicit go.

**Verified infrastructure on Arbitrum Sepolia (codesize checked 2026-09-30):**

| Contract | Address |
|---|---|
| USDC (Circle) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Uniswap v4 PoolManager | `0xFB3e0C6F74eB1a21CC1Da29aeC80D2Dfe6C9a317` |
| Uniswap v4 PositionManager | `0xAc631556d3d4019C95769033B5E719dD77124BAc` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| ERC-6551 Registry | `0x000000006551c19487814612e58FE06813775758` |
| Tokenbound AccountV3 proxy | `0x55266d75D1a14E4572138116aF39863Ed6596E7F` |
| Tokenbound AccountV3 impl | `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC` |

Also documented (not codesize-checked): Universal Router `0xefd1d4bd4cf1e86da286bb4cb1b8bced9c10ba47`, StateView `0x9d467fa9062b6e9b1a46e26007ad82db116c67cb`, Quoter `0x7de51022d70a725b508085468052e25e22b5c4c9`.

> **Economics update, 2026-10-01:** 1.5% curve fee split 40/20/40 (character / remix tree / KOMA), 5% graduation fee, $1 launch, 30¢/page episodes, comics stay 10¢/page, $3 minimum for gasless relays. See README → "How KOMA makes money" and `contracts/LAUNCHPAD_SPEC.md`.

## 5. Final spec

### 5.1 Contracts

**Solidity (`contracts/src/`)**
- `KomaIssues.sol` **[DONE]** — ERC-721 issues, `MINTER_ROLE`, `tokenOfPayment`, `remixOf`. Extended with `seriesId` and `episode` fields (new deployment on Sepolia; localnet deployment unchanged).
- `CharacterNFT.sol` — ERC-721. `mint(to, sheetHash, name)` creates the NFT and its ERC-6551 account via the registry (AccountV3 proxy). `accountOf(tokenId)`.
- `SeriesCoin.sol` — ERC-20 + `ERC20Permit` + `ERC20Votes` (auto self-delegate on first receive). 1B supply minted at creation: 95% to the curve, 5% to `CreatorVesting`.
- `CreatorVesting.sol` — linear 30-day release to the creator (OZ `VestingWallet`).
- `SeriesFactory.sol` — `launch(name, symbol, characterSheetHash, parentSeries, graduationTarget)` in one transaction: mints Character NFT → deploys coin (clone) → deploys curve → sets vesting. Registry of series; emits `SeriesLaunched`.
- `BondingCurve.sol` — custody of USDC reserves and curve coins. `buy(usdcIn, minOut)`, `sell(coinIn, minUsdcOut)`, `buyWithAuthorization(...)`, `sellWithPermit(...)`. Calls Stylus `CurveMath` for quotes. Takes the 1% fee and hands it to Stylus `RoyaltyRouter`. Enforces anti-snipe (2% per wallet for 10 min). On reaching the target, locks and calls `Graduator`.
- `Graduator.sol` — creates a coin/USDC pool on Uniswap v4 PoolManager at the curve's final price, adds full-range liquidity via PositionManager, and sends the position NFT to a dead/locker address.
- `CanonRegistry.sol` — `propose(seriesId, episode, issueTokenId)` (relayer, after checking ≥1M `getPastVotes`), `finalize(seriesId, episode, winnerIssueId, votesRoot)` (FINALIZER_ROLE), `canonOf(seriesId, episode)`. Snapshot block stored per episode slot. Signed votes published off-chain for re-verification.

**Stylus / Rust (`stylus/`)**
- `curve-math` — virtual constant-product quotes: `quote_buy(virtualUsdc, virtualCoin, usdcIn) → coinOut`, `quote_sell(...)`, price, and invariant checks in fixed point (U256). Pure functions.
- `royalty-router` — stores `parentOf(series)`; `route(series, amount)` splits the 1%: 50% to the Character TBA, 20% to the parent series' TBA (walking up to depth N with a decaying share when the parent itself has a parent), 30% treasury. Holds USDC, pays out with `transfer`.
- Gas comparison: a Solidity reference implementation of `curve-math` lives in `test/` only, used by the benchmark script for the demo slide.

### 5.2 Server (Next.js API)
- Existing **[DONE]**: `/api/comics` (x402), `/api/comics/quote`, `/api/chat`, `/api/jobs`, `/api/status`, `/api/facilitator/*`, `/api/rpc`, `/api/faucet` (localnet only), `/api/art`, `/api/tokens`.
- New:
  - `POST /api/series` — x402-paid ($0.10) launch: generate character sheet (FLUX.2), upload/store, relayer calls `SeriesFactory.launch` on behalf of the creator (creator receives the Character NFT and vesting).
  - `GET /api/series`, `GET /api/series/[id]` — indexed series, price, reserves, holders, progress to graduation.
  - `POST /api/trade/relay` — accepts signed buy/sell intents, validates, submits, returns tx hash.
  - `POST /api/canon/[series]/propose` — x402-paid episode job tagged with series/episode; mints draft issue then `CanonRegistry.propose`.
  - `POST /api/canon/[series]/vote` — stores EIP-712 vote; weight = `getPastVotes(voter, snapshot)`.
  - `GET /api/canon/[series]` — proposals, live tallies, all signed votes.
  - Finalizer worker (in `instrumentation.ts` alongside `recoverJobs`) closes expired windows and calls `finalize`.
  - Indexer: polls contract events into SQLite tables `series`, `trades`, `proposals`, `votes`.
- Relayer wallet = the existing server wallet (nonce manager). Needs Sepolia ETH.

### 5.3 AI pipeline
- `writeScript` + `chat` → `openrouter/router`, model `anthropic/claude-sonnet-4.5` (env `KOMA_LLM_MODEL`).
- `characterSheet(prompt)` → FLUX.2 text-to-image, 3-pose turnaround on neutral background.
- `draw(panel)` → `fal-ai/flux-2/edit` with `image_urls: [sheet]` when the issue belongs to a series; plain FLUX.2 otherwise.
- `KOMA_FAL_DAILY_USD` budget: pipeline refuses new jobs (402 → 503 with message) once the estimated daily spend is hit.
- Stretch: graduation motion cover via Kling/Veo image-to-video.

### 5.4 Frontend
- `/launch` — chat-to-launch: describe a character and series → preview sheet → pay → launched.
- `/s/[id]` — series page: character sheet + TBA balance, price chart, buy/sell widget (direct tx, sponsored tx, or gasless intent — chosen automatically), holders, graduation progress bar, canon timeline, open proposals with vote buttons, alt-universe shelf, "Remix this series".
- `/character/[id]` — Character NFT, its wallet, earnings.
- Existing studio, reader, shelf, receipts reused; issue pages show series/episode/canon badge.
- Copy: "testnet collectible", no yield language.

## 6. Priorities

User decision is "everything by Oct 4". The list is still ordered so that if time runs out, cutting happens from the bottom.

**P0 — must be in the submission**
1. Arbitrum Sepolia deployment of all contracts, verified; Stylus contracts activated.
2. Launch series (Character NFT + TBA + coin + vesting).
3. Buy/sell on the USDC curve with Stylus math; fee split to TBA/treasury.
4. Gasless relayed buy/sell (because users have no ETH).
5. Propose → vote → finalize canon.
6. Consistent art via character sheet + `flux-2/edit`; LLM migration.
7. Public GitHub repo, README, demo video, submission.

**P1 — shipped by Oct 4 if the timeline holds**
8. Graduation into Uniswap v4 (demo series threshold 25 USDC).
9. Stylus royalty router with multi-level remix splits.
10. Pimlico-sponsored direct trades.
11. Stylus vs Solidity gas benchmark slide.
12. fal daily budget cap.

**P2 — Founder House**
13. Motion cover on graduation.
14. Monitoring/alerts, CI, backups of SQLite and art volume.
15. Onchain vote verification (Stylus signature batch verify) to remove tally trust.

**Post-MVP**
- Mainnet (requires legal review), per-character LoRA, voiced motion comics, mobile layout pass for trading, Postgres/multi-instance.

## 7. Architecture and flows

```
Browser (wagmi/viem) ──► Vercel (koma-arbitrum.vercel.app, rewrites)
                              │
                              ▼
                    Railway "web" (Next.js 16, SQLite on /data)
                     ├─ x402 facilitator + relayer (server wallet)
                     ├─ fal: openrouter/router, flux-2, flux-2/edit
                     ├─ indexer + canon finalizer (instrumentation)
                     └─ RPC ─► Arbitrum Sepolia (421614)
                                   ├─ SeriesFactory ─► CharacterNFT ─► ERC-6551 TBA
                                   │                 ├► SeriesCoin (+Vesting)
                                   │                 └► BondingCurve ─► Stylus CurveMath
                                   │                                  ├► Stylus RoyaltyRouter
                                   │                                  └► Graduator ─► Uniswap v4
                                   ├─ KomaIssues (episodes)
                                   └─ CanonRegistry
Railway "chain" (anvil fork) — rehearsal only
```

**Launch.** Chat → pitch card → `/api/series` quote (x402 402) → user signs USDC authorization → facilitator settles → FLUX.2 sheet → relayer `SeriesFactory.launch` → Character NFT + TBA to creator, coin/curve live.

**Buy (gasless).** Widget quotes via `CurveMath` (eth_call) → user signs EIP-3009 `receiveWithAuthorization` (to = curve) + EIP-712 intent (minOut, deadline) → `/api/trade/relay` → `BondingCurve.buyWithAuthorization` → coins to user, 1% to `RoyaltyRouter`.
**Buy (direct).** Approve/permit + `buy()` from the wallet; `wallet_sendCalls` with Pimlico paymaster capability when supported.

**Canon.** Holder with ≥1M `getPastVotes` opens studio in "episode N of series X" mode → x402 pay → pipeline draws with the character sheet → mints draft issue → `CanonRegistry.propose`. Holders sign EIP-712 `Vote(series, episode, issueId)`; weight at the slot's snapshot block. Window closes → finalizer tallies, publishes all votes, calls `finalize` with votes root. Tie/no votes → Character NFT owner chooses.

**Graduation.** Buy that crosses target → curve locks → `Graduator` initializes v4 pool at final price, adds liquidity, burns position → series page switches the widget to "Trade on Uniswap v4".

## 8. Current state (audited 2026-09-30)

| Area | State |
|---|---|
| App | Next.js 16.3.6, React 19, wagmi 3, viem 2.56.9, x402 2.27. 13 API routes, 10 pages, chat studio + form studio **[DONE]** |
| Contracts | `KomaIssues.sol` + 6 Foundry tests **[DONE]**. No launchpad contracts |
| Stylus | Toolchain ready: Rust, `cargo-stylus` 0.10.9, `wasm32-unknown-unknown`. No crate |
| AI | `fal-ai/any-llm` (deprecated) + `fal-ai/flux/dev`, text-only prompts, 4 panels/page |
| Storage | SQLite (`issues`, `jobs`, `faucet_claims`), art copied to `/data` |
| Deploy | Live on Vercel → Railway `web` + `chain` (anvil fork, chain id 4216141). Tests E1, E2, E4–E8 PASS; E3 (public testnet) UNTESTED |
| Wallets | 8 keys across local env files; all 0 ETH on Arbitrum Sepolia and Ethereum Sepolia |
| Git | One create-next-app commit; ~34 uncommitted paths; no remote. `gh` logged in as `nickthelegend` |
| Hackathon | User registered for Open House Singapore; submission Oct 4, 2026 |

## 9. Gap audit

| # | Gap | Evidence | Impact | Severity | Blocked phase | Resolution |
|---|---|---|---|---|---|---|
| G1 | No Arbitrum Sepolia ETH | `cast balance` = 0 for all 8 wallets | Cannot deploy, relay, or settle x402 publicly | Critical | P4, P6, P10–P12 | User obtains ETH (§12.1); ~0.02 ETH is enough |
| G2 | No launchpad contracts | Only `KomaIssues.sol` | No product | Critical | P2 | Phase 2 |
| G3 | No Stylus code | No `stylus/` dir | Loses the Arbitrum-native story | High | P3 | Phase 3 |
| G4 | `fal-ai/any-llm` deprecated | `ai.ts:94` | Script/chat may break any day | High | P5 | Migrate to `openrouter/router` |
| G5 | No character consistency | `ai.ts:112` flux/dev, text-only | Character NFT loses meaning | High | P5 | Sheet + `flux-2/edit` refs |
| G6 | No repo history / remote | `git log` = 1 commit | Judges check repo matches demo | High | P12 | Commit in logical chunks, publish on user's go |
| G7 | No series/trade/canon UI | Pages list | Nothing to demo | Critical | P7 | Phase 7 |
| G8 | Users have no ETH to trade | G1 + faucet friction | Demo users stuck at "insufficient gas" | High | P7 | Gasless relayed intents (§4 amendment) |
| G9 | No Pimlico API key | Not in env | No sponsored direct txs | Medium | P9 | User creates free key; fallback to relayed intents |
| G10 | Test USDC only via Circle faucet | No server faucet on public chain | Demo wallets need USDC | Medium | P10, P12 | Pre-fund demo wallets from faucet.circle.com; in-app link |
| G11 | No snapshot voting power | — | Vote manipulation by moving coins | High | P2, P6 | `ERC20Votes` + snapshot block per slot |
| G12 | 5,000 USDC graduation unreachable on testnet | Faucet limits | No live graduation in demo | Medium | P8 | Per-series target; demo series 25 USDC, labelled |
| G13 | No fal spend cap | Only chat caps exist | Real-money runaway | Medium | P5 | `KOMA_FAL_DAILY_USD` |
| G14 | Railway build targets localnet | Dockerfile build args | Public site still on fork | High | P11 | Rebuild with `NEXT_PUBLIC_KOMA_NETWORK=arbitrum-sepolia` |
| G15 | Contract verification not set up | No Arbiscan key | Judges can't read source | Medium | P4 | Arbiscan (Etherscan v2) API key from user, or Sourcify |
| G16 | No legal/utility copy | — | Security-like framing risk | Medium | P7 | Testnet collectible copy, no yield language |
| G17 | No CI / monitoring | — | Silent failures during judging | Low | P2 (Founder House) | GitHub Actions: forge test, cargo test, lint, build |
| G18 | SQLite single instance | `store.ts` | Can't scale horizontally | Low | Post-MVP | Accept for testnet |
| G19 | No demo video / submission text | — | Can't submit | Critical | P12 | Phase 12 |
| G20 | Tally is trusted (server) | Design | Judges may question decentralization | Low | P2 (Founder House) | Publish signed votes + votes root now; onchain verify later |

## 10. Phases and tasks

Legend: **[DONE] [IN PROGRESS] [NOT STARTED] [BLOCKED]**. Owner **U** = user, **C** = Claude.

**Phase 0 — Unblock (U)**
- 0.1 [BLOCKED] Get ≥0.02 Arbitrum Sepolia ETH to `0x83dAD556863b4A4058cccc215a95257453903A04` (§12.1).
- 0.2 [NOT STARTED] Create free Pimlico API key (dashboard.pimlico.io) and put it in `koma/.env.testnet` as `PIMLICO_API_KEY`.
- 0.3 [NOT STARTED] Create an Etherscan v2 API key (covers Arbiscan) → `ETHERSCAN_API_KEY`.
- 0.4 [NOT STARTED] Claim test USDC at faucet.circle.com for 2–3 demo wallets.
- 0.5 [NOT STARTED] Say "publish" to allow creating the public GitHub repo.
- 0.6 [DONE] Register for Open House Singapore.

**Phase 1 — Repo hygiene (C)**
- 1.1 [NOT STARTED] Commit existing KOMA work in logical commits (app, contracts, deploy, docs).
- 1.2 [NOT STARTED] Create `nickthelegend/koma` on GitHub and push (after 0.5).

**Phase 2 — Solidity contracts (C)** — can start now, no ETH needed
- 2.1 [NOT STARTED] `SeriesCoin` (ERC20 + Permit + Votes, auto-delegate), `CreatorVesting`.
- 2.2 [NOT STARTED] `CharacterNFT` with ERC-6551 account creation.
- 2.3 [NOT STARTED] `BondingCurve` (reserves, fee, anti-snipe, intents: `buyWithAuthorization`, `sellWithPermit`).
- 2.4 [NOT STARTED] `SeriesFactory` (clones, one-tx launch, per-series graduation target).
- 2.5 [NOT STARTED] `CanonRegistry`.
- 2.6 [NOT STARTED] `Graduator` (v4 pool init + full-range LP + burn).
- 2.7 [NOT STARTED] `KomaIssues` v2 fields (`seriesId`, `episode`).
- 2.8 [NOT STARTED] Foundry tests: unit, fuzz (curve monotonic, no free value on buy→sell round-trip, reserves ≥ owed), fork tests against Arbitrum Sepolia for 6551 + v4.

**Phase 3 — Stylus (C)** — parallel with Phase 2
- 3.1 [NOT STARTED] `stylus/curve-math` crate + `cargo test` + ABI export.
- 3.2 [NOT STARTED] `stylus/royalty-router` crate + tests.
- 3.3 [NOT STARTED] Solidity interface files generated from Stylus ABI; integration test on the local fork (Stylus runs on a nitro devnode, not anvil — see §15 R3).
- 3.4 [NOT STARTED] Gas benchmark script (Stylus vs Solidity reference).

**Phase 4 — Deploy to Arbitrum Sepolia (C)** — needs 0.1
- 4.1 [BLOCKED] `cargo stylus deploy` both crates (includes activation).
- 4.2 [BLOCKED] `forge script` deploy Solidity suite; wire roles (MINTER, FINALIZER, RELAYER).
- 4.3 [BLOCKED] Verify on Arbiscan (needs 0.3) or Sourcify.
- 4.4 [BLOCKED] Write addresses to `deploy/addresses.arbitrum-sepolia.json` and README.

**Phase 5 — AI pipeline (C)** — can start now
- 5.1 [NOT STARTED] Migrate LLM calls to `openrouter/router`.
- 5.2 [NOT STARTED] Character sheet generation (FLUX.2).
- 5.3 [NOT STARTED] Series-aware `draw` using `flux-2/edit` + sheet reference; keep flux-2 t2i for standalone issues.
- 5.4 [NOT STARTED] `KOMA_FAL_DAILY_USD` budget guard.
- 5.5 [NOT STARTED] Stretch: motion cover.

**Phase 6 — Server (C)** — code now, live test after Phase 4
- 6.1 [NOT STARTED] SQLite tables + event indexer.
- 6.2 [NOT STARTED] `/api/series` (x402 launch).
- 6.3 [NOT STARTED] `/api/trade/relay` with intent validation, per-IP limits.
- 6.4 [NOT STARTED] Canon propose/vote/list routes + finalizer worker.
- 6.5 [NOT STARTED] `/api/status` reports new contracts and relayer ETH balance.

**Phase 7 — Frontend (C)** — parallel with Phase 6
- 7.1 [NOT STARTED] `/launch` chat-to-launch flow.
- 7.2 [NOT STARTED] `/s/[id]` series page: chart, trade widget (direct / sponsored / gasless), graduation bar.
- 7.3 [NOT STARTED] Canon board: proposals, vote, timeline, alt-universe shelf.
- 7.4 [NOT STARTED] `/character/[id]` + TBA earnings.
- 7.5 [NOT STARTED] Home/nav: trending series; testnet collectible copy.

**Phase 8 — Graduation (C)** — after 2.6 + 4
- 8.1 [NOT STARTED] Graduation flow live on the 25-USDC demo series; UI switch to Uniswap v4.

**Phase 9 — Paymaster (C)** — after 0.2
- 9.1 [NOT STARTED] `wallet_sendCalls` + Pimlico paymaster capability; fallback chain: sponsored → direct → gasless intent.

**Phase 10 — Testing (C)**
- 10.1 [NOT STARTED] Extend `scripts/e2e-api.mjs`: launch → buy (intent) → sell → propose → vote → finalize → graduate.
- 10.2 [NOT STARTED] Browser run (Claude in Chrome / built-in browser) with console + network checks.
- 10.3 [NOT STARTED] Update `TEST_PLAN.md` with section F (launchpad) and the E3 public-testnet run.

**Phase 11 — Deploy app (C)**
- 11.1 [NOT STARTED] Railway `web` env to Arbitrum Sepolia (build args, contract addresses, relayer key from `.env.testnet`); keep `chain` service as rehearsal.
- 11.2 [NOT STARTED] Vercel redeploy; smoke test.

**Phase 12 — Submission (C + U)**
- 12.1 [NOT STARTED] Seed content: 2–3 series with sheets, trades, one finalized canon episode, one graduated demo series.
- 12.2 [NOT STARTED] Demo script + screen recording (C drafts script and records browser flows; U narrates or approves TTS).
- 12.3 [NOT STARTED] README: pitch, architecture, addresses, Stylus section, how to run.
- 12.4 [NOT STARTED] U submits on the Open House / HackQuest page.

## 11. Testing strategy

- **Contracts.** Foundry unit + fuzz: curve price monotonic; buy then sell never returns more USDC than paid; reserves always cover redemptions; fee split sums exactly; anti-snipe cap; vesting schedule; graduation only once; canon finalize only after window and only once. Fork tests against Arbitrum Sepolia for ERC-6551 registry and v4 PoolManager.
- **Stylus.** `cargo test` for math (edge cases: zero, dust, max supply, rounding direction always favours the curve). Differential test: Stylus output == Solidity reference for 10k random inputs.
- **Server.** e2e script against the live URL; relayer rejects replayed/expired intents; vote weight uses snapshot.
- **Browser.** Full user journey with console and network inspection, as in `TEST_PLAN.md` sections A–E.
- **What must work live / may be simulated / must never be faked:**

| MUST WORK LIVE | SAFE TO SIMULATE | MUST NOT BE FAKED |
|---|---|---|
| Contract deploys + verification on Arbitrum Sepolia | Graduation target lowered to 25 USDC for the flagged demo series | Any transaction hash, balance, or price shown in UI |
| x402 payments settled by KOMA's facilitator | Vote window of 5 minutes instead of 24 h | fal generations (no placeholder art) |
| Launch, buy, sell, propose, vote, finalize, graduate | Seed series created ahead of the recording | Stylus involvement (must be the deployed contract actually called) |
| Character-consistent art from fal | Localnet for rehearsal runs | Gas comparison numbers (measured, not estimated) |

## 12. Deploy and operations

**12.1 Getting Arbitrum Sepolia ETH (user).** Arbitrum Sepolia gas is cheap; ~0.02 ETH covers all deploys plus hundreds of relayed transactions. Options, try in order:
1. A faucet that sends Arbitrum Sepolia ETH directly with a social login (e.g. the Alchemy, QuickNode, thirdweb or Chainlink faucets — several require a small mainnet balance; use whichever accepts your account).
2. Google Cloud Web3 faucet → **Ethereum Sepolia** ETH (Google login, no mainnet balance) → bridge at bridge.arbitrum.io to Arbitrum Sepolia (~10–15 min).
3. Ask in the Open House Discord/Telegram — organisers commonly drip testnet ETH to registered builders.
4. Ask anyone with testnet ETH to send 0.02 to `0x83dAD556863b4A4058cccc215a95257453903A04`.

**12.2 Environments.**
- `.env.testnet` (gitignored): relayer/deployer key, `PIMLICO_API_KEY`, `ETHERSCAN_API_KEY`, `FAL_KEY`, contract addresses.
- Railway `web`: rebuilt for `arbitrum-sepolia`; volume `/data` kept. Railway `chain`: rehearsal fork, unchanged.
- Vercel: unchanged rewrites.

**12.3 Operations.** `/api/status` shows relayer ETH balance and daily fal spend; the relayer refuses to submit below 0.002 ETH with a clear message. Rate limits on relay, vote, launch per IP. Daily fal cap.

## 13. Demo, hackathon and launch

**Three-minute demo script.**
1. (0:00) Problem: fan comics have no ownership and AI characters drift.
2. (0:20) Launch: chat an idea → character sheet appears → pay 10¢ USDC gaslessly → Character NFT + coin live on Arbitrum Sepolia (Arbiscan link).
3. (0:50) Trade: buy with no ETH (gasless intent); fee lands in the character's own wallet; show the Stylus contract being called.
4. (1:20) Canon: holder proposes episode 2 with the studio; same character in every panel; two holders vote; finalize; canon badge.
5. (2:00) Remix: someone remixes the series; the parent's character wallet receives royalties through the Stylus router.
6. (2:20) Graduation: demo series crosses its target → Uniswap v4 pool created and LP burned.
7. (2:40) Stylus gas comparison slide; architecture; what's next (Founder House).

**Submission checklist.** Repo URL, live URL, video, contract addresses, team info, category (Promising Products Track: AI agents / new financial primitives, or Open Category).

**Launch after.** Founder House Oct 23–25: paymaster, motion covers, onchain vote verification, monitoring.

## 14. Critical path and parallel work

**Critical path:** 0.1 ETH → 4.1/4.2 deploy → 6.x live wiring → 10.1 e2e → 11.1 app on Sepolia → 12.1 seed → 12.2 video → 12.4 submit.

Everything upstream of 4.1 can be built without ETH: Phases 1 (commit), 2, 3, 5, 6 (code), 7 are parallel and run against the local fork plus a nitro devnode for Stylus. ETH only gates the public-deploy half.

**Parallel lanes.**
- Lane A: Solidity contracts + tests (2.x) → Graduator (2.6).
- Lane B: Stylus crates + tests (3.x).
- Lane C: AI pipeline (5.x).
- Lane D: Server routes + indexer (6.x) against localnet.
- Lane E: Frontend (7.x) against localnet.
- User lane: 0.1–0.5.

## 15. Risks and red team

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | ETH never arrives before Oct 4 | Medium | Critical — no "deployed on Arbitrum" | Start 0.1 immediately; four sources in §12.1; everything else built in parallel so deploy is a 30-minute step once funded |
| R2 | "Everything by Oct 4" overruns | High | Broken demo | Ordered P0/P1/P2 list; cut from the bottom; freeze features 24 h before deadline for testing + video |
| R3 | Stylus can't run on anvil fork | Certain | Local integration tests of Stylus fail | Use `nitro-devnode` (Docker) for Stylus integration tests; anvil for Solidity-only tests; final integration on Sepolia |
| R4 | Uniswap v4 integration complexity (hooks, unlock callback, tick math) | Medium | Graduation slips | No hooks; single `unlock` callback; full-range position; fork-test on Arbitrum Sepolia early |
| R5 | Relayer front-runs or censors intents | Low | Trust | Intents carry minOut + deadline signed by the user; relayer can only submit or not; publish relay log |
| R6 | Wash-voting by moving coins | Medium | Canon capture | Snapshot via `ERC20Votes` checkpoints taken when the slot opens |
| R7 | Sniping at launch | Medium | Unfair distribution | 2% per-wallet cap for 10 min; creator gets vesting, not free float |
| R8 | Character drift despite refs | Medium | Weak demo | Sheet on neutral background, 3 poses; prompt pins character name + traits; reject-and-retry once on NSFW/failed |
| R9 | fal cost spike | Low | Real money | Daily cap; generation only after x402 settlement |
| R10 | Securities-like framing | Low (testnet) | Legal | No yield/revenue language; fees go to character wallets and treasury, not pro-rata to holders; testnet only |
| R11 | Tokenbound AccountV3 not in official docs for Arbitrum Sepolia | Low | TBA creation fails | Code verified present on-chain (§4); fork test before deploy |
| R12 | Judges have no USDC/ETH | High | Can't try it | Gasless intents; Circle faucet link; pre-funded read-only demo; video covers the full loop |
| R13 | Single SQLite instance / Railway pause | Low | Downtime during judging | Railway restart runbook; `/api/status` check before submission |
| R14 | Committing secrets while pushing the repo | Medium | Key leak | `.env*` gitignored (verified before push); `git secrets`-style grep for `0x` 64-hex before first push |

## 16. Execution order

1. **Now (U):** start getting Arbitrum Sepolia ETH (0.1); create Pimlico + Etherscan keys; claim Circle USDC; say "publish" for the repo.
2. **Now (C):** commit current work (1.1). Lanes A, B, C in parallel.
3. Lanes D and E against localnet + nitro devnode as soon as contract ABIs stabilise.
4. **On ETH arrival:** deploy Stylus → deploy Solidity → verify → wire addresses (Phase 4).
5. Live e2e on Sepolia (10.1), fix, browser run (10.2).
6. Paymaster (9.1) and graduation live (8.1).
7. Railway/Vercel on Sepolia (11.x).
8. Feature freeze no later than Oct 3; seed content, record video, README, push repo.
9. Submit (U) before the Oct 4 deadline.
10. After submission: P2 items for Founder House.

## 17. Remaining unknowns

- Exact Oct 4 deadline time and timezone on the submission page — user to confirm.
- Which track to enter (Promising Products vs Open Category).
- Whether the user narrates the demo video or wants a generated voiceover.
- Pimlico's current Arbitrum Sepolia sponsorship limits on the free plan.
- Whether organisers provide testnet ETH to registered builders.
