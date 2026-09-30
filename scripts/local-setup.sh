#!/bin/sh
# One-time setup for the local fork (npm run chain). Uses the keys in .env.local:
# SERVER_PRIVATE_KEY deploys KomaIssues (admin + minter) and pays facilitator gas;
# the TEST_* wallets get real forked USDC. Fresh keys only: the public anvil
# accounts carry EIP-7702 delegations on Arbitrum Sepolia, which USDC then
# verifies through ERC-1271 and rejects.
set -e
cd "$(dirname "$0")/.."
val() { grep "^$1=" .env.local | cut -d= -f2; }
RPC=http://127.0.0.1:18611
USDC=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
SERVER=$(val SERVER_ADDRESS)
SERVER_KEY=$(val SERVER_PRIVATE_KEY)

for a in "$SERVER" "$(val TEST_BROWSER_ADDRESS)" "$(val TEST_AGENT_ADDRESS)" "$(val TEST_EMPTY_ADDRESS)" "$(val TEST_PAYTO_ADDRESS)"; do
  [ "$(cast code "$a" --rpc-url $RPC)" = "0x" ] || { echo "$a has code; use a fresh key"; exit 1; }
done
cast rpc anvil_setBalance "$SERVER" 0x8ac7230489e80000 --rpc-url $RPC > /dev/null   # 10 test ETH for gas

ADDR=$(cd contracts && DEPLOYER_PRIVATE_KEY=$SERVER_KEY KOMA_BASE_URI=http://localhost:4310/api/tokens/ \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast 2>&1 | awk '/^  KomaIssues/ {print $2}')
[ -n "$ADDR" ] || { echo "deploy failed"; exit 1; }
sed -i '' "s#^KOMA_CONTRACT=.*#KOMA_CONTRACT=$ADDR#" .env.local
echo "KomaIssues $ADDR (admin + minter $SERVER)"

# FiatToken keeps balances in mapping slot 9.
fund() { cast rpc anvil_setStorageAt $USDC "$(cast index address "$1" 9)" "0x$(printf '%064x' "$2")" --rpc-url $RPC > /dev/null; echo "$1 → $(cast call $USDC 'balanceOf(address)(uint256)' "$1" --rpc-url $RPC)"; }
fund "$(val TEST_BROWSER_ADDRESS)" 20000000
fund "$(val TEST_AGENT_ADDRESS)" 10000000
fund "$(val TEST_EMPTY_ADDRESS)" 0
fund "$(val TEST_PAYTO_ADDRESS)" 0
