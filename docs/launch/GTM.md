# KOMA — go-to-market plan (draft for review)

Nothing in this folder has been posted. Every number below comes from the running product or its tests; anything not yet true (mainnet addresses, user counts) is marked TODO.

## What KOMA is, in one line

**Describe a comic, get it drawn in a minute for 10¢ a page, and turn your hero into a character fans can back and write the canon for — on Arbitrum.**

Short version for bios: *AI comics you own. Characters fans write.*

## Who it's for

| Audience | What they get | Where they are |
|---|---|---|
| **Comic & manga creators, hobby writers** | A drawn, lettered issue from a paragraph; a character that stays on model across episodes; fees paid to the character's own wallet when people trade its coin | r/comicbooks, r/manga, webtoon/Tapas communities, X art & AI-art circles |
| **Arbitrum / onchain natives** | A launchpad where every coin is attached to a story and a character wallet, with gasless trades, holder-voted canon, Stylus contracts and Uniswap v4 graduation | Arbitrum Discord, X (#Arbitrum), Farcaster (/arbitrum, /base-builds style channels), Open House |
| **AI-agent and x402 builders** | A real x402 resource: any agent can pay USDC for a comic over HTTP 402, and KOMA runs its own Arbitrum facilitator | x402 builders, AI-agent Discords/Telegrams, GitHub |
| **Fans of a series** | Hold the coin, propose and vote on what happens next, remix it | Inside KOMA; shared issue pages and reader links |

## Positioning

- **Against "AI image apps":** KOMA makes whole issues — script, panels, lettering — and keeps the character consistent from episode to episode (FLUX.2 with the character sheet as reference).
- **Against memecoin launchpads:** every coin is attached to something people read. Holding it gets you a vote on canon, not a promise of returns. Fees pay the character's wallet and the remix tree, not holders.
- **Arbitrum-native, specifically:** curve math and the remix royalty router are Stylus (Rust→WASM) contracts; characters own ERC-6551 wallets; graduations seed locked Uniswap v4 pools; payments are x402 USDC settled by KOMA's own facilitator; trades are gasless.

## Business model (live in the code)

Comics 10¢/page (the hook) · series episodes 30¢/page · launch $1 · 1.5% curve fee split 40% character / 20% remix tree / 40% KOMA · 5% of the USDC raised at graduation · gasless relays from $3. Unit economics are in README → "How KOMA makes money".

## Launch sequence

**Before day 1 (gates — owner)**
1. fal.ai account topped up (generation is currently locked; the site refuses payments while it is).
2. Legal read on running bonding-curve coins with real money in your target countries; terms of use, a geo-restriction decision, and final risk copy. Until then, launch mainnet as invite-only or keep coins on testnet.
3. Mainnet deploy per `deploy/MAINNET.md`: Safe multisig as admin and treasury, funded deployer and relayer, `node scripts/mainnet-preflight.mjs` all green.
4. Seed content: 3–5 series launched by the team with real character sheets and at least one canon episode each, so the board isn't empty on day 1.

**Day 1**
- Open House submission (deadline Oct 4, 2026) with the demo video and repo.
- X thread + Farcaster cast + Arbitrum Discord post (copy in `announcements.md`).
- Pin a "make your first comic" link; every reply that asks "what is this" gets a link to a comic, not a pitch.

**Week 1**
- Daily: post one new canon episode from a seeded series with "vote on episode N" links (the canon loop is the retention hook).
- Creator challenge: "Launch a character in 5 lines" — showcase the best 10 sheets in a thread (no prizes in tokens; credits or features only, unless you decide otherwise).
- x402 angle: a short post + code snippet showing an agent buying a comic over HTTP 402 (`npm run buy`), aimed at agent builders.
- Collect: launches/day, issues/day, % 2+ page issues (margin), trades ≥ $3 vs < $3, canon votes per episode, D1/D7 return.

## Liquidity / incentives

- **No paid liquidity is needed to launch:** each curve is its own market, and graduation seeds a locked v4 pool from the curve's raise.
- **Optional, needs your approval and budget:** cover the first N launch fees ($1 each) for invited creators; sponsor gas for direct trades via Pimlico (needs an API key) for the first week. Don't run token giveaways or promise returns.

## Risks to manage in the messaging

- Never describe coins as investments, yield, or "early gains". Say what they do: votes on the story; fees go to characters and KOMA.
- Be explicit that curve prices go down as well as up, and that graduated pools lock liquidity forever.
- The canon tally is computed by KOMA's relayer from signed votes and committed on chain with a votes root; say "verifiable", not "trustless".
