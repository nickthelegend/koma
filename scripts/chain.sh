#!/bin/sh
# Local Arbitrum Sepolia: a pinned fork (real Circle USDC contract) whose state
# is saved to .data/chain.json, so it survives restarts along with koma.db.
# anvil rewrites that file in place every few seconds, so a kill mid-write leaves
# it truncated: keep the last good copy and fall back to it.
set -e
cd "$(dirname "$0")/.."
BLOCK=$(grep '^KOMA_FORK_BLOCK=' .env.local | cut -d= -f2)
mkdir -p .data
STATE=.data/chain.json
if [ -s "$STATE" ]; then
  if node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$STATE" 2>/dev/null; then
    cp "$STATE" "$STATE.bak"
  elif [ -s "$STATE.bak" ]; then
    echo "chain: $STATE is damaged (interrupted save); restoring $STATE.bak" >&2
    cp "$STATE.bak" "$STATE"
  else
    echo "chain: $STATE is damaged and there is no backup" >&2
    exit 1
  fi
fi
# Fork through Alchemy when KOMA_FORK_RPC is set (an archive node), else the public Tenderly gateway.
FORK_RPC=$(grep '^KOMA_FORK_RPC=' .env.local | cut -d= -f2-)
exec anvil --fork-url "${FORK_RPC:-https://arbitrum-sepolia.gateway.tenderly.co}" --fork-block-number "$BLOCK" \
  --port 18611 --block-time 1 --state "$STATE" --state-interval 5 --silent
