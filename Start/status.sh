#!/usr/bin/env bash
set -euo pipefail

POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
HEALTH_URL=http://127.0.0.1:3900/health

if [ "$#" -ne 0 ]; then
  echo "Usage: bash Start/status.sh" >&2
  exit 2
fi

service=$(curl -fsS --max-time 3 "$POLARPROCESS_URL/api/services/autooffice")
status=$(printf '%s' "$service" | jq -r '.status')
pid=$(printf '%s' "$service" | jq -r '.pid // "-"')
if [ "$status" != running ]; then
  echo "$status pid=$pid"
  exit 1
fi
if ! curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null; then
  echo "degraded pid=$pid port=3900"
  exit 2
fi
echo "running pid=$pid port=3900"
