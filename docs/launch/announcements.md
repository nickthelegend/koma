# Announcement drafts (not posted — for review)

Placeholders in `{{ }}` must be filled before posting. Links assume the live site at https://koma-arbitrum.vercel.app and the repo https://github.com/nickthelegend/koma.

---

## X / Twitter — launch thread

**1/**
Describe a comic. KOMA writes it, draws it and letters it in about a minute. 10¢ a page, paid in USDC, minted to you on Arbitrum.

Then turn your hero into a character fans can back — and let them vote on what happens next. 🧵
{{video or GIF: chat → panels drawing in → minted}}

**2/**
Every issue is a real script + 4 panels a page + live lettering, made by AI from your prompt. You pay with one signature (x402, no gas). Reading is free.
{{link to a good issue}}

**3/**
Launch a series for $1 and your character gets:
• a Character NFT with its own wallet (ERC-6551)
• a character sheet that keeps it on model in every episode
• a coin on a USDC curve — 40% of every trading fee goes to the character's wallet

**4/**
Holders write the canon. Hold 1M coins and you can propose the next episode (drawn with the character sheet). Holders vote for free with a signature. The winner is written on-chain; the rest become alternate universes.

**5/**
Remix any series and part of every fee flows back up the remix tree. When a curve hits its target it graduates into a locked Uniswap v4 pool.

**6/**
Built on @arbitrum:
• Stylus (Rust→WASM) curve math + royalty router
• gasless trades via signed intents
• x402 USDC payments through KOMA's own facilitator
Open source: github.com/nickthelegend/koma

**7/**
Coins are votes on a story, not an investment. Make a comic: {{link}}

---

## Farcaster — single cast

made an AI comic studio where you describe a story and it's drawn + lettered in ~a minute for 10¢/page (USDC, x402, no gas).

then you can launch the hero as a character with its own wallet, and holders vote on which episode becomes canon. stylus contracts on arbitrum, open source.

{{link to an issue}} · {{repo link}}

---

## Arbitrum Discord — #showcase (or builders channel)

**KOMA — AI comics + a series launchpad, built on Arbitrum**

- **What:** describe a story → AI script, panels and lettering in ~1 min → minted as an ERC-721. 10¢/page via x402 (USDC, no gas).
- **Launchpad:** each series = Character NFT with an ERC-6551 wallet + a coin on a USDC bonding curve. Gasless trades (signed EIP-3009/EIP-2612 intents relayed by KOMA from $3). 1.5% fee: 40% character wallet / 20% remix tree / 40% treasury.
- **Arbitrum tech:** curve math and the remix royalty router are Stylus contracts (Rust), differential-tested against Solidity on 10,192 vectors; graduation seeds a locked Uniswap v4 pool.
- **Canon:** ≥1M-coin holders propose episodes, holders vote with EIP-712 signatures at a snapshot, the keeper finalizes on chain with a votes root.
- Live: {{link}} · Repo: https://github.com/nickthelegend/koma · Contracts (Arbitrum Sepolia, verified): https://sepolia.arbiscan.io/address/0x91956C4C739619b2F5bb5835E23E928a215a8728 · Stylus curve math https://sepolia.arbiscan.io/address/0xc4bf7e0587a229ebea208d6d2f15b15faee730e9 {{swap for Arbiscan mainnet links after mainnet}}

Feedback on the Stylus side especially welcome — we measured Stylus slightly cheaper than Solidity for the cached router and more expensive for tiny pure math calls, and wrote both numbers down.

---

## Open House Singapore / HackQuest submission

**Project name:** KOMA
**One-liner:** AI comics you own, and characters fans write — a series launchpad on Arbitrum.
**Track:** {{Promising Products (AI agents / new financial primitives) or Open}}

**Problem.** Fan fiction and AI art are everywhere, but nobody owns a character, AI characters drift from panel to panel, and fans have no say in what's canon.

**What we built.**
1. An AI comic studio: chat or form → script, 4 panels/page, live lettering, minted to the payer. Paid with x402 (USDC, one signature, no gas) through KOMA's own Arbitrum facilitator, which any app can use.
2. A series launchpad: Character NFT + ERC-6551 wallet + Series Coin on a USDC bonding curve; gasless trades; 1.5% fee split to the character wallet, the remix tree and the treasury; holder-proposed, signature-voted canon; graduation into a locked Uniswap v4 pool.
3. Arbitrum Stylus: curve math and the remix royalty router in Rust, called by the Solidity curve, differential-tested against a Solidity reference on a Nitro devnode.

**Proof.** 159 Solidity unit/fuzz tests running real Circle USDC and Tokenbound bytecode, 5 fork tests against Arbitrum Sepolia (USDC, Tokenbound, Uniswap v4, character withdrawals, Safe admin), 36 Rust tests, a Stylus-vs-Solidity differential run on a Nitro devnode, a pre-mainnet security audit (`contracts/AUDIT.md`), and end-to-end API and browser test plans with results (`docs/TEST_PLAN.md`).

**Links.** Live: {{link}} · Repo: https://github.com/nickthelegend/koma · Video: {{link}} · Contracts (Arbitrum Sepolia, verified on Sourcify): SeriesFactory https://sepolia.arbiscan.io/address/0x91956C4C739619b2F5bb5835E23E928a215a8728 · Stylus curve math https://sepolia.arbiscan.io/address/0xc4bf7e0587a229ebea208d6d2f15b15faee730e9 · Stylus royalty router https://sepolia.arbiscan.io/address/0x658410eddf0eefaf97837d1e47e78693b87fadae · full list in `deploy/addresses.421614.json`

**What's next.** Mainnet with a Safe multisig admin, Stylus program caching, sponsored gas via Pimlico, on-chain vote verification.

---

## Demo video script (≈3 min)

1. (0:00) "Describe a comic." Type a one-line idea in the chat studio; the editor pitches it.
2. (0:20) Pay 10¢ — one signature, no gas. Panels draw in live; minted.
3. (0:50) Launch a series for $1: character sheet appears; Character NFT + wallet + coin in one transaction.
4. (1:20) Buy with no gas (one signature). Show the fee landing in the character's wallet.
5. (1:45) Propose an episode — same character, on model. Vote with a signature; canon finalized on chain.
6. (2:20) Graduation into Uniswap v4 (demo series).
7. (2:40) Stylus: show the contract, the differential test, the honest gas numbers. Close on the repo.
