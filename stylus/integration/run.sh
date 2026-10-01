#!/usr/bin/env bash
# End-to-end check of the Stylus contracts on a local nitro devnode.
#   1. deploy curve-math + royalty-router (cargo stylus deploy), a 6-dec test
#      token (USDC stand-in) and the Solidity CurveMathReference
#   2. curve vectors: every case/revert in test-vectors/curve.json via eth_call,
#      against BOTH the Stylus contract and the Solidity reference
#   3. router: initialize -> setFactory -> registerSeries chain of depth 3 ->
#      token transfer to router -> route (from the curve) -> balances, earned, events
#   4. access control on-chain (initialize twice, non-owner/non-factory/non-curve)
# Usage: ./integration/run.sh   (starts the devnode if needed; DEVNODE_PORT=8649)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cd "$STYLUS_DIR"
RPC="$(./devnode.sh rpc)"
./devnode.sh status >/dev/null 2>&1 || ./devnode.sh start
KF="$(./devnode.sh key-file)"; trap 'rm -f "$KF" "${EPH:-}"' EXIT
DEV="$(cast wallet address --private-key "$(cat "$KF")")"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

echo "== deploy"
MATH="$(stylus_deploy curve-math "$RPC" "$KF")"; echo "curve-math (stylus)  $MATH"
ROUTER="$(stylus_deploy royalty-router "$RPC" "$KF")"; echo "royalty-router       $ROUTER"
USDC="$(create "$RPC" "$KF" "$(solc_bin integration/TestToken.sol TestToken)")"; echo "test USDC            $USDC"
REF="$(create "$RPC" "$KF" "$(solc_bin ../contracts/src/CurveMathReference.sol CurveMathReference)")"; echo "CurveMathReference   $REF"

echo "== curve vectors (stylus + solidity reference)"
python3 integration/vectors.py "$RPC" "$MATH" stylus
python3 integration/vectors.py "$RPC" "$REF" solidity-reference

echo "== router"
# Test accounts: the PUBLIC anvil/hardhat test mnemonic (indices 1-6), funded below on this local devnode only.
# No new private key is generated; these keys are public knowledge and must never hold real funds.
EPH="$(mktemp)"; chmod 600 "$EPH"
for i in 1 2 3 4 5 6; do
  cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index "$i" >> "$EPH"
done
key() { sed -n "${1}p" "$EPH"; }
addr() { cast wallet address --private-key "$(key "$1")"; }
FACTORY_ADDR="$(addr 1)"; STRANGER="$(addr 6)"
for i in 1 2 3 4 6; do cast send -r "$RPC" --private-key "$(cat "$KF")" --value 0.1ether "$(addr "$i")" >/dev/null; done
[[ -n "$(key 5)" ]] || fail "key gen"
TREASURY=0x00000000000000000000000000000000000077ee
ACC=(0 0x000000000000000000000000000000000000a001 0x000000000000000000000000000000000000a002 0x000000000000000000000000000000000000a003 0x000000000000000000000000000000000000a004)
CURVE_KEY=(0 "$(key 2)" "$(key 3)" "$(key 4)" "$(key 5)")
CURVE=(0 "$(addr 2)" "$(addr 3)" "$(addr 4)" "$(addr 5)")
cast send -r "$RPC" --private-key "$(cat "$KF")" --value 0.1ether "${CURVE[4]}" >/dev/null

