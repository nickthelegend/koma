#!/usr/bin/env bash
# Deploy + activate the KOMA Stylus contracts (stylus/curve-math, stylus/royalty-router)
# and initialize the router.
#
#   scripts/stylus-deploy.sh --endpoint <rpc> [--env-file .env.testnet] [--key-var SERVER_PRIVATE_KEY]
#                            [--usdc 0x..] [--treasury 0x..] [--owner 0x..]
#                            [--dry-run] [--no-init] [--reproducible] [--yes]
#
#   --dry-run       build + `cargo stylus check` both crates against the endpoint (size, activation
#                   data fee). No key needed, nothing is sent.
#   --no-init       deploy only; print the initialize command instead of sending it.
#   --reproducible  build in cargo-stylus' Docker image (verifiable on Arbiscan); default is a local build.
#   --yes           skip the confirmation prompt on Arbitrum One / Sepolia.
#
# The private key is read from the env file (variable --key-var) into a 0600 temp file that is
# deleted on exit. It is never printed or passed on a command line visible to `ps` except to
# `cast send` for initialize (cast has no key-file flag; use --no-init to avoid that).
#
# `initialize(usdc, treasury, owner)` may only be sent by the deploying account (the router's
# constructor records tx.origin), so it uses the same key. owner defaults to the deployer.
# Writes stylus/deployments/<chainId>.json.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STYLUS="$ROOT/stylus"

ENDPOINT="" ENV_FILE="$ROOT/.env.testnet" KEY_VAR="SERVER_PRIVATE_KEY"
USDC="" TREASURY="" OWNER="" DRY=0 NO_INIT=0 REPRO=0 YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint|-e) ENDPOINT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --key-var) KEY_VAR="$2"; shift 2 ;;
    --usdc) USDC="$2"; shift 2 ;;
    --treasury) TREASURY="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --dry-run|--check) DRY=1; shift ;;
    --no-init) NO_INIT=1; shift ;;
    --reproducible) REPRO=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$ENDPOINT" ]] || { echo "--endpoint is required" >&2; exit 2; }
command -v cargo-stylus >/dev/null || { echo "cargo-stylus not installed (cargo install cargo-stylus)" >&2; exit 1; }
command -v cast >/dev/null || { echo "cast (foundry) not installed" >&2; exit 1; }

CHAIN_ID="$(cast chain-id -r "$ENDPOINT")"
echo "endpoint $ENDPOINT (chain id $CHAIN_ID)"
strip() { sed 's/\x1b\[[0-9;]*m//g'; }

if [[ $DRY == 1 ]]; then
  for c in curve-math royalty-router; do
    echo "== cargo stylus check: $c"
    (cd "$STYLUS/$c" && cargo stylus check -e "$ENDPOINT" 2>&1 | strip | grep -vE "File used for deployment hash|project metadata hash")
  done
  exit 0
fi

case "$CHAIN_ID" in
  42161|42170|421614)
    if [[ $YES != 1 ]]; then
      read -r -p "chain $CHAIN_ID is a public Arbitrum network. Deploy with real funds? [y/N] " ans
      [[ "$ans" == y || "$ans" == Y ]] || { echo aborted; exit 1; }
    fi ;;
esac

# --- key: env file -> 0600 temp file (never echoed)
[[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
KEY_FILE="$(mktemp "${TMPDIR:-/tmp}/stylus-deploy-key.XXXXXX")"
chmod 600 "$KEY_FILE"
trap 'rm -f "$KEY_FILE"' EXIT
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
DEPLOYER="$(cast wallet address --private-key "$(cat "$KEY_FILE")")"
echo "deployer $DEPLOYER, balance $(cast balance -r "$ENDPOINT" -e "$DEPLOYER") ETH"

VERIFY_FLAG=(--no-verify); [[ $REPRO == 1 ]] && VERIFY_FLAG=()

deploy() { # deploy <crate> -> prints address; deploy + activate (+ constructor through StylusDeployer)
  local out
  if ! out="$(cd "$STYLUS/$1" && cargo stylus deploy "${VERIFY_FLAG[@]}" -e "$ENDPOINT" --private-key-path "$KEY_FILE" 2>&1 | strip)"; then
    echo "$out" | grep -vE "File used for deployment hash" >&2; return 1
  fi
  echo "$out" | grep -E "contract size|data fee|deployment tx hash|activated" | grep -v "We recommend" | sed 's/.*INFO  \[[^]]*\] /  /' >&2
  echo "$out" | grep -oE '(deployed code at address:|activated contract) 0x[0-9a-fA-F]{40}' | head -1 | grep -oE '0x[0-9a-fA-F]{40}'
}

activated() { # ArbWasm.programVersion(addr) > 0 once activated
  local v; v="$(cast call -r "$ENDPOINT" 0x0000000000000000000000000000000000000071 'programVersion(address)(uint16)' "$1" 2>/dev/null || echo 0)"
  [[ "${v%% *}" != 0 ]]
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
INIT_CMD="cast send -r $ENDPOINT $ROUTER 'initialize(address,address,address)' ${USDC:-<usdc>} ${TREASURY:-<treasury>} $OWNER --private-key \$$KEY_VAR"
INITIALIZED=false
if [[ $NO_INIT == 1 || -z "$USDC" || -z "$TREASURY" ]]; then
  [[ $NO_INIT == 1 ]] || echo "(--usdc/--treasury not given: skipping initialize)"
  echo "initialize (must be sent by $DEPLOYER):"
  echo "  $INIT_CMD"
else
  echo "== router.initialize($USDC, $TREASURY, $OWNER)"
  cast send -r "$ENDPOINT" --private-key "$(cat "$KEY_FILE")" "$ROUTER" 'initialize(address,address,address)' \
    "$USDC" "$TREASURY" "$OWNER" >/dev/null
  [[ "$(cast call -r "$ENDPOINT" "$ROUTER" 'owner()(address)')" == "$(cast to-check-sum-address "$OWNER")" ]] || { echo "initialize failed" >&2; exit 1; }
  INITIALIZED=true
  echo "initialized: usdc $(cast call -r "$ENDPOINT" "$ROUTER" 'usdc()(address)'), treasury $(cast call -r "$ENDPOINT" "$ROUTER" 'treasury()(address)'), owner $OWNER"
  echo "next: router.setFactory(<SeriesFactory>) from the owner once the factory is deployed"
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
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo "wrote ${OUT#$ROOT/}  (forge script env: MATH=$MATH ROUTER=$ROUTER)"
