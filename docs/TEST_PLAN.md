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

## I. Added 2026-10-01 (home, launchpad board, pricing, mainnet prep)

| ID | Item | Correct means |
|---|---|---|
| I1 | Home cover hero | `/` opens on the comic-cover hero: price box showing the configured page price (10¢), "No. N" equal to the number of minted issues, the most-read (or latest) issue's opening panel as art with a credit line naming it, headline, "Make a comic" → `/create`, "Launch a series" → `/launch`, three cover lines linking to `/launch` and `/series`; fits one screen at 1440×900; no overlap or horizontal scroll at 375px. |
| I2 | Launchpad board header | `/series` features the series closest to graduation (raised/target and % equal to the index), with Trade / Read canon links; the live tape lists real indexed events (launch, buy, sell, graduation, canon) newest first. |
| I3 | Board tabs and search | `?tab=new|graduating|graduated` and `?q=` filter exactly; counts on the tabs equal the filtered lists; unknown query shows an empty state with a launch CTA. |
| I4 | Series without art | A series launched without a character sheet renders a typographic plate (no broken image, no fake art). |
| I5 | Built on Arbitrum panel | On `/launch` and `/s/[id]` it names the engine actually deployed (`/api/status` → `launchpad.engine`) and shows the real curve-math, royalty-router, Character NFT and ERC-6551 registry addresses. |
| I6 | Character earnings withdrawal | The Character NFT owner sees the character account's USDC balance and "Withdraw to my wallet"; clicking sends one wallet transaction that moves exactly that balance to the owner; non-owners see no button. |
| I7 | Pricing shown | Launch page and its pay button say $1 / 1.00 USDC; studio in episode mode prices pages at 30¢; normal studio at 10¢; series page states the 1.5% fee split 40/20/40 and the 5% graduation fee. |
| I8 | $3 gasless floor (UI) | A $2 buy shows "Gasless from $3" (disabled) and the wallet route; a $3 buy goes through with one signature. |
| I9 | fal unavailable | While fal is locked, `/api/status` → `ai.ok: false`, every quote (comic, episode, launch) answers 503 "No payment was taken", and the studio/launch sheets show that message — no USDC moves. |
| I10 | Mainnet preflight | `node scripts/mainnet-preflight.mjs` against the local deployment exits non-zero and flags exactly the non-mainnet settings (engine, EOA admin/treasury, relayer admin, fal). |
| I11 | Fee economics on chain | `.data/econ-check.mjs` 5/5: 1.5% fee split 40/20/40, remix split, $3 relay floor, 5% graduation fee, a gasless buy through the Graduator-hooked v4 pool. |
| I12 | Canon voting on chain (no fal) | With an existing minted issue proposed by the relayer, a holder votes from the browser with one free signature at snapshot weight, the countdown follows chain time, and the keeper finalizes it on chain when the window closes; the canon timeline shows it. |

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

## Results — 2026-10-01, pricing and fee economics run

