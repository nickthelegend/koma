#!/usr/bin/env bash
# Local Arbitrum Nitro dev node for the KOMA Stylus contracts.
#
# Adapted from https://github.com/OffchainLabs/nitro-devnode (run-dev-node.sh):
# same image and bootstrap (chain owner, L1 price 0, CREATE2 factory, Stylus
# CacheManager, StylusDeployer), but runs detached on a configurable host port
# under its own container name so it never collides with other nitro
# containers on this machine (8547/8647/8747 are taken here).
#
#   ./devnode.sh start     # clone upstream into .devnode/ if needed, start + bootstrap
#   ./devnode.sh stop      # stop and remove the container
#   ./devnode.sh status
#   ./devnode.sh key-file  # print path of a 0600 temp file holding the public dev key
#
# Env: DEVNODE_PORT (default 8649), NITRO_NODE_VERSION (default v3.7.1-926f1ab).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPSTREAM="$HERE/.devnode"
PORT="${DEVNODE_PORT:-8649}"
NAME="${DEVNODE_CONTAINER:-koma-stylus-devnode}"
IMAGE="offchainlabs/nitro-node:${NITRO_NODE_VERSION:-v3.7.1-926f1ab}"
RPC="http://127.0.0.1:${PORT}"
CREATE2_FACTORY=0x4e59b44847b379578588920ca78fbf26c0b4956c
SALT=0x0000000000000000000000000000000000000000000000000000000000000000

ensure_upstream() {
  if [[ ! -f "$UPSTREAM/run-dev-node.sh" ]]; then
    git clone --depth 1 https://github.com/OffchainLabs/nitro-devnode.git "$UPSTREAM" >/dev/null
  fi
}

# The pre-funded dev key is public (nitro-devnode README); read it from the
# upstream script instead of duplicating it here.
dev_key() {
  ensure_upstream
  sed -n 's/^PRIVATE_KEY=\(0x[0-9a-fA-F]\{64\}\).*/\1/p' "$UPSTREAM/run-dev-node.sh" | head -1
}

rpc_up() {
  curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"net_version","params":[],"id":1}' "$RPC" 2>/dev/null | grep -q result
}

start() {
  ensure_upstream
  if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
    echo "devnode already running at $RPC"; return 0
  fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $PORT is in use; set DEVNODE_PORT" >&2; exit 1
  fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --rm --name "$NAME" -p "${PORT}:8547" "$IMAGE" \
    --dev --http.addr 0.0.0.0 --http.api=net,web3,eth,debug >/dev/null
  printf 'waiting for %s' "$RPC"
  for _ in $(seq 1 600); do rpc_up && break; printf .; sleep 0.2; done; echo
  rpc_up || { echo "devnode did not come up" >&2; docker logs --tail 50 "$NAME" >&2; exit 1; }

  local key; key="$(dev_key)"
  cast send -r "$RPC" --private-key "$key" 0x00000000000000000000000000000000000000FF 'becomeChainOwner()' >/dev/null
  cast send -r "$RPC" --private-key "$key" 0x0000000000000000000000000000000000000070 'setL1PricePerUnit(uint256)' 0 >/dev/null
  cast send -r "$RPC" --private-key "$key" --value 1ether 0x3fab184622dc19b6109349b94811493bf2a45362 >/dev/null
  cast publish -r "$RPC" 0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222 >/dev/null
  [[ "$(cast code -r "$RPC" $CREATE2_FACTORY)" != "0x" ]] || { echo "CREATE2 factory missing" >&2; exit 1; }
  local cm
  cm=$(cast send -r "$RPC" --private-key "$key" --create 0x60a06040523060805234801561001457600080fd5b50608051611d1c61003060003960006105260152611d1c6000f3fe | awk '/contractAddress/ {print $2}')
  cast send -r "$RPC" --private-key "$key" 0x0000000000000000000000000000000000000070 'addWasmCacheManager(address)' "$cm" >/dev/null
  local code; code="$(cat "$UPSTREAM/stylus-deployer-bytecode.txt")"
  cast send -r "$RPC" --private-key "$key" $CREATE2_FACTORY "$SALT$code" >/dev/null
  local dep; dep=$(cast create2 --salt $SALT --init-code "$code")
  [[ "$(cast code -r "$RPC" "$dep")" != "0x" ]] || { echo "StylusDeployer missing" >&2; exit 1; }
  echo "devnode up at $RPC (chain id $(cast chain-id -r "$RPC")); CacheManager $cm; StylusDeployer $dep"
}

stop() { docker rm -f "$NAME" >/dev/null 2>&1 && echo "stopped $NAME" || echo "$NAME not running"; }

status() {
  if docker ps --format '{{.Names}}' | grep -qx "$NAME" && rpc_up; then
    echo "running at $RPC, block $(cast block-number -r "$RPC")"
  else
    echo "not running"; return 1
  fi
}

key_file() {
  local f; f="$(mktemp "${TMPDIR:-/tmp}/koma-devkey.XXXXXX")"
  chmod 600 "$f"; dev_key > "$f"; echo "$f"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  key-file) key_file ;;
  rpc) echo "$RPC" ;;
  *) echo "usage: $0 {start|stop|status|key-file|rpc}" >&2; exit 2 ;;
esac
