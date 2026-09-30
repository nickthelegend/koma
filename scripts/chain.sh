#!/bin/sh
# Local Arbitrum Sepolia: a pinned fork (real Circle USDC contract) whose state
# is saved to .data/chain.json, so it survives restarts along with koma.db.
set -e
cd "$(dirname "$0")/.."
BLOCK=$(grep '^KOMA_FORK_BLOCK=' .env.local | cut -d= -f2)
mkdir -p .data
exec anvil --fork-url https://arbitrum-sepolia.gateway.tenderly.co --fork-block-number "$BLOCK" \
  --port 18611 --block-time 1 --state .data/chain.json --state-interval 5 --silent
