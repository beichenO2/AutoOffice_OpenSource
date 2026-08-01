#!/usr/bin/env bash
# Register the AutoOffice Agent preview as a first-class PolarProcess service so
# PolarManager owns its lifecycle (start/stop/restart) and PolarPort keeps its
# port (3901) reserved. This is what stops the preview URL from drifting.
#
# Usage: bash scripts/register-agent-preview.sh [register|finalize]
#   register  — register the service, do NOT auto-start (default)
#   finalize  — register + auto_start + health check on :3901
set -euo pipefail

PROJECT_DIR=$(cd "$(dirname "$0")/.." && pwd)
POLARPROCESS_URL=${POLARPROCESS_URL:-http://127.0.0.1:11055}
# PolarPort policy: allocations must end in 0 or 5. Prod is 3900; preview pins 3905.
PREVIEW_PORT=${AUTOOFFICE_PREVIEW_PORT:-3905}
MODE=${1:-register}

case "$MODE" in
  register)  auto_start=false; health_url='' ;;
  finalize)  auto_start=true;  health_url="http://127.0.0.1:${PREVIEW_PORT}/health" ;;
  *) echo 'Usage: bash scripts/register-agent-preview.sh [register|finalize]' >&2; exit 2 ;;
esac

curl -fsS --max-time 3 "$POLARPROCESS_URL/api/health" >/dev/null

payload=$(jq -n \
  --arg work_dir "$PROJECT_DIR" \
  --arg health_url "$health_url" \
  --argjson auto_start "$auto_start" \
  --argjson port "$PREVIEW_PORT" \
  '{
    id: "autooffice-agent-preview",
    name: "AutoOffice Agent 预览",
    command: "bash Start/agent-preview.sh",
    work_dir: $work_dir,
    device_id: "any",
    auto_start: $auto_start,
    restart_on_failure: true,
    max_restarts: 30,
    port: $port,
    health_check_url: (if $health_url == "" then null else $health_url end),
    start_script_dir: "-"
  }')

curl -fsS -X POST "$POLARPROCESS_URL/api/services/register" \
  -H 'Content-Type: application/json' \
  -d "$payload"
printf '\n'
