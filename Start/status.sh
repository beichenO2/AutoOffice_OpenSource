#!/bin/bash
set -euo pipefail

PORT="${AUTOOFFICE_PORT:-3900}"

OCCUPANT_PID=$(lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true)
if [ -z "$OCCUPANT_PID" ]; then echo "stopped"; exit 1; fi

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 400 ]; then
    echo "running pid=$OCCUPANT_PID port=$PORT"
    exit 0
else
    echo "degraded pid=$OCCUPANT_PID port=$PORT http=$HTTP_STATUS"
    exit 2
fi