New economics (owner's choice, "keep the 10¢ hook"): comics 10¢/page, series episodes 30¢/page, launch $1, curve fee 1.5% split 40% character / 20% remix tree / 40% KOMA, 5% of the USDC raised to KOMA at graduation, KOMA relays trades gaslessly from $3.

| Check | Result | Notes |
| --- | --- | --- |
| Solidity | PASS | 132 unit + fuzz (new: 40/20/40 split with 0–10 ancestors, graduation fee fuzz across every allowed target, Solidity router replays all 2,002 Stylus vectors). Fork suite 3/3 against real Arbitrum Sepolia. |
| Stylus | PASS | `cargo test` 34/34; devnode: Stylus = Solidity on 10,192/10,192 curve outputs and 21/21 reverts; router flow ALL PASS with the new split (425,000 / 100,000 / 50,000 / 25,000 / 400,000). |
| Fee split on chain | PASS | $10 gasless buy: character +0.09, treasury +0.06 (1.5%, no parent). Remix: parent +0.015, child +0.075, treasury +0.06. |
| Graduation fee | PASS | Demo curve at 25 USDC: `GraduationFee` 1.25 to the treasury, `PoolCreated` 23.75 USDC, graduated by the keeper. |
| $3 relay floor | PASS | Relayer refuses a $2 gasless buy and sells worth < $3 ("Gasless trades start at $3"), nothing moves; the widget shows "Gasless from $3" and offers the wallet path; a $3 buy from the browser goes through with one signature. |
| UI copy | PASS | Launch page: $1, 1.5% split 40/20/40, 5% graduation fee; series page fee text and "where the fees went" use the same constants; studio receipts price episodes at 30¢/page. |
| Episode / launch quotes over x402 | UNTESTED | fal is locked (`TOP_UP`), and the server correctly refuses to quote while it is. Needs a fal top-up. |

**FAIL first**, fixed during the run:
- **Target cap.** The maximum graduation target (19,000 USDC) sold every curve coin, so graduation reverted and the USDC was stranded. The curve now keeps at least 10M coins unsold, which caps targets at 15,666 USDC.
- **Stale index after a redeploy.** A new launchpad deployment restarts series ids at 1, so the new series collided with the previous deployment's rows and the relayer answered "Unknown curve". The index now tracks which deployment it follows; when the factory changes it clears the old deployment's rows and rewinds the cursor to the deploy block.

## Results — 2026-10-01, pre-mainnet audit and hardening

Full findings: `contracts/AUDIT.md`. Runbook: `deploy/MAINNET.md`. Cost: `deploy/mainnet-cost.json`.

| Check | Result | Notes |
| --- | --- | --- |
| Audit | DONE | H-1 pool squatting could block graduation forever → Graduator is the pool hook (only it can create series pools). M-1 a USDC-blacklisted recipient froze trading → fees/treasury payouts are parked and flushable. M-2 deploy defaults → mainnet guards (Stylus engine, Safe admin, keystore signer, deployer renounces). M-3 Stylus program expiry → monitoring + deferred routing. L-1…L-4 fixed. Fee is a compile-time 150 bps constant; treasury set once; withdrawals proven by fork test. |
| No mocks | PASS | Unit tests etch the real Circle USDC (proxy + FiatTokenV2_2) and real Tokenbound (registry, proxy, AccountV3 + dependencies) from Arbitrum One. `grep -r Mock contracts/` is empty. |
| Solidity / fork / Stylus | PASS | 159 unit+fuzz, 5 fork tests (Arbitrum Sepolia: USDC, Tokenbound, Uniswap v4, character withdrawal, Safe as admin/treasury), 36 `cargo test`, Nitro devnode differential ALL PASS. |
| Hardened contracts in the app | PASS | Local redeploy; app ABIs match artifacts (functions, events, errors); economics check 5/5 incl. a gasless buy through a Graduator-hooked v4 pool priced by the v4 Quoter. |
| Character earnings withdrawal (browser) | PASS | Owner clicked "Withdraw to my wallet": character account 0.132 → 0 USDC, owner +0.132 exactly, one wallet transaction; non-owner `execute` reverts (`NotAuthorized`). |
| Launchpad UI | PASS | Board, series and launch pages at 1440 and 375 px, no console errors, mainnet-aware copy. |
| Mainnet preflight script | PASS | `scripts/mainnet-preflight.mjs` against the local deployment flags exactly the non-mainnet settings (Solidity engine, EOA admin/treasury, relayer admin, fal locked). |
| Mainnet deploy | NOT STARTED (gated) | No deployer configured; owner must fund (see deploy/MAINNET.md §2–3). |

## Results — 2026-10-01, full run 4 (every item, current code)

Browser: the app's built-in Chromium (Claude in Chrome was disconnected after a machine restart), real pages on the local fork, an injected test wallet (the project's local test key, localhost only). **fal.ai is locked (`User is locked. Reason: TOP_UP.`)**, so every item that needs AI generation is UNTESTED — not passed.

