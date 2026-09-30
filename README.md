# KOMA

AI comics you pay for with x402 and own on Arbitrum. Describe a story, pay a few cents of USDC with one wallet signature, and get a lettered, multi-page comic minted to your wallet. Reading is free.

## How it works

```
Studio / agent ──POST /api/comics──▶ 402 Payment Required (USDC quote, PAYMENT-REQUIRED header)
      │ sign EIP-3009 transferWithAuthorization (no gas)
      └──POST again + PAYMENT-SIGNATURE──▶ withX402 verifies ─▶ handler parks a job ─▶ 202 { jobId }
                                                    │
                           KOMA facilitator settles the USDC on Arbitrum (pays gas)
                                                    │ onAfterSettle
                 script (fal openrouter/router, Claude) ─▶ panels + cover (FLUX.2) ─▶ lettering ─▶ KomaIssues.mint(payer, contentHash, paymentTx)
```

- **x402**: official `@x402/*` v2 SDK. `/api/comics` uses `withX402` with a dynamic price ($0.10 per page). Settlement happens only when the handler returns < 400, so bad orders are never charged.
- **Facilitator**: KOMA runs its own, in-process (`src/lib/server/x402.ts`), and also exposes it at `/api/facilitator/{verify,settle,supported}` for other Arbitrum apps.
- **Contract**: `contracts/src/KomaIssues.sol`, an ERC-721 where each token stores the issue's content hash and the payment tx that bought it. One payment can mint only one issue. Remixes point at their original token.
- **Studio**: `/create` is a chat with an AI editor that shapes the idea into a pitch (title, story, genre, style, cast, pages, price); you pay from the pitch and the panels draw into the thread. `/create/form` is the same order as a plain form.
- **Lettering** is live HTML over the art, never baked into images, so it stays sharp and readable by screen readers.
- **Storage**: SQLite (`node:sqlite`, `.data/koma.db`) for issues and jobs; generated JPEGs in `.data/art/`. There is no sample data: the catalog is exactly what has been paid for and minted.
- **Recovery**: on start, `src/instrumentation.ts` resumes any paid job the server stopped mid-way. It continues from where it stopped (same script, panels already drawn are kept), finds a settlement the crash caught by its USDC authorization nonce, and adopts a mint that landed before the crash if its content hash matches, so a payment never mints twice.
- **Verification**: `/tx/{hash}` reads a transaction straight from the chain, decodes the USDC transfer or `IssueMinted`, and checks the on-chain content hash against the pages served.

## Run it locally (no real money)

Needs Node 22+ (for `node:sqlite`), Foundry, and a fal.ai key. The local chain is a pinned fork of Arbitrum Sepolia running the real Circle USDC contract; its state is saved to `.data/chain.json`.

1. `cp .env.example .env.local`, then set `FAL_KEY`, `NEXT_PUBLIC_ARBITRUM_RPC_URL=http://127.0.0.1:18611`, `KOMA_FORK_BLOCK=<a recent Arbitrum Sepolia block>`, and fresh keys (`cast wallet new`) for `SERVER_PRIVATE_KEY`/`SERVER_ADDRESS` and the `TEST_*_KEY`/`TEST_*_ADDRESS` wallets (browser, agent, empty, payto). Set `KOMA_PAY_TO` to the pay-to address. Don't use the public anvil accounts: on Arbitrum Sepolia they carry EIP-7702 delegations, and USDC rejects their signatures.
2. `npm run chain` (keep it running).
3. `sh scripts/local-setup.sh` deploys `KomaIssues`, writes `KOMA_CONTRACT`, and gives the test wallets forked USDC.
4. `npm run dev` and open http://localhost:4310.

Buy one from the command line like an agent would:

```bash
BUYER_KEY=$(grep ^TEST_AGENT_KEY= .env.local | cut -d= -f2) npm run buy -- "a vending machine that grants wishes, only to cats" 1 pop-art Comedy
```

## Launchpad: series, characters and canon

Every **series** is a character and a story that keeps going. Launching one (x402, $0.10) draws a **character sheet** with fal (FLUX.2) and, in one transaction, mints:

- a **Character NFT** (`CharacterNFT`, ERC-721) with its own **ERC-6551 wallet** (Tokenbound AccountV3), which earns trading fees;
- a **Series Coin** (`SeriesCoin`: ERC-20 + Permit + Votes with a timestamp clock and automatic self-delegation), 1B supply: 95% on the curve, 5% to the creator through a 30-day linear `VestingWallet`;
- a **USDC bonding curve** (`BondingCurve`, virtual constant product, ~$1K starting market cap). Every trade pays 1%: 50% to the character's wallet, 20% up the remix tree (half to the parent, a quarter to the grandparent…), 30% to the treasury. For the first 10 minutes one wallet can hold at most 2% of supply.

