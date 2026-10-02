# Publish checklist (nothing has been posted)

| Item | Status | What it needs before publishing |
|---|---|---|
| GTM plan (`GTM.md`) | Ready for your review | Your call on target countries, invite-only vs open mainnet, and any launch-fee or gas sponsorship budget |
| X thread | Needs your edit | Video/GIF, a link to a strong issue, the live link; confirm handles (@arbitrum) |
| Farcaster cast | Needs your edit | Issue link |
| Arbitrum Discord post | Needs your edit | Arbiscan links after mainnet; check the channel's rules for project posts |
| Open House / HackQuest submission | Needs your edit | Track choice, video link (Sepolia contract links filled in); submit before **Oct 4, 2026** |
| Demo video script | Ready as a script | Recording (needs fal topped up to show live generation) |
| README | Ready (rewritten 2026-10-01 with screenshots) | Mainnet addresses fill in after deploy (`deploy/addresses.42161.json`) |
| Mainnet runbook (`deploy/MAINNET.md`) | Ready to follow | Funded deployer + Safe addresses; legal sign-off before opening real-money trading |

Hard gates before any public mainnet announcement:
1. fal.ai topped up and `/api/status` → `ai.ok: true`.
2. `node scripts/mainnet-preflight.mjs` passes against the mainnet deployment and server.
3. Legal review of running tradable coins with real money where you'll launch; terms of use live.
