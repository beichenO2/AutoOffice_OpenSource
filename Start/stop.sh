#!/bin/bash
set -euo pipefail

PORT="${AUTOOFFICE_PORT:-3900}"

TARGET_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
if [ -z "$TARGET_PID" ]; then exit 0; fi

kill -TERM "$TARGET_PID" 2>/dev/null || true
for i in $(seq 1 10); do
    if ! kill -0 "$TARGET_PID" 2>/dev/null; then exit 0; fi
    sleep 1
done
kill -KILL "$TARGET_PID" 2>/dev/null || true
sleep 1
exit 0