**Holders write the canon.** Anyone holding 1M coins (or the character's owner) proposes the next episode from the studio (`/create?series=ID`). It's drawn with the character sheet as a reference image (`fal-ai/flux-2/edit`), so the character stays on model, minted like any issue, and entered in `CanonRegistry`. Holders vote for free with an EIP-712 signature, weighted by their balance when the episode opened (`getPastVotes` at the snapshot). When the window closes, KOMA's keeper finalizes the winner on chain with a hash of every signed vote (published at `/api/canon/ID`). Losing proposals stay as alternate-universe issues.

**Graduation.** When a curve raises its target (5,000 USDC; demo series 25 USDC with 5-minute votes) the keeper calls `graduate()`: `Graduator` opens a USDC/coin **Uniswap v4** pool at the curve's final price, adds full-range liquidity and sends the position to a dead address. After that, `KomaSwapper` trades through the pool (gasless buys via the relayer; sells are wallet transactions).

**No gas for users.** Buys are one USDC `ReceiveWithAuthorization` signature whose nonce commits to the curve, amount, minimum out and deadline. Sells are a permit plus a signed intent. KOMA's relayer (the same server key as the x402 facilitator) submits them. The relayer can send an intent as signed or not at all; it can't change the terms. Wallets with ETH can also send trades themselves; `/api/paymaster` forwards ERC-7677 sponsorship requests to Pimlico when `PIMLICO_API_KEY` is set.

**Arbitrum Stylus.** The curve math (`stylus/curve-math`) and the remix royalty router (`stylus/royalty-router`) are Rust contracts compiled to WASM. The Solidity curve calls them through `ICurveMath` / `IRoyaltyRouter`. `CurveMathReference.sol` / `RoyaltyRouterReference.sol` implement the same interfaces and are differential-tested against Stylus: 10,192/10,192 outputs and all 21 reverts (byte-identical revert data) match on a Nitro devnode. Measured gas (`stylus/bench/results.json`): the router's `route` with a 3-level remix tree costs 131,802 gas cached vs 132,890 in Solidity; for tiny pure math calls, Stylus's per-call entry cost makes it more expensive than Solidity (e.g. 25,992 vs 22,940 gas for one cached `quoteBuy`). Anvil can't run WASM, so local and hosted forks use the Solidity reference (`/api/status` reports `engine`); on Arbitrum Sepolia the Stylus contracts are the engine.

```
SeriesFactory ─┬─ CharacterNFT ── ERC-6551 account (earns fees)
               ├─ SeriesCoin (95% → curve, 5% → VestingWallet)
               └─ BondingCurve ─┬─ ICurveMath  (Stylus curve-math)
                                ├─ IRoyaltyRouter (Stylus royalty-router) → character / ancestors / treasury
                                └─ Graduator → Uniswap v4 PoolManager + PositionManager → KomaSwapper
CanonRegistry ← relayer: propose (after paid episode mints) / finalize (keeper, votes root)
```

Hosted localnet (chain 4216141) addresses, from `deploy/addresses.4216141.json`: SeriesFactory `0xE5C6A7839D10eDd39412aEC8987AbD3377DBA6A0`, CharacterNFT `0xb434fCdd5BeCc4963a1BCC15b161E87241Cc1Dee`, CanonRegistry `0xAc262Ab61e20A655f1a2De40eba874D321B0fa52`, Graduator `0xfD082F761DD73f54a5Fc6fE772DaBb815f5c6bCc`, KomaSwapper `0x3C5f05ed505d18655d5e9B03555dBF552833ef64`.

| Route | What it does |
| --- | --- |
| `POST /api/series` | `{ name, symbol, characterName, characterPrompt, pitch, genre?, parentSeriesId?, demo? }`. 402 quote ($0.10), then 202 `{ jobId }`; poll `GET /api/launches/:id` (`sheet → launching → done`). |
| `GET /api/series`, `GET /api/series/:id` | Indexed series: price, market cap, raised/target, holders, trades, chart, royalties, remixes, pool. |
| `POST /api/trade/relay` | Signed gasless `buy`, `sell` or post-graduation `swap-buy`; returns the tx hash. |
| `GET /api/canon/:series` | Open episode, proposals with tallies, canon so far, alternates, every signed vote. |
| `POST /api/canon/:series/vote` | `{ episode, issueId, voter, signature }` → counted at the snapshot weight. |
| `POST /api/series/:id/graduate` | Graduates a complete curve (the keeper also does it). |
| `GET /api/characters/:id` | Character NFT metadata (`tokenURI`). |
| `POST /api/paymaster` | ERC-7677 proxy to Pimlico for EIP-5792 wallets (needs `PIMLICO_API_KEY`). |

Deploy: `stylus/README.md` and `scripts/stylus-deploy.sh` (Stylus), then `contracts/script/DeployLaunchpad.s.sol` with `MATH`/`ROUTER` set to the Stylus addresses (unset on anvil forks, which get the Solidity reference). The server reads `deploy/addresses.<chainId>.json` (or `KOMA_LAUNCHPAD_ADDRESSES`). The indexer and keeper start with the server (`src/instrumentation.ts`).

## Live deployment

**https://koma-arbitrum.vercel.app**

```
browser ──▶ Vercel (koma-arbitrum, rewrites everything) ──▶ Railway "web" (this repo's Dockerfile; SQLite + art on a volume at /data)
                                                                 │ private network
                                                                 ▼
                                                   Railway "chain" (anvil: persistent fork of Arbitrum Sepolia,
                                                   chain id 4216141, real Circle USDC contract, state on a volume)
```

- **KOMA Localnet**: `NEXT_PUBLIC_KOMA_NETWORK=koma-localnet`. Its own chain id keeps wallets from mixing it up with the public testnet. Wallets add it automatically on first payment (RPC `https://koma-arbitrum.vercel.app/api/rpc`).
- **Public RPC** `/api/rpc` forwards standard reads and signed raw transactions only; node-admin and cheat methods never leave the server.
- **Test USDC**: the pay sheet's "Get 1 test USDC" button (`POST /api/faucet`), localnet only, limited per address, per IP and per day.
- **Cost guards**: chat is capped per visitor and globally (`KOMA_CHAT_PER_HOUR`); the faucet's daily cap (`KOMA_FAUCET_PER_DAY`) bounds how many comics can be generated per day.
- **Contract**: `KomaIssues` at `0xB2b1A0E0c4692B792e5E7Db6443EEc0A77658396` on KOMA Localnet.
- Redeploy the web service with `railway up --service web` from this folder; the Vercel proxy lives in `deploy/vercel`. Server keys are in `.env.production.local` (gitignored, localnet-only).

## Run it on Arbitrum Sepolia

1. Make a fresh server key (`cast wallet new`) and send it a little Arbitrum Sepolia ETH. It pays facilitator gas and mints.
2. Deploy: `DEPLOYER_PRIVATE_KEY=<key> KOMA_BASE_URI=https://<your-host>/api/tokens/ npm run contracts:deploy`
3. Set `.env.local`: `SERVER_PRIVATE_KEY`, `KOMA_CONTRACT`, `FAL_KEY`, `KOMA_PUBLIC_URL`. Leave the RPC blank for the public one.
4. Buyers get free test USDC at [faucet.circle.com](https://faucet.circle.com).

For mainnet, set `NEXT_PUBLIC_KOMA_NETWORK=arbitrum-one` and deploy with `RPC_URL=arbitrum`.

## API

| Route | What it does |
| --- | --- |
| `POST /api/comics` | `{ prompt, pages: 1\|2\|4\|6, style?, genre?, cast?, custom?: [{ name, look }], remixOf? }`. 402 quote, then 202 `{ jobId }` once paid. |
| `POST /api/chat` | `{ messages: [{ role, content }], pitch?, remixOf? }` → `{ reply, pitch }`. The studio's AI editor; every pitch is already a valid order. |
| `POST /api/comics/quote` | Same body; returns the identical `PAYMENT-REQUIRED` header with a 200 (what the studio uses). |
| `GET /api/jobs?payer=0x…` | That wallet's paid issues still being made. |
| `GET /api/jobs/:id` | Progress: `settling → writing → drawing → lettering → minting → done` (or `error` with `failedAt`). |
| `GET /api/comics?owner=0x…` | Live issues, optionally by owner. |
| `GET /api/tokens/:tokenId` | ERC-721 metadata for `tokenURI`. |
| `GET /api/status` | Whether the server is configured, for which chain, the launchpad addresses and engine, relayer balance and today's fal spend. |
| `/api/facilitator/*` | Standard x402 facilitator endpoints for Arbitrum. |

Styles: `neon-anime`, `pop-art`, `noir`, `superhero`, `gothic`, `retro-sf`. Cast ids are in `src/data/seed.ts`.

## Tests

```bash
npm run contracts:test        # Foundry: 126 unit + fuzz tests (issues + launchpad)
(cd contracts && FORK_TESTS=1 forge test --match-path "test/fork/*")   # real Arbitrum Sepolia USDC, Tokenbound, Uniswap v4
(cd stylus && cargo test && ./devnode.sh start && ./integration/run.sh) # Stylus unit + Nitro devnode differential tests
node scripts/e2e-api.mjs      # API + x402 + on-chain checks against the running server (B2–B12 in TEST_PLAN.md)
node scripts/e2e-launchpad.mjs # launch → gasless trades → propose → vote → canon → remix royalties → graduation (G1–G12)
npx tsc --noEmit && npm run lint
```

`TEST_PLAN.md` lists every checked behaviour and its result.

## Known limits

- If generation fails for good after the payment settles, the job ends in `error` with the payment tx shown. There are no automatic refunds yet.
- SQLite and local art files mean one server instance (point `KOMA_DATA_DIR` at a persistent volume).
- The pipeline runs in the server process after settlement; use a long-running Node host (`npm start`), not serverless functions.
- fal spend is capped per UTC day (`KOMA_FAL_DAILY_USD`, default 15); over the cap, new launches and issues answer 503 before any payment.
- Canon tallies are computed by KOMA's relayer from signed votes; the on-chain record commits to them with a votes root, and the full vote list is public, so anyone can recheck a result. Verifying signatures on chain is future work.
