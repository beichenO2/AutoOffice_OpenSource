#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
PROJECT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
POLARPORT_URL=${POLARPORT_URL:-http://127.0.0.1:11050}
POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
PREFERRED_PORT=3900
NODE_BIN=${AUTOOFFICE_NODE_BIN:-~/.nvm/versions/node/v22.22.2/bin/node}

if [ "$#" -ne 0 ]; then
  echo "AutoOffice lifecycle is managed by PolarProcess; do not pass arguments" >&2
  exit 2
fi
if [ ! -x "$NODE_BIN" ]; then
  echo "AutoOffice Node executable missing: $NODE_BIN" >&2
  exit 1
fi
if [ "$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')" -lt 20 ]; then
  echo "AutoOffice requires Node 20 or newer" >&2
  exit 1
fi
if [ ! -f "$PROJECT_DIR/dist/cli.js" ]; then
  echo "AutoOffice build artifact missing: dist/cli.js" >&2
  exit 1
fi
if ! curl -fsS --max-time 3 "$POLARPORT_URL/api/health" >/dev/null; then
  echo "PolarPort is unavailable; refusing preferred-port fallback" >&2
  exit 1
fi
if ! curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null; then
  echo "PolarProcess is unavailable; refusing unmanaged service start" >&2
  exit 1
fi

source "$HOME/Polarisor/Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "autooffice" "AutoOffice" 3900)
if [ "$PORT" -ne "$PREFERRED_PORT" ]; then
  release_port "$PORT"
  echo "PolarPort returned $PORT, but AutoOffice requires $PREFERRED_PORT" >&2
  exit 1
fi

cd "$PROJECT_DIR"
export NODE_ENV=${NODE_ENV:-production}
export PORT
export AUTOOFFICE_PORT=$PORT
export POLAR_RUNTIME_MANAGED=1
exec "$NODE_BIN" dist/cli.js serve -p "$PORT"
