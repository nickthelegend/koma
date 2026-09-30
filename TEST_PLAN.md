# KOMA test plan

Every item has an exact pass condition. Every browser item also requires: no console errors and no failed network requests (4xx/5xx) other than the ones the item expects (for example the 402 quote).

Chain for on-chain items: Arbitrum Sepolia fork (chain id 421614) running the real Circle USDC contract, persisted with `anvil --state`. Public-testnet deploy is listed separately.

## A. Infrastructure

| ID | Item | Correct means |
| --- | --- | --- |
| A1 | Chain | `eth_chainId` = 421614; USDC at `0x75fa…AA4d` returns name `USD Coin`, version `2`, decimals 6. |
| A2 | Contract | `KomaIssues` deployed; server address holds `MINTER_ROLE`; `forge test` passes all tests. |
| A3 | Database | SQLite file `.data/koma.db` with `issues` and `jobs` tables; rows survive a server restart. No JSON-file storage left. |
| A4 | Public Arbitrum Sepolia deploy | Contract deployed and one paid issue minted on the public testnet. |
| A5 | No mock data | No sample comics, fake hashes, fake counters or stubbed controls anywhere in `src/`. |

## B. API

| ID | Item | Correct means |
| --- | --- | --- |
| B1 | `GET /api/status` | 200 `{ ready: true, network: "arbitrum-sepolia", caip: "eip155:421614", contract, payTo, facilitator }` with the deployed values. |
| B2 | Invalid orders | Each returns 400 with a specific `error` and no `PAYMENT-REQUIRED` header: prompt < 12 chars, prompt > 600, pages = 3, unknown style, 3 cast ids, unknown cast id, custom character without a look, bad genre, non-JSON body. |
| B3 | Quote | Valid order without payment → 402; `PAYMENT-REQUIRED` decodes to x402Version 2, scheme `exact`, network `eip155:421614`, asset USDC, `amount` = pages × 100000 (checked for 1, 2, 4, 6), payTo = configured, extra `{ name: "USD Coin", version: "2" }`. |
| B4 | Paid order (agent) | 202 `{ jobId }` + `PAYMENT-RESPONSE` with a tx hash; buyer USDC drops by exactly the price; payTo rises by exactly the price; job reaches `done`; `ownerOf(tokenId)` = buyer; `tokenOfPayment(paymentTx)` = tokenId; on-chain `contentHash` = DB `contentHash`. |
| B5 | Tampered price | Signature for a 1-page quote sent with a 6-page body → 402, no job row, balances unchanged. |
| B6 | Replay | Re-sending an already-settled `PAYMENT-SIGNATURE` → rejected, no new job, no second charge. |
| B7 | Payer without USDC | Signed payment from a 0-USDC wallet → 402, no job row. |
| B8 | Jobs lookup | Unknown id → 404; malformed id (`../x`) → 404. |
| B9 | `GET /api/comics` | Lists DB issues newest first without `pages`; `?owner=` returns only that owner's issues. |
| B10 | Token metadata | `/api/tokens/{id}` → name `Title · KOMA #id`, image URL that serves 200 `image/jpeg`, `external_url` to the issue; unknown id → 404; on-chain `tokenURI(id)` points at this route. |
| B11 | Art route | Valid file → 200 `image/jpeg`; traversal or unknown → 404. |
| B12 | Facilitator HTTP | `/supported` lists `{ x402Version: 2, scheme: "exact", network: "eip155:421614" }`; `/verify` returns `isValid: true` for a good payload and `false` for a bad signature; `/settle` returns `success: true` + tx hash and moves the USDC. |
| B13 | Unconfigured server | With `KOMA_CONTRACT` empty: `/api/status` `ready: false` listing it; `POST /api/comics` → 503 naming it; studio shows the offline banner. |
| B14 | Interrupted job | Server killed mid-drawing; after restart the job resumes on its own and ends `done` with a minted token (no job stuck mid-stage). |

## C. Product (Claude in Chrome)

