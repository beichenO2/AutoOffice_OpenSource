#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# ── Dynamic port allocation via PolarPort ────────────
source "$PROJECT_DIR/../Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "autooffice" "AutoOffice" "3900")

cd "$PROJECT_DIR"

OCCUPANT_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
if [ -n "$OCCUPANT_PID" ]; then
    echo "pid=$OCCUPANT_PID"
    echo "port=$PORT"
    exit 0
fi

nohup node dist/cli.js serve -p "$PORT" > /dev/null 2>&1 &
DAEMON_PID=$!

for i in $(seq 1 30); do
    OCCUPANT_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
    if [ -n "$OCCUPANT_PID" ]; then
        echo "pid=$OCCUPANT_PID"
        echo "port=$PORT"
        exit 0
    fi
    sleep 1
done

echo "Timed out waiting for port $PORT" >&2
exit 1
