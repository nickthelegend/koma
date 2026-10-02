#!/usr/bin/env bash
# Deploy + activate the KOMA Stylus contracts (stylus/curve-math, stylus/royalty-router),
# initialize the router and (on Arbitrum One) cache both programs in the Stylus CacheManager.
#
#   scripts/stylus-deploy.sh --endpoint <rpc> [signer] [--usdc 0x..] [--treasury 0x..] [--owner 0x..]
#                            [--cache-bid <wei>] [--dry-run] [--no-init] [--reproducible] [--yes]
#
#   signer (one of):
#     --account <name> --password-file <file>   Foundry keystore ~/.foundry/keystores/<name> (REQUIRED on 42161)
#     --keystore <path> --password-file <file>  any v3 JSON keystore
#     --env-file <file> [--key-var VAR]          raw key from an env file (testnets only; default .env.testnet,
#                                                SERVER_PRIVATE_KEY). Refused on Arbitrum One.
#
#   --dry-run       side-effect free: build + `cargo stylus check` (size, activation data fee) and, read-only,
#                   eth_estimateGas of each deploy through the StylusDeployer plus the CacheManager state.
#                   No signer needed, nothing is signed or sent.
#   --cache-bid W   after deploying, `cargo stylus cache bid <program> W` for BOTH programs (wei; 0 is a valid
#                   bid while the cache is not full). Required on Arbitrum One (42161), optional elsewhere.
#   --no-init       deploy only; print the initialize command instead of sending it.
#   --reproducible  build in cargo-stylus' Docker image (needed for `cargo stylus verify` on Arbiscan).
#   --yes           skip the confirmation prompt on Arbitrum One / Sepolia.
#
# `initialize(usdc, treasury, owner)` may only be sent by the deploying account (the router's constructor
# records tx.origin), so it uses the same signer, right after the deploy. owner defaults to the deployer so that
# the same signer can run script/DeployLaunchpad.s.sol, which sets the factory and then transfers the router to
# ADMIN (transferOwnership). Writes stylus/deployments/<chainId>.json. Runbook: deploy/MAINNET.md.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STYLUS="$ROOT/stylus"
ARB_ONE=42161
ARB_ONE_USDC=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
STYLUS_DEPLOYER=0xcEcba2F1DC234f70Dd89F2041029807F8D03A990
ARB_WASM=0x0000000000000000000000000000000000000071
ARB_WASM_CACHE=0x0000000000000000000000000000000000000072
CTOR_SELECTOR=0x5585258d   # stylus_constructor()

ENDPOINT="" ENV_FILE="$ROOT/.env.testnet" KEY_VAR="SERVER_PRIVATE_KEY"
KEYSTORE="" PASSWORD_FILE="" CACHE_BID=""
USDC="" TREASURY="" OWNER="" DRY=0 NO_INIT=0 REPRO=0 YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint|-e) ENDPOINT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --key-var) KEY_VAR="$2"; shift 2 ;;
    --account) KEYSTORE="$HOME/.foundry/keystores/$2"; shift 2 ;;
    --keystore) KEYSTORE="$2"; shift 2 ;;
    --password-file) PASSWORD_FILE="$2"; shift 2 ;;
    --cache-bid) CACHE_BID="$2"; shift 2 ;;
    --usdc) USDC="$2"; shift 2 ;;
    --treasury) TREASURY="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --dry-run|--check) DRY=1; shift ;;
    --no-init) NO_INIT=1; shift ;;
    --reproducible) REPRO=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ENDPOINT" ]] || { echo "--endpoint is required" >&2; exit 2; }
command -v cargo-stylus >/dev/null || { echo "cargo-stylus not installed (cargo install cargo-stylus)" >&2; exit 1; }
command -v cast >/dev/null || { echo "cast (foundry) not installed" >&2; exit 1; }
[[ -z "$CACHE_BID" || "$CACHE_BID" =~ ^[0-9]+$ ]] || { echo "--cache-bid must be an integer amount of wei" >&2; exit 2; }