reverts() { # reverts <expected-selector-prefix> <cast send args...>
  local want="$1"; shift
  local out; if out="$(cast send -r "$RPC" "$@" 2>&1)"; then fail "expected revert: $*"; fi
  [[ -z "$want" || "$out" == *"$want"* ]] || fail "wrong revert (want $want): $out"
}
# initialize: only the deployer, once
reverts 0x8e4a23d6 --private-key "$(key 6)" "$ROUTER" 'initialize(address,address,address)' "$USDC" "$TREASURY" "$STRANGER"
cast send -r "$RPC" --private-key "$(cat "$KF")" "$ROUTER" 'initialize(address,address,address)' "$USDC" "$TREASURY" "$DEV" >/dev/null
reverts "" --private-key "$(cat "$KF")" "$ROUTER" 'initialize(address,address,address)' "$USDC" "$TREASURY" "$DEV"
pass "initialize once, deployer only"
reverts 0x8e4a23d6 --private-key "$(key 6)" "$ROUTER" 'setFactory(address)' "$STRANGER"
cast send -r "$RPC" --private-key "$(cat "$KF")" "$ROUTER" 'setFactory(address)' "$FACTORY_ADDR" >/dev/null
[[ "$(cast call -r "$RPC" "$ROUTER" 'factory()(address)')" == "$FACTORY_ADDR" ]] || fail factory
[[ "$(cast call -r "$RPC" "$ROUTER" 'owner()(address)')" == "$DEV" ]] || fail owner
[[ "$(cast call -r "$RPC" "$ROUTER" 'usdc()(address)')" == "$(cast to-check-sum-address "$USDC")" ]] || fail usdc
pass "setFactory owner only; views"

reverts 0x8e4a23d6 --private-key "$(cat "$KF")" "$ROUTER" 'registerSeries(uint256,address,address,uint256)' 1 "${CURVE[1]}" "${ACC[1]}" 0
REG_LOGS=0
for id in 1 2 3 4; do
  rc="$(cast send -r "$RPC" --private-key "$(key 1)" "$ROUTER" 'registerSeries(uint256,address,address,uint256)' "$id" "${CURVE[$id]}" "${ACC[$id]}" $((id - 1)) --json)"
  REG_LOGS=$((REG_LOGS + $(echo "$rc" | python3 -c "import json,sys; print(sum(1 for l in json.load(sys.stdin)['logs'] if l['topics'][0]=='$(cast keccak 'SeriesRegistered(uint256,address,address,uint256)')'))")))
done
[[ $REG_LOGS == 4 ]] || fail "SeriesRegistered events: $REG_LOGS"
reverts 0x8fbcdbab --private-key "$(key 1)" "$ROUTER" 'registerSeries(uint256,address,address,uint256)' 9 "${CURVE[1]}" "${ACC[1]}" 8
[[ "$(cast call -r "$RPC" "$ROUTER" 'parentOf(uint256)(uint256)' 4)" == 3 ]] || fail parentOf
[[ "$(cast call -r "$RPC" "$ROUTER" 'curveOf(uint256)(address)' 4)" == "${CURVE[4]}" ]] || fail curveOf
pass "registerSeries chain 1<-2<-3<-4 (factory only, unknown parent rejected, 4 events)"

AMOUNT=1000000   # 1 USDC fee routed on series 4 (3 ancestors)
cast send -r "$RPC" --private-key "$(cat "$KF")" "$USDC" 'mint(address,uint256)' "$ROUTER" $((AMOUNT * 2 + 7)) >/dev/null
reverts 0x8e4a23d6 --private-key "$(key 6)" "$ROUTER" 'route(uint256,uint256)' 4 $AMOUNT
reverts 0x8e4a23d6 --private-key "${CURVE_KEY[3]}" "$ROUTER" 'route(uint256,uint256)' 4 $AMOUNT
RC="$(cast send -r "$RPC" --private-key "${CURVE_KEY[4]}" "$ROUTER" 'route(uint256,uint256)' 4 $AMOUNT --json)"
ROUTE_GAS="$(echo "$RC" | python3 -c "import json,sys; print(int(json.load(sys.stdin)['gasUsed'],16))")"
python3 - "$RC" "$ROUTER" <<PY
import json, sys
rc = json.loads(sys.argv[1]); router = sys.argv[2].lower()
topic = "$(cast keccak 'Routed(uint256,address,uint256,uint8)')"
got = [(int(l["topics"][1],16), "0x"+l["topics"][2][-40:], int(l["data"][2:66],16), int(l["data"][66:130],16))
       for l in rc["logs"] if l["address"].lower()==router and l["topics"][0]==topic]
