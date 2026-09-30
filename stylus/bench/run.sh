#!/usr/bin/env bash
# Gas benchmark on the local nitro devnode: Stylus curve-math vs the Solidity
# CurveMathReference (contracts/src), called N times through bench/CurveBench.sol,
# plus IRoyaltyRouter.route (Stylus vs RoyaltyRouterReference). All numbers are
# eth_estimateGas / receipt gasUsed from the node. Writes bench/results.json.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../integration/lib.sh"
cd "$STYLUS_DIR"
RPC="$(./devnode.sh rpc)"
./devnode.sh status >/dev/null 2>&1 || ./devnode.sh start
KF="$(./devnode.sh key-file)"; trap 'rm -f "$KF"' EXIT
DEV="$(cast wallet address --private-key "$(cat "$KF")")"
send() { cast send -r "$RPC" --private-key "$(cat "$KF")" "$@" >/dev/null; }

MATH_STYLUS="$(stylus_deploy curve-math "$RPC" "$KF")"
ROUTER_STYLUS="$(stylus_deploy royalty-router "$RPC" "$KF")"
MATH_SOL="$(create "$RPC" "$KF" "$(solc_bin ../contracts/src/CurveMathReference.sol CurveMathReference)")"
ROUTER_BIN="0x$("$SOLC" --optimize --optimize-runs 500 --evm-version cancun @openzeppelin/=../node_modules/@openzeppelin/ \
  --allow-paths ..,../node_modules --combined-json bin ../contracts/src/RoyaltyRouterReference.sol 2>/dev/null |
  python3 -c "import json,sys; c=json.load(sys.stdin)['contracts']; print(next(v['bin'] for k,v in c.items() if k.endswith(':RoyaltyRouterReference')))")"
ROUTER_SOL="$(create "$RPC" "$KF" "$ROUTER_BIN")"
BENCH="$(create "$RPC" "$KF" "$(solc_bin bench/CurveBench.sol CurveBench)")"
USDC="$(create "$RPC" "$KF" "$(solc_bin integration/TestToken.sol TestToken)")"

# Identical router setup on both: dev = owner = factory = curve of every series,
# chain 1 <- 2 <- 3 <- 4, distinct (fresh) recipient accounts per router.
for pair in "$ROUTER_STYLUS:a" "$ROUTER_SOL:b"; do
  R="${pair%%:*}"; P="${pair##*:}"
  send "$R" 'initialize(address,address,address)' "$USDC" "0x${P}0000000000000000000000000000000000077ee" "$DEV"
  send "$R" 'setFactory(address)' "$DEV"
  for id in 1 2 3 4; do
    send "$R" 'registerSeries(uint256,address,address,uint256)' "$id" "$DEV" "0x${P}00000000000000000000000000000000000a00$id" $((id - 1))
  done
  send "$USDC" 'mint(address,uint256)' "$R" 100000000
done

STYLUS_DIR="$STYLUS_DIR" RPC="$RPC" KF="$KF" DEV="$DEV" python3 bench/bench.py \
  "$MATH_STYLUS" "$MATH_SOL" "$BENCH" "$ROUTER_STYLUS" "$ROUTER_SOL"