| ID | Result | Notes |
|---|---|---|
| A1, A2, A3, A5 | PASS | Chain + Circle USDC; 159 unit + 5 fork + 36 Rust tests; SQLite persisted across restarts; `grep -r Mock` empty. |
| A4 | BLOCKED | Public Arbitrum Sepolia deploy needs testnet ETH. |
| B1, B2, B8, B9, B11, B12, B13 | PASS | **FAIL first** (harness): the API suite crashed when quotes were refused (fal down) → fal-dependent checks now report UNTESTED; B12 built its requirements from a studio quote → now builds them from `/api/status`, so the facilitator is tested on its own (real settlement). B13 run on a production build with no env: status lists the 3 missing settings, comics/series POST → 503 naming them, one "studio is offline" banner, paying disabled. |
| B15 (new) | PASS | fal unavailable → quote 503 "No payment was taken", no PAYMENT-REQUIRED. |
| B3, B4, B5, B6, B7, B10, B14 | UNTESTED | Need a quote/paid generation (fal). |
| C1–C7, C15–C20 | PASS | Rack = 29 DB issues newest first; genre filter exact (12 Sci-fi); search + empty state; issue page hash/payment = on-chain; reader +1 read exactly; tx pages decode USDC transfer / IssueMinted with hash match, unknown → 404; shelf = the wallet's 12 issues exactly; receipts totals = DB (29 / 3.50); `/how` anchors; share: real click → "Copied", X/Farcaster links carry the URL; 32 pages fit 375px; 32 pages 0 console errors / 0 failed requests. C3 on a production build with an empty data dir: "No. 0", no art, no ticker, no series strip, "Issue #1 is yours", receipts zeros. |
| C8 | PASS (without paying) | Genre preselect, starters fill the prompt, style/length update the receipt (4 × $0.10 = $0.40), cast toggles ("1 character"), custom character added, remix banner. Paying is fal-gated. |
| C12 | PASS | No provider → "No browser wallet found. Install MetaMask, Rabby or Coinbase Wallet." |
| C9, C10, C11, C13, C14 | UNTESTED | Need a quote/paid generation (fal). |
| D1 | PASS (fal-down variant) | Greeting and starters render; composer and starters disabled with "The editor is offline right now". |
| D11 | PASS | Empty message 400; 41st request from one visitor 429; global hourly cap → "The editor is swamped". |
| D12 | PASS | Layout fits 375px. |
| D2–D10 | UNTESTED | The editor itself is fal. |
| E1, E4 | PASS | Live, read-only: ready on 4216141 with the launchpad, payments refused while fal is down; `/api/rpc` refuses anvil_/evm_/debug_/eth_sendTransaction/eth_accounts, also inside batches. |
| E2 | PARTIAL | Live pages answer 200; live console not re-swept this run. The live site serves the build before today's audit (not redeployed, per instruction). |
| E3 | BLOCKED | Testnet ETH. |
| E5, E6, E8 | NOT RE-RUN | Live site not redeployed (instruction: don't deploy). Last PASS 2026-09-29. |
| E7 | UNTESTED | fal. |
| F1–F5, F7, F8 | PASS | Re-run today (unit, fork, cargo, devnode differential by the audit run, deploy, bench, index rebuild + deployment reset). |
| F6 | BLOCKED | Testnet ETH. |
| G1, G2, G5, G6, G7, G9, G10, G11, G12 | PASS | `npm run check:economics` 9/9 on the hardened contracts (fee 40/20/40, remix split, $3 floor, 5% graduation fee, hooked-pool trade, slippage + tamper refusal, gasless sell, anti-snipe, canon proposal); G9 voted from the browser and finalized by the keeper on chain. |
| G3, G4, G8 | UNTESTED | Launch / episode generation need fal. |
| G13 | PARTIAL | 503 without a key verified; forwarding to Pimlico untested (no API key exists). |
| H1, H3, H4, H5, H6, H8, H10, H11, H12 | PASS | Board vs index; series page = on-chain `state()` ($4.90 of $25, $0.0₅101, $1.01K); browser buy (1 signature) and sell (2 signatures, MAX $5.82); $3 floor; graduated pool trading; vote + keeper finalize; nav; phone; console. |
| H2, H7 | UNTESTED | Launch / propose from the studio need fal. |
| H9 | PARTIAL | "Remix of …" banner and remix royalties on chain verified; a paid remix launch from the browser needs fal. |
| I1–I12 | PASS | Cover hero vs data (No. 29 = 29 issues, 10¢, most-read art + credit); board featured/tape; tabs + search exact; no-art plates; Built-on-Arbitrum panel names the real engine and addresses; withdrawal (owner: 0.176543 USDC moved, Transfer event; non-owner: no button); prices ($1 launch, 30¢/10¢ pages, 1.5% split, 5% graduation fee); $3 floor; fal-down guard; mainnet preflight; economics; canon vote. |

**FAIL first, fixed this run:**
- The studios only learned fal was down after a quote request returned 503, which logs a failed request. They now read `/api/status` and show "The AI artist is offline" with paying, the chat composer and the starters disabled; no quote request is sent at all (verified: 0 quote requests on 4 pages).
- On an unconfigured server both the "studio offline" and "AI offline" banners appeared; the AI banner now shows only on a configured server.
- API harness: fal-dependent checks report UNTESTED instead of crashing; the facilitator check no longer depends on a studio quote.
- Repo: `npm run art` pointed at a script that doesn't exist (removed); the economics check moved into `scripts/check-economics.mjs` with npm scripts for every suite; CI workflow added and its web job verified on a clean copy (`npm ci`, typecheck, lint, production build).

**Totals (104 planned items):** 68 PASS (+ the new B15), 3 PARTIAL, 27 UNTESTED (fal locked), 3 BLOCKED (testnet ETH), 3 NOT RE-RUN (live not redeployed). No mocks or stubs in app or contract code; 0 console errors and 0 failed requests on every page tested.

## Results — 2026-10-02, public Arbitrum Sepolia deployment

| ID | Result | Notes |
|---|---|---|
| F6 | PASS | Stylus `curve-math` `0xc4bf7e0587a229ebea208d6d2f15b15faee730e9` and `royalty-router` `0x658410eddf0eefaf97837d1e47e78693b87fadae` deployed and activated (ArbWasm program version 3), router initialized with Circle USDC; Solidity suite deployed with `engine: stylus` (`deploy/addresses.421614.json`); router `setFactory` sent; all six Solidity contracts verified on Sourcify (exact match). Cost: 0.00123 ETH of the 0.01 sent. |
| A4 | PASS (deploy) | Launchpad + KomaIssues on public Arbitrum Sepolia. Pilot series #1 launched on chain (tx `0xd15ef2333cbcd440c48a7452286f746e06381b9df88313eda4539394628a4f88`, 5.38M gas): the factory registered it in the Stylus router (`curveOf(1)` = its curve) and the curve quotes through the Stylus math ($10 → 9,753,923 coins after the 1.5% fee). |
| E3 | PARTIAL | A paid issue minted on the public testnet still needs fal (locked) and test USDC from faucet.circle.com. |

**FAIL first, fixed:**
- **Deploy script vs. Stylus.** Foundry's EVM can't execute Stylus (WASM) programs, so `DeployLaunchpad.s.sol` reverted (`OpcodeNotFound`) when it called the router during simulation. On the Stylus path the script now makes no calls into the programs and prints the exact `cast send` wiring commands (`setFactory`, then `transferOwnership` to ADMIN on mainnet). Unit (159) and fork (5) tests still pass.
- **Stylus deploy gas.** `cargo stylus deploy` underpriced gas as the base fee rose; `scripts/stylus-deploy.sh` now passes `--max-fee-per-gas-gwei` at 2× the current price (Arbitrum charges only the base fee).
- **RPC choice.** The public `sepolia-rollup.arbitrum.io` RPC refuses Stylus activation simulation ("stylus activations not allowed for this request"); publicnode works, noted in the runbook.

## Results — 2026-10-03, run 5 (browser audit on the local fork, signatures only)

Production build (`next build` + `next start`) against the persisted Arbitrum Sepolia fork. Browser items in Claude in Chrome with a test wallet injected as an EIP-1193 provider (it signs; nothing spends real or public-testnet ETH). fal is still locked (`TOP_UP`), so every flow that draws is UNTESTED and was checked to refuse before any payment.

| Area | Result | Notes |
|---|---|---|
| H4 gasless buy | PASS | $5 buy: one signature, one relay request even on a double-click, USDC −5.00 exactly, stats/chart/trades refresh on their own. |
| H5 gasless sell | PASS | Max sell: permit + intent, USDC +7.76 = the quote; tx page decodes fee → router → character / treasury and the payout. |
| C10 / trade rejection | PASS | Wallet rejection shows "Request cancelled in your wallet." and nothing is sent. |
| H8 vote in browser | PASS | One free signature at snapshot weight (2.92M), tally + "Your vote" update and survive reload; the keeper finalized on chain when the window closed (`canonOf(15,1) = 27`), canon timeline shows it. |
| I6 character withdrawal | PASS | Owner withdraws $0.18; wallet shows $0, owner balance +0.18. |
| E5/H6 graduated pool | PASS | Gasless $3 swap-buy through the Graduator-hooked v4 pool; sell into the pool from the wallet (approve + swap), USDC +7.53 = the quote. |
| I9 fal down | PASS | Chat composer disabled, form and launch pay buttons disabled with the reason next to them, quotes 503 "No payment was taken". |
| API edge cases | PASS | 25 malformed requests (non-JSON, unknown kinds, garbage intents, unknown ids, admin RPC methods, no faucet, no paymaster key) all answer with a specific error. |
| Harnesses | PASS | `test:api` 6/6 (4 need fal), `test:launchpad` 3/3 (L4–L12 need fal), `check:economics` 9/9, eslint clean, `tsc` clean. |
| C20/H12 sweep | PASS | 106 page loads (53 routes × desktop 1440 and phone 375): 0 console errors, 0 failed requests, 0 horizontal overflow, 0 broken images. The only 404s are the deliberate not-found pages. |

**FAIL first, fixed in this run:**
- Selling more coins than you hold quoted an impossible payout ($501 from a curve holding $12.78). The widget now says how many you hold instead of quoting.
- The header and pay sheet showed "0.00 USDC" until the balance loaded (and the trade widget could flash "not enough USDC"); balances now show "…" until read.
- Character earnings disagreed ($0.29 in the header, $0.28 in "Where the fees went"): royalties from remixes are now listed under the breakdown.
- `/how` and the "Built on Arbitrum" panel contradicted themselves about which engine runs on Arbitrum Sepolia; both now describe "this deployment" vs "KOMA's public deployments".
- A canon episode decided with no votes read "0 of 0 votes"; the empty canon text claimed "the first vote decides". Both now say what actually happens.
- Issue pages always said "Episode proposal", even after the vote; they now show canon / voting / alternate universe from the index (and catch issues proposed on chain without a series tag).
- Disabled pay buttons (launch, studio, phone bar) gave no reason while fal was down; they now say drawing is paused and no payment will be taken.
- Episode banner showed an empty box for a series without a character sheet; it now shows a ticker plate.
- Pool panel labelled graduation-time amounts as live reserves; relabelled "seeded at graduation".
- `scripts/chain.sh`: a kill during anvil's periodic state save truncated `.data/chain.json`. The script now keeps the last good copy and restores it.
- Harnesses: `check-economics` E9 reused an already-proposed issue and made tickers with spaces; `e2e-launchpad` crashed when fal was down instead of reporting UNTESTED.