want = [(4,"${ACC[3]}",100000,1),(4,"${ACC[2]}",50000,1),(4,"${ACC[1]}",25000,1),(4,"${ACC[4]}",425000,0),(4,"$TREASURY",400000,2)]
assert got == want, (got, want)
print("PASS: Routed events (order, recipients, amounts, kinds) =", [g[2] for g in got])
PY
bal() { cast call -r "$RPC" "$USDC" 'balanceOf(address)(uint256)' "$1" | awk '{print $1}'; }
earned() { cast call -r "$RPC" "$ROUTER" 'earned(address)(uint256)' "$1" | awk '{print $1}'; }
check() { [[ "$(bal "$1")" == "$2" && "$(earned "$1")" == "$2" ]] || fail "balance/earned $1: $(bal "$1")/$(earned "$1") != $2"; }
check "${ACC[4]}" 425000; check "${ACC[3]}" 100000; check "${ACC[2]}" 50000; check "${ACC[1]}" 25000; check "$TREASURY" 400000
[[ "$(bal "$ROUTER")" == $((AMOUNT + 7)) ]] || fail "router kept $(bal "$ROUTER")"
pass "route(4, 1e6) 40/20/40: char 425000 / parent 100000 / grandparent 50000 / great-grandparent 25000 / treasury 400000 (gasUsed $ROUTE_GAS)"

# second route on the root series with an odd amount: dust goes to the character
cast send -r "$RPC" --private-key "${CURVE_KEY[1]}" "$ROUTER" 'route(uint256,uint256)' 1 1000007 >/dev/null
check "${ACC[1]}" $((25000 + 600005)); check "$TREASURY" $((400000 + 400002))
[[ "$(bal "$ROUTER")" == 0 ]] || fail "router not empty"
pass "route(1, 1000007): root takes pool + dust, earned accumulates, router drained to 0"

# transfer failure: route more than the router holds -> token reverts -> route reverts
reverts "" --private-key "${CURVE_KEY[1]}" "$ROUTER" 'route(uint256,uint256)' 1 5
pass "route reverts when the USDC transfer fails"

# ownership hand-over (deploy flow: deployer initializes as owner, wires the factory, hands over to ADMIN)
reverts 0x8e4a23d6 --private-key "$(key 6)" "$ROUTER" 'transferOwnership(address)' "$STRANGER"
reverts "$(cast sig 'ZeroAddress()')" --private-key "$(cat "$KF")" "$ROUTER" 'transferOwnership(address)' 0x0000000000000000000000000000000000000000
RC="$(cast send -r "$RPC" --private-key "$(cat "$KF")" "$ROUTER" 'transferOwnership(address)' "$STRANGER" --json)"
python3 - "$RC" "$ROUTER" "$DEV" "$STRANGER" <<PY
import json, sys
rc = json.loads(sys.argv[1]); router, dev, new = (a.lower() for a in sys.argv[2:5])
topic = "$(cast keccak 'OwnershipTransferred(address,address)')"
logs = [l for l in rc["logs"] if l["address"].lower() == router and l["topics"][0] == topic]
assert len(logs) == 1 and logs[0]["topics"][1][-40:] == dev[2:] and logs[0]["topics"][2][-40:] == new[2:], logs
PY
[[ "$(cast call -r "$RPC" "$ROUTER" 'owner()(address)')" == "$STRANGER" ]] || fail "owner after transfer"
reverts 0x8e4a23d6 --private-key "$(cat "$KF")" "$ROUTER" 'setFactory(address)' "$FACTORY_ADDR"
cast send -r "$RPC" --private-key "$(key 6)" "$ROUTER" 'setFactory(address)' "$FACTORY_ADDR" >/dev/null
pass "transferOwnership: owner only, non-zero, OwnershipTransferred event, old owner locked out, new owner in control"
echo "ALL PASS"