CHAIN_ID="$(cast chain-id -r "$ENDPOINT")"
echo "endpoint $ENDPOINT (chain id $CHAIN_ID)"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }
MAINNET=0; [[ "$CHAIN_ID" == "$ARB_ONE" ]] && MAINNET=1

cache_manager() { cast call -r "$ENDPOINT" "$ARB_WASM_CACHE" 'allCacheManagers()(address[])' 2>/dev/null | tr -d '[] ' | awk -F, '{print $NF}'; }

if [[ $DRY == 1 ]]; then
  # Read-only from here on: builds, eth_call and eth_estimateGas only.
  for c in curve-math royalty-router; do
    echo "== cargo stylus check: $c"
    (cd "$STYLUS/$c" && cargo stylus check -e "$ENDPOINT" 2>&1 | strip | grep -vE "File used for deployment hash|project metadata hash")
  done
  if [[ "$(cast code -r "$ENDPOINT" "$STYLUS_DEPLOYER" 2>/dev/null)" != "0x" ]]; then
    TMP_IC="$(mktemp)"; trap 'rm -f "$TMP_IC"' EXIT
    for c in curve-math royalty-router; do
      (cd "$STYLUS/$c" && cargo stylus get-initcode --output "$TMP_IC" >/dev/null 2>&1)
      init=0x; what="deploy + activate"
      [[ $c == royalty-router ]] && init=$CTOR_SELECTOR && what="deploy + activate + constructor"
      # Any funded address works as `from` for an estimate; nothing is signed.
      gas="$(cast estimate -r "$ENDPOINT" --from "${ESTIMATE_FROM:-0x82aF49447D8a07e3bd95BD0d56f35241523fBab1}" --value 0.001ether \
        "$STYLUS_DEPLOYER" 'deploy(bytes,bytes,uint256,bytes32)' "0x$(cat "$TMP_IC")" "$init" 0 \
        0x0000000000000000000000000000000000000000000000000000000000000000 2>&1 | tail -1)"
      echo "estimated gas ($what, one StylusDeployer tx): $c = $gas"
    done
  fi
  CM="$(cache_manager || true)"
  if [[ -n "$CM" ]]; then
    echo "== CacheManager $CM: cacheSize $(cast call -r "$ENDPOINT" "$CM" 'cacheSize()(uint64)' | awk '{print $1}') queueSize $(cast call -r "$ENDPOINT" "$CM" 'queueSize()(uint64)' | awk '{print $1}') paused $(cast call -r "$ENDPOINT" "$CM" 'isPaused()(bool)')"
    echo "   min bid now (wei): $(cast call -r "$ENDPOINT" "$CM" 'getMinBid(uint64)(uint192)' 65536 | awk '{print $1}') (cache not full => 0)"
    echo "   a real run would execute: cargo stylus cache bid <program> ${CACHE_BID:-<wei>} -e $ENDPOINT <signer>  (for both programs)"
  fi
  echo "gas price now: $(cast gas-price -r "$ENDPOINT") wei"
  exit 0
fi

case "$CHAIN_ID" in
  42161|42170|421614)
    if [[ $YES != 1 ]]; then
      read -r -p "chain $CHAIN_ID is a public Arbitrum network. Deploy with real funds? [y/N] " ans
      [[ "$ans" == y || "$ans" == Y ]] || { echo aborted; exit 1; }
    fi ;;
esac

if [[ $MAINNET == 1 ]]; then
  # Arbitrum One mode: keystore signer, canonical USDC, explicit treasury, cache bids for both programs.
  [[ -n "$KEYSTORE" ]] || { echo "Arbitrum One: use --account <name> / --keystore <path> (raw env-file keys are refused)" >&2; exit 1; }
  [[ -n "$CACHE_BID" ]] || { echo "Arbitrum One: --cache-bid <wei> is required (0 is valid while the cache has room)" >&2; exit 1; }
  [[ $NO_INIT == 1 || "$(cast to-check-sum-address "${USDC:-0x0000000000000000000000000000000000000000}")" == "$ARB_ONE_USDC" ]] \
    || { echo "Arbitrum One: --usdc must be $ARB_ONE_USDC" >&2; exit 1; }
  [[ $NO_INIT == 1 || -n "$TREASURY" ]] || { echo "Arbitrum One: --treasury is required" >&2; exit 1; }
