#!/usr/bin/env bash
set -euo pipefail

POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}

if [ "$#" -ne 0 ]; then
  echo "Usage: bash Start/stop.sh" >&2
  exit 2
fi

curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null
curl -fsS -X POST --max-time 15 "$POLARPROCESS_URL/api/services/autooffice/stop"
printf '\n'