| ID | Item | Correct means |
| --- | --- | --- |
| C1 | Catalog | Shows exactly the DB issues, newest first; spotlight = most-read issue using its own art and real counts; ticker shows real payments whose hashes exist on-chain. |
| C2 | Genre filter | `/?genre=X` shows only genre X; a genre with no issues shows the empty state whose CTA opens the studio with that genre preselected. |
| C3 | Empty database | With no issues: catalog shows a first-issue empty state (no spotlight, no ticker), receipts shows zeros and an empty-ledger message, no errors. |
| C4 | Search | Title/maker/genre query returns matching issues; no match → empty state with CTA; empty query → genre tiles. |
| C5 | Issue page | Title, logline, genre/style/pages, maker, real reads/remixes, token id; chain card values equal on-chain values; tx links open the transaction page; unknown id → 404. |
| C6 | Reader | Every page and panel renders with the DB's balloon text; page counter and progress track scroll; end card present; each visit adds exactly 1 read. |
| C7 | Transaction page | `/tx/{hash}` shows success, block, from/to and decoded events (USDC `Transfer` for payments, `IssueMinted` for mints); unknown hash → 404. |
| C8 | Form studio (`/create/form`) | Starters fill the prompt; style, cast, length and receipt total update; button disabled under 12 chars; designing a custom character adds it to the cast and it is used in the script; `?genre=` preselects genre; `?remix=` shows the remix banner. |
| C9 | Form payment | From `/create/form`: quote sheet shows the server's amount/payTo/network; connect shows the real USDC balance; sign → settled tx → writing → drawing (panels appear live) → lettering → minted; balance drops by the price; "Read it" opens the new issue; the URL stays on `/create/form?job=…`. |
| C10 | Signature rejected | Wallet rejects → sheet shows "Request cancelled in your wallet.", no job, no charge. |
| C11 | Not enough USDC | Wallet below the price → sheet shows balance and exact shortfall, no pay button. |
| C12 | No wallet | No provider → "No browser wallet found…" message. |
| C13 | Leave and return | Reloading `/create?job={id}` mid-generation resumes progress; shelf shows the in-progress issue. |
| C14 | Remix | Remix of a live issue completes; new issue shows "Remix of …"; on-chain `remixOf` = original token id; original's remix count +1. |
| C15 | Shelf | Disconnected → connect prompt; connected → only that wallet's issues and its in-progress jobs. |
| C16 | Receipts | Totals equal the sum of DB rows; each row links to its payment transaction page. |
| C17 | How page | Renders; `#x402`, `#contract`, `#facilitator` anchors exist; code samples use this server's URL. |
| C18 | Share | Dialog opens; Copy puts the absolute issue URL on the clipboard; X and Farcaster links carry the URL. |
| C19 | Mobile (375px) | Catalog, studio (action bar), pay sheet and reader fit with no horizontal scroll. |
| C20 | Console/network sweep | Every page above: zero console errors, zero unexpected failed requests. |

## D. Chat studio (`/create`)