fi

# --- signer
KEY_FILE=""
cleanup() { [[ -n "$KEY_FILE" ]] && rm -f "$KEY_FILE"; return 0; }
trap cleanup EXIT
if [[ -n "$KEYSTORE" ]]; then
  [[ -f "$KEYSTORE" ]] || { echo "keystore not found: $KEYSTORE" >&2; exit 1; }
  [[ -n "$PASSWORD_FILE" && -f "$PASSWORD_FILE" ]] || { echo "--password-file is required with a keystore" >&2; exit 1; }
  STYLUS_SIGNER=(--keystore-path "$KEYSTORE" --keystore-password-path "$PASSWORD_FILE")
  CAST_SIGNER=(--keystore "$KEYSTORE" --password-file "$PASSWORD_FILE")
  DEPLOYER="$(cast wallet address "${CAST_SIGNER[@]}")"
else
  # env file -> 0600 temp file (never echoed)
  [[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
  KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/stylus-deploy-key.XXXXXX")"
  chmod 600 "$KEY_FILE"
  python3 - "$ENV_FILE" "$KEY_VAR" "$KEY_FILE" <<'PY'
import re, sys
path, var, out = sys.argv[1:4]
val = None
for line in open(path):
    m = re.match(r'^\s*(?:export\s+)?' + re.escape(var) + r'\s*=\s*(.*?)\s*$', line)
    if m: val = m.group(1).strip().strip('"').strip("'")
if not val:
    sys.exit(f"{var} is missing or empty in {path}")
if not val.startswith("0x"): val = "0x" + val
if not re.fullmatch(r"0x[0-9a-fA-F]{64}", val):
    sys.exit(f"{var} in {path} is not a 32-byte hex private key")
open(out, "w").write(val + "\n")
PY
  STYLUS_SIGNER=(--private-key-path "$KEY_FILE")
  # cast has no key-file flag: the key is passed to cast send only (use --no-init to avoid that).
  CAST_SIGNER=(--private-key "$(cat "$KEY_FILE")")
  DEPLOYER="$(cast wallet address --private-key "$(cat "$KEY_FILE")")"
fi
echo "deployer $DEPLOYER, balance $(cast balance -r "$ENDPOINT" -e "$DEPLOYER") ETH"

VERIFY_FLAG=(--no-verify); [[ $REPRO == 1 ]] && VERIFY_FLAG=()

deploy() { # deploy <crate> -> prints address; deploy + activate (+ constructor through StylusDeployer)
  local out
  # cargo-stylus prices gas at the current base fee, which a busy chain can outrun before
  # inclusion; pay up to 2x the current gas price (Arbitrum charges only the base fee).
  local max_fee_gwei
  max_fee_gwei="$(cast gas-price --rpc-url "$ENDPOINT" | awk '{printf "%.6f", $1 * 2 / 1e9}')"
  if ! out="$(cd "$STYLUS/$1" && cargo stylus deploy "${VERIFY_FLAG[@]}" -e "$ENDPOINT" --max-fee-per-gas-gwei "$max_fee_gwei" "${STYLUS_SIGNER[@]}" 2>&1 | strip)"; then
    echo "$out" | grep -vE "File used for deployment hash" >&2; return 1
  fi
  echo "$out" | grep -E "contract size|data fee|deployment tx hash|activated" | grep -v "We recommend" | sed 's/.*INFO  \[[^]]*\] /  /' >&2
  echo "$out" | grep -oE '(deployed code at address:|activated contract) 0x[0-9a-fA-F]{40}' | head -1 | grep -oE '0x[0-9a-fA-F]{40}'
}

activated() { # ArbWasm.programVersion(addr) > 0 once activated
  local v; v="$(cast call -r "$ENDPOINT" "$ARB_WASM" 'programVersion(address)(uint16)' "$1" 2>/dev/null || echo 0)"
  [[ "${v%% *}" != 0 ]]
}

cached() { # ArbWasmCache.codehashIsCached(extcodehash)
  [[ "$(cast call -r "$ENDPOINT" "$ARB_WASM_CACHE" 'codehashIsCached(bytes32)(bool)' "$(cast codehash -r "$ENDPOINT" "$1")" 2>/dev/null)" == true ]]
}

echo "== deploy curve-math"
MATH="$(deploy curve-math)"; [[ -n "$MATH" ]] || { echo "curve-math deploy failed" >&2; exit 1; }
echo "== deploy royalty-router"
ROUTER="$(deploy royalty-router)"; [[ -n "$ROUTER" ]] || { echo "royalty-router deploy failed" >&2; exit 1; }
for a in "$MATH" "$ROUTER"; do
  activated "$a" || { echo "$a is deployed but not activated; run: cargo stylus activate --address $a -e $ENDPOINT" >&2; exit 1; }
done
echo
echo "CURVE_MATH (ICurveMath)      $MATH"
echo "ROYALTY_ROUTER (IRoyaltyRouter) $ROUTER"

OWNER="${OWNER:-$DEPLOYER}"
INIT_CMD="cast send -r $ENDPOINT $ROUTER 'initialize(address,address,address)' ${USDC:-<usdc>} ${TREASURY:-<treasury>} $OWNER <same signer as the deploy>"
INITIALIZED=false
if [[ $NO_INIT == 1 || -z "$USDC" || -z "$TREASURY" ]]; then
  [[ $NO_INIT == 1 ]] || echo "(--usdc/--treasury not given: skipping initialize)"
  echo "initialize (must be sent by $DEPLOYER):"
  echo "  $INIT_CMD"
else
  echo "== router.initialize($USDC, $TREASURY, $OWNER)"
  cast send -r "$ENDPOINT" "${CAST_SIGNER[@]}" "$ROUTER" 'initialize(address,address,address)' \
    "$USDC" "$TREASURY" "$OWNER" >/dev/null
  [[ "$(cast call -r "$ENDPOINT" "$ROUTER" 'owner()(address)')" == "$(cast to-check-sum-address "$OWNER")" ]] || { echo "initialize failed" >&2; exit 1; }
  INITIALIZED=true
  echo "initialized: usdc $(cast call -r "$ENDPOINT" "$ROUTER" 'usdc()(address)'), treasury $(cast call -r "$ENDPOINT" "$ROUTER" 'treasury()(address)'), owner $OWNER"
  echo "next: script/DeployLaunchpad.s.sol with the same signer sets the factory and transfers the router to ADMIN"
fi

CACHED=false
if [[ -n "$CACHE_BID" ]]; then
  for a in "$MATH" "$ROUTER"; do
    echo "== CacheManager bid $CACHE_BID wei for $a"
    (cd "$STYLUS/curve-math" && cargo stylus cache bid "$a" "$CACHE_BID" -e "$ENDPOINT" "${STYLUS_SIGNER[@]}" 2>&1 | strip | grep -vE "File used for deployment hash|project metadata hash")
    cached "$a" || { echo "$a is not cached after the bid (raise --cache-bid; see cargo stylus cache suggest-bid $a)" >&2; exit 1; }
  done
  CACHED=true
  echo "both programs cached"
fi

mkdir -p "$STYLUS/deployments"
OUT="$STYLUS/deployments/$CHAIN_ID.json"
cat > "$OUT" <<JSON
{
  "chainId": $CHAIN_ID,
  "curveMath": "$MATH",
  "royaltyRouter": "$ROUTER",
  "deployer": "$DEPLOYER",
  "initialized": $INITIALIZED,
  "usdc": "${USDC}",
  "treasury": "${TREASURY}",
  "owner": "$OWNER",
  "cacheBidWei": "${CACHE_BID}",
  "cached": $CACHED,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "wrote ${OUT#$ROOT/}  (forge script env: MATH=$MATH ROUTER=$ROUTER)"
