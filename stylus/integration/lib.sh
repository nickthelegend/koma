# Shared helpers for the devnode integration + bench scripts (sourced).
STYLUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOLC="${SOLC:-$HOME/Library/Application Support/svm/0.8.28/solc-0.8.28}"
[[ -x "$SOLC" ]] || SOLC="$(command -v solc || true)"
[[ -x "$SOLC" ]] || { echo "solc 0.8.28 not found; set SOLC" >&2; exit 1; }

# solc_bin <file.sol> <ContractName> -> creation bytecode (0x...)
solc_bin() {
  "$SOLC" --optimize --optimize-runs 500 --evm-version cancun --combined-json bin "$1" 2>/dev/null |
    python3 -c "import json,sys; c=json.load(sys.stdin)['contracts']; print('0x'+next(v['bin'] for k,v in c.items() if k.endswith(':$2')))"
}

# create <rpc> <keyfile> <bytecode> -> address
create() {
  cast send -r "$1" --private-key "$(cat "$2")" --create "$3" --json | python3 -c "import json,sys; print(json.load(sys.stdin)['contractAddress'])"
}

# stylus_deploy <crate> <rpc> <keyfile> -> address (deploy + activate; constructor via StylusDeployer if present)
stylus_deploy() {
  local out
  out="$(cd "$STYLUS_DIR/$1" && cargo stylus deploy --no-verify -e "$2" --private-key-path "$3" 2>&1 | sed 's/\x1b\[[0-9;]*m//g')" || { echo "$out" >&2; return 1; }
  echo "$out" | grep -oE '(deployed code at address:|activated contract) 0x[0-9a-fA-F]{40}' | head -1 | grep -oE '0x[0-9a-fA-F]{40}'
}