| ID | Item | Correct means |
| --- | --- | --- |
| D1 | Greeting and starters | Fresh visit shows the editor greeting and 4 starters; composer placeholder "Tell the editor your idea…"; desktop aside shows the empty-pitch hint. |
| D2 | First pitch | Sending an idea shows the user bubble, a typing indicator, then an editor reply (≤ 3 sentences) and a pitch card whose fields pass order validation (title 2–28 chars, synopsis, genre, style, pages ∈ {1,2,4,6}, ≤ 2 leads, price = pages × 0.10). |
| D3 | Revision by chat | Asking for "1 page, noir, add a rival" updates the card: pages 1, style Noir, a second lead, price 0.10 USDC. |
| D4 | Revision by tap | Tapping 4 pages on the card changes the price to 0.40 USDC without a new editor turn. |
| D5 | Genre link | `/create?genre=Horror` greets for a horror comic and the first pitch's genre is Horror. |
| D6 | Pay from chat | Pay → 402 quote with the card's price → sign → steps and panels appear in the thread → done with the chat's title kept on the minted issue; balance drops by the price. |
| D7 | Reload mid-issue | Reloading `/create?job=…` during drawing restores the conversation and keeps showing live progress. |
| D8 | Fresh visit after an issue | Opening `/create` after a finished issue shows a new conversation, not the old one. |
| D9 | Start over | "Start over" clears the thread and the pitch. |
| D10 | Remix via chat | `/create?remix={id}` shows the remix banner and greeting; the paid issue is minted with `remixOf` = the original's token. |
| D11 | Editor errors | Empty message can't be sent; `/api/chat` with a bad body → 400; one visitor's 41st request in 10 minutes → 429; the 601st request in an hour across all visitors → 429 (global cap, so spoofed addresses can't run up the AI bill). |
| D12 | Phone | 390px: no horizontal scroll, pitch card inline in the thread, composer pinned to the bottom edge. |

## E. Deployment (live)

Live site: https://koma-arbitrum.vercel.app (Vercel front door) → Railway `web` (Next.js app, API, pipeline, SQLite + art on a volume) → Railway `chain` (private; persistent Arbitrum Sepolia fork, chain id 4216141, real Circle USDC contract). Heroku was the owner's first choice but its CLI isn't logged in; Railway is logged in on the same account.

| ID | Item | Correct means |
| --- | --- | --- |
| E1 | Backend on Railway | `/api/status` → ready, network `koma-localnet`, caip `eip155:4216141`, the deployed contract; the server reaches the chain only over the private network. |
| E2 | Frontend on Vercel | Every page served through https://koma-arbitrum.vercel.app renders with zero console errors and zero failed requests. |
| E3 | Public testnet | Contract on public Arbitrum Sepolia and one paid issue minted there. |
| E4 | Public RPC | `/api/rpc` answers standard reads and raw transactions; `anvil_*`, `evm_*`, `eth_sendTransaction`, `eth_accounts` and batches containing them are refused. |
| E5 | Faucet | Adds exactly 1 USDC per claim; 3rd claim for an address in a day → 429; bad address → 400; only on the localnet. |
| E6 | Live API | The full API harness (B2–B12) passes against the live URL. |
| E7 | Live browser flows | Chat pitch → pay → minted, form pay, reader, receipts, shelf and transaction pages all work on the live site. |
| E8 | Restart durability | After redeploying both Railway services, every issue, token and balance is still there. |

## F. Launchpad contracts and infrastructure

| ID | Item | Correct means |
|---|---|---|
| F1 | Solidity tests | `forge test` (unit + fuzz) passes every test for SeriesCoin, CharacterNFT, BondingCurve, Graduator, KomaSwapper, CanonRegistry, SeriesFactory, the reference math/router, and KomaIssues. |
| F2 | Fork tests | Against real Arbitrum Sepolia state: Character NFT creates a real Tokenbound account that its owner controls; launch → buy with real Circle USDC → complete → graduate into the real v4 PoolManager/PositionManager → swap both ways through KomaSwapper. |
| F3 | Stylus | `cargo test` passes for `curve-math` and `royalty-router`; both pass `cargo stylus check`; deployed and exercised on a real Nitro devnode; exported ABI identical to the spec interfaces. |
| F4 | Stylus = Solidity | Stylus and the Solidity reference return identical results for every generated test vector (curve quotes, spot price, router splits). |
| F5 | Local deployment | `DeployLaunchpad.s.sol` deploys the suite to the KOMA fork; addresses file written; server `/api/status` reports the launchpad; roles wired (relayer can launch/propose/finalize). |
| F6 | Public Arbitrum Sepolia | Stylus contracts deployed + activated, Solidity suite deployed with `engine: "stylus"`, sources verified, one real launch/trade/canon/graduation there. |
| F7 | Stylus gas benchmark | Measured gas for curve math via Stylus vs Solidity on a real node, recorded in `stylus/bench/results.json`. |
| F8 | Persistence | Launchpad index, series metadata, votes and launch jobs are SQLite tables that survive a server restart; the index rebuilds from chain events. |

## G. Launchpad API (`scripts/e2e-launchpad.mjs`)

| ID | Item | Correct means |
|---|---|---|
| G1 (L1) | Status | `/api/status` → `launchpad.addresses` for this chain, `engine`, `relayerEth`. |
| G2 (L2) | Invalid launches | Bad name / ticker / look / unknown parent → 400 with a specific error, no quote. |
| G3 (L3) | Launch quote | 402, 100000 (0.10 USDC), KOMA network and USDC. |
| G4 (L4) | Paid launch | Payer pays exactly 0.10; sheet drawn by fal and served; Character NFT owned by payer; ERC-6551 account has code; 1B supply split 950M curve / 50M vesting; demo target 25 USDC. |
| G5 (L5) | Gasless buy | Relayed buy delivers coins; buyer's ETH unchanged; 1% fee → exactly 70% character wallet / 30% treasury (no parent). |
| G6 (L6) | Slippage + tamper | Too-high min-out and a relayer-loosened min-out are refused; no USDC moves. |
| G7 (L7) | Gasless sell | Permit + signed intent; seller receives ≥ min-out USDC. |
| G8 (L8) | Proposals | Non-holder refused (403) before any USDC moves; ≥1M-coin holder pays, episode drawn with the character sheet, minted and proposed for episode 1; issue tagged with the series. |
| G9 (L9) | Votes + canon | Holder vote counted at snapshot weight; buyer after the snapshot and non-holder refused; after the window the keeper finalizes on chain with the published votes root. |
| G10 (L10) | Remix royalties | Remix series of a series: fee 50%+10% to the child's character wallet, 10% to the parent's. |
| G11 (L11) | Anti-snipe | One wallet buying > 2% of supply in the first 10 minutes is refused. |
| G12 (L12) | Graduation | Curve completes at 25 USDC (last buy clipped), keeper graduates into a v4 pool; a swap through KomaSwapper returns coins. |
| G13 | Paymaster proxy | Without `PIMLICO_API_KEY` → 503; with it, only `pm_getPaymasterStubData`/`pm_getPaymasterData` on this chain for KOMA contracts are forwarded. |

## H. Launchpad product (Claude in Chrome)

| ID | Item | Correct means |
|---|---|---|
| H1 | Series explorer | `/series` lists exactly the indexed series with sheet, ticker, price, market cap, raised/target, holders, episodes, DEMO/GRADUATED badges; sort tabs work; empty state when none. |
| H2 | Launch flow | `/launch`: validation messages; pay sheet shows 0.10 USDC; sign → progress (sheet → launching → done) with the sheet shown; lands on the new series page. |
| H3 | Series page | Header, character wallet + earnings, chart, price/market cap/raised equal on-chain `state()`; trades and royalties match the index. |
| H4 | Browser gasless buy | Quote updates with amount; sign one message (no ETH); tx confirmed; balances and trade list update. |
| H5 | Browser gasless sell | MAX fills balance; permit + intent signed; USDC returned. |
| H6 | Trade edge cases | Insufficient USDC shows the shortfall + faucet; disconnected shows connect; complete/graduated curve hides the curve widget and shows the pool. |
| H7 | Propose from the series page | "Propose episode N" → studio in episode mode with the series banner and balance → pay → proposal appears on the canon board with its cover. |
| H8 | Vote in browser | Vote signs one message; tally and "your vote" update; countdown runs; after close the canon timeline shows the winner. |
| H9 | Remix series | "Remix this series" → `/launch?parent=ID` shows "Remix of …"; launched remix links back to the parent and appears in its remixes. |
| H10 | Navigation | Top bar and phone tab bar include Series/Launch; home shows the series strip; `/how` explains the launchpad without investment language; issue pages of episodes show the series badge. |
| H11 | Phone (375px) | Explorer, launch, series page, trade widget and canon board fit with no horizontal scroll. |
| H12 | Console/network sweep | Every launchpad page: zero console errors, zero unexpected failed requests. |

## Results — 2026-09-29, full run 3 (after the chat studio)

Chain: Arbitrum Sepolia fork (chain 421614, real Circle USDC contract), persisted. Browser items in Claude in Chrome; items that need a visible, focused page (C6 scroll, C18 clipboard, C19/D12 phone) in headless Google Chrome via Playwright with real input. Wallets are fresh keys signing real EIP-712 authorizations through an injected EIP-1193 provider. Every item below was re-run after the last code change.

| ID | Result | Fix made in this run |
| --- | --- | --- |
| A1 | PASS | — |
| A2 | PASS | — |
| A3 | PASS | — (chain + DB intact after restarting both) |
| A4 / E3 | UNTESTED | Public-testnet gas: faucets need a captcha, a login or mainnet ETH. Server key waiting in `.env.testnet`. |
| A5 | PASS | — |
| B1–B12 | PASS | — (13 checks) |
| B13 | PASS | — (offline banner on both chat and form studios) |
| B14 | PASS | **FAIL first**: a restarted job rewrote its script (the title changed mid-flight) and redrew paid panels; a crash after the mint was sent left a paid issue marked failed. Now the script, seed and finished panels are kept on the job and recovery continues; minting adopts an existing on-chain mint when its content hash matches. Verified by killing mid-drawing (title kept, 3 finished files untouched) and by pausing the chain with the mint pending (token adopted, no double mint). The agent script also crashed on the outage; its polling now retries. |
| C1–C7 | PASS | — |
| C8 | PASS | — (form studio at `/create/form`) |
| C9 | PASS | **FAIL first**: paying from the form moved the URL to the chat page. Resume URL now stays on the page that paid. |
| C10–C12 | PASS | — |
| C13 | PASS | Same fix as C9. |
| C14–C20 | PASS | — (C20: 25 pages, 0 console errors, 0 failed requests) |
| D1–D4 | PASS | — |
| D5 | PASS | **FAIL first**: `?genre=` never reached the editor, and a leftover greeting-only draft overrode the genre greeting. The genre is now sent to the editor, and only drafts you wrote in (for the same genre) are restored. |
| D6 | PASS | — |
| D7 | PASS | **FAIL first**: reloading a remix issue's job URL lost the conversation (stored under the remix key). Paid chats are now also filed under their job id. |
| D8 | PASS | **FAIL first**: a finished conversation came back on the next visit. Now a fresh visit starts a new chat. |
| D9–D10 | PASS | — |
| D11 | PASS | **FAIL first**: the rate limit keyed on a client-controlled header. Now keyed on the proxy-appended address. |
| D12 | PASS | — |
| E1 | UNTESTED | Heroku CLI is not logged in (needs `heroku login`), and a Postgres add-on + dyno cost money: waiting on the owner. |
| E2 | UNTESTED | Depends on E1 (the Vercel site needs the Heroku backend). |

## Results — 2026-09-29, deployment run

| ID | Result | Notes / fixes |
| --- | --- | --- |
| E1 | PASS | Railway `web` + `chain`; `/api/status` ready on `koma-localnet` (eip155:4216141) with contract `0xB2b1…8396`; the server reaches the chain only via `chain.railway.internal` (the chain has no public domain). Heroku was replaced by Railway because the Heroku CLI isn't logged in. |
| E2 | PASS | 20 live pages through Vercel: 0 console errors, 0 failed requests; phone widths ≤ 390px on 9 pages. |
| E3 | UNTESTED | Still needs public-testnet gas (faucets require a captcha, a login or mainnet ETH). |
| E4 | PASS | Reads and raw transactions pass; `anvil_*`, `evm_*`, `debug_*`, `hardhat_*`, `eth_sendTransaction`, `eth_accounts` and poisoned batches refused. |
| E5 | PASS | +1.00 USDC per claim (verified on-chain), 3rd claim 429, bad address 400, 404 off the localnet; claimable from the pay sheet. |
| E6 | PASS | API harness 13/13 against https://koma-arbitrum.vercel.app (paid issue minted as token #1). |
| E7 | PASS | Live chat → faucet → pay → "Cloudburst" #2; live form → "Lunch Break Kaiju" #3; reader, receipts (3 / 0.30 / 3), shelf (exactly 2 for the wallet), tx pages with content-hash match. |
| E8 | PASS | Restarted `chain` and `web`: tokens, owners, balances, issues, art and read counts unchanged. (Railway paused full redeploys during the test window, so the check used service restarts.) |
| D11 | PASS | Re-verified with the global cap: 600 of 601 requests from 601 different addresses allowed, the 601st refused. |

Fixed during the deployment run:
- **Build**: SQLite opened at import time made parallel `next build` workers race ("database is locked") → the database now opens on first use. The x402 adapter contacted the facilitator at import → the paid handler is created on the first request.
- **Non-default network**: pricing now names the USDC asset and EIP-712 domain explicitly, and clients opt in to exactly KOMA's USDC with a 0.60 cap, so payments work on the localnet chain id.
- **Security**: a public chain RPC would expose anvil's cheat methods (unlimited free USDC) → filtered `/api/rpc` proxy; chain kept private.
- **Rate limits behind Vercel**: all visitors arrive from Vercel's servers → client address read from `x-vercel-forwarded-for`, plus global caps.
- **Harness**: network-agnostic (reads network, contract and pay-to from `/api/status`, checks jobs via the public API) and no longer crashes on a missing metadata image.

## Results — 2026-09-30, launchpad run

Local runs: KOMA fork (chain 421614, launchpad on the Solidity reference engine because anvil can't run WASM). Live runs: https://koma-arbitrum.vercel.app on the hosted localnet (chain 4216141). Browser checks used Claude in Chrome with an injected test wallet (the project's local test key, localhost only).

| ID | Result | Notes / fixes |
| --- | --- | --- |
| F1 | PASS | 126 tests pass (unit + 8 fuzz), 2 fork suites skipped offline. |
| F2 | PASS | 3/3 fork tests against real Arbitrum Sepolia: real Tokenbound account controlled by the NFT owner; launch → buy with Circle USDC → graduate into the real v4 PoolManager/PositionManager → swap both ways. |
| F3 | PASS | `cargo test` 15 + 19; `cargo stylus check` 9.9 KB / 12.2 KB; exported ABI identical to the spec; Nitro devnode router flow ALL PASS. |
| F4 | PASS | 10,192/10,192 outputs and 21/21 reverts (byte-identical revert data) match between Stylus and the Solidity reference. |
| F5 | PASS | Deployed to the local fork and to the hosted localnet (`deploy/addresses.4216141.json`); `/api/status` reports the launchpad; relayer can launch/propose/finalize. |
| F6 | BLOCKED | Arbitrum Sepolia server wallet `0x83dA…3A04` has 0 ETH. Stylus deploy script ready (`scripts/stylus-deploy.sh`). |
| F7 | PASS | Re-measured: route (3 ancestors) 131,802 gas Stylus-cached vs 132,890 Solidity; small pure math is cheaper in Solidity (25,992 vs 22,940 per cached `quoteBuy`). Reported as measured. |
| F8 | PASS | Wiped every derived `lp_*` table and the cursor; the index rebuilt from chain events to identical counts and sums, plus the pool swap indexed by the new code. |
| G1–G7 | PASS | Local and live. |
| G8 | PASS (local) | **FAIL first**: the proposal job finished before the index showed the proposal → jobs now wait for the index. Live: blocked by fal (see below). |
| G9 | PASS (local) | **FAIL first**: the keeper compared block times with the server clock (fork 22.7 h behind) and the fork only mined on transactions, so windows never closed → server logic uses chain time, forks mine every second (`--block-time 1` locally, `evm_setIntervalMining` from the server on the hosted chain). Finalized on chain within ~7 s of the window closing. |
| G10 | PASS (local) | Parent character wallet +0.002, child +0.012 on a 2 USDC buy. |
| G11 | PASS (local) | `SnipeCap`. |
| G12 | PASS (local) | **FAIL first**: the relayed buy that crosses the target ran out of gas (estimate too tight, 99.5% used) → relayer and launches add 30% gas headroom; the harness now fails on reverted receipts. Curve completed at exactly 25 USDC, keeper graduated into a v4 pool, gasless buy through the pool returned coins. |
| G13 | PARTIAL | Without `PIMLICO_API_KEY` → 503 as specified. Forwarding to Pimlico is UNTESTED: no key exists. |
| H1 | PASS | Explorer values equal on-chain `state()` (raised 2,225,848 → "$2.23 of $25"). |
| H2 | PASS | Browser launch "Moth Signal": 0.10 USDC quote → one signature → settled → sheet drawn → launched → link to the series. |
| H3 | PASS | **FAIL first**: relative times said "23h ago" (block time vs server clock) → computed against chain time. |
| H4 | PASS | One signature, no wallet transaction; 984,634.87 coins on chain = quote. |
| H5 | PASS | Permit + intent (two signatures), coins → 0, USDC back as quoted. |
| H6 | PASS | **FAIL first** (3): (a) a buy that overshoots the target asked for the full amount and demanded 407 more USDC → the wallet now signs only what the target needs; (b) graduated series had no way to trade → pool trading via the v4 Quoter + gasless `swapWithAuthorization`, sells as wallet transactions, pool swaps indexed; (c) graduated series said trades pay the 1% character fee → corrected copy. Faucet hint shows for a real shortfall. |
| H7 | PASS | "Propose episode 2" → form studio in episode mode → paid → "Cold Start" drawn with the character sheet (on model) → minted #23 → on the canon board. **FAIL first**: the job URL dropped `series`, so a reload lost the episode banner → kept in the URL. |
| H8 | PASS | Vote with one free signature, weight = balance at the snapshot (984.63K), countdown in chain time, keeper finalized, timeline shows the winner. **FAIL first**: the board didn't refresh when the tab became visible again → refreshes on visibility. |
| H9 | PARTIAL | `/launch?parent=1` shows "Remix of Rust Bucket Riot"; remix series + royalties verified via the API (G10) and listed on the parent page. A paid remix launch from the browser was not run (fal locked). |
| H10 | PASS | Nav (Series, Launch), home strip, `/how` launchpad section (no investment language), episode badge on issue pages. |
| H11 | PASS | 10 launchpad/studio pages at 375 px: scrollWidth 375, no overflow. |
| H12 | PASS | 22 local pages and 13 live pages: 0 console errors, 0 failed requests. |
| B2–B12 | PASS | 13/13 re-run after the AI/pipeline changes. **FAIL first** (B7): the launchpad harness had funded the shared "empty" wallet → non-holder checks now use a fresh wallet per run. |
| B14 | PASS | Re-run on an episode job: killed mid-drawing, resumed with the same title, finished panels untouched, minted #27 and proposed for episode 2. |
| D2, D6 | PASS | Chat editor on `openrouter/router` pitched "Moon Bowl"; paid from chat, minted #28 with the chat's title. |
| E1, E2 | PASS | New build live; launchpad deployed on the hosted chain; 13 live pages clean. |
| E3 / A4 | BLOCKED | Needs Arbitrum Sepolia ETH. |
| E6 (launchpad) | PARTIAL | Live G1–G8a PASS (launch, gasless buy with exact fee split, slippage/tamper refusal, gasless sell, non-holder refusal). G8 onward stopped: fal answered `User is locked. Reason: TOP_UP.` |

New gap found and fixed during the run: with fal locked, the site still quoted and took payments for jobs that could only fail. A cached fal health probe (a free, invalid request: a working account gets a validation error, a locked one 403) now makes `/api/comics` and `/api/series` answer 503 "No payment was taken" before quoting, and `/api/status` reports `ai`. Verified locally and live.

Open, needing the owner: Arbitrum Sepolia ETH (F6, E3/A4), a fal.ai top-up (live G8–G12, H9's browser remix launch), a Pimlico API key (G13 forwarding).
