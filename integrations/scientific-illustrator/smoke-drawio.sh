#!/usr/bin/env bash
# One-shot prereq check for the AutoOffice draw.io MCP wrap.
# Does NOT start MCP servers, draw.io CDP, or any PolarProcess daemon.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PLUGIN="$ROOT/vendor/scientific-illustrator/plugins/scientific-illustrator"
VENDOR_MCP="$PLUGIN/.mcp.json"
WRAP="$HERE/mcp.autooffice.json"
POLARPORT_URL="${POLARPORT_URL:-http://127.0.0.1:11050}"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "OK: $*"; }

APP=""
for cand in /Applications/draw.io.app /Applications/drawio.app; do
  if [[ -d "$cand" ]]; then
    APP="$cand"
    break
  fi
done
[[ -n "$APP" ]] || fail "draw.io Desktop missing (expected /Applications/draw.io.app). brew install --cask drawio"

BIN=""
for b in "$APP/Contents/MacOS/draw.io" "$APP/Contents/MacOS/drawio"; do
  if [[ -x "$b" ]]; then
    BIN="$b"
    break
  fi
done
[[ -n "$BIN" ]] || fail "draw.io binary not executable under $APP"
ok "draw.io Desktop at $APP ($BIN)"

[[ -f "$VENDOR_MCP" ]] || fail "vendor .mcp.json missing: $VENDOR_MCP"
ok "vendor catalog $VENDOR_MCP"

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

const plugin = process.argv[1];
const catalog = JSON.parse(fs.readFileSync(path.join(plugin, ".mcp.json"), "utf8"));
const servers = catalog.mcpServers || {};
const missing = [];
for (const [id, spec] of Object.entries(servers)) {
  const args = spec.args || [];
  const script = args.find((a) => typeof a === "string" && (a.endsWith(".mjs") || a.endsWith(".js")));
  if (!script) {
    missing.push(`${id}: no script arg`);
    continue;
  }
  const resolved = path.resolve(plugin, script);
  if (!fs.existsSync(resolved)) missing.push(`${id}: ${resolved}`);
  else console.log(`OK: vendor server ${id} -> ${resolved}`);
}
if (missing.length) {
  console.error(`FAIL: unresolved vendor MCP paths:\n${missing.join("\n")}`);
  process.exit(1);
}
' "$PLUGIN"

[[ -f "$WRAP" ]] || fail "wrap config missing: $WRAP"

node --input-type=module -e '
import fs from "node:fs";
import path from "node:path";

const wrapPath = process.argv[1];
const plugin = process.argv[2];
const wrap = JSON.parse(fs.readFileSync(wrapPath, "utf8"));
const servers = wrap.mcpServers || {};
const required = ["ao-drawio-live", "ao-drawio-files", "ao-powerpoint-live"];
for (const id of required) {
  if (!servers[id]) {
    console.error(`FAIL: wrap missing server ${id}`);
    process.exit(1);
  }
}
const live = servers["ao-drawio-live"];
const port = live.env && live.env.DRAWIO_LIVE_PORT;
if (port !== "9330" && port !== "9335") {
  console.error(`FAIL: DRAWIO_LIVE_PORT must be 9330 or 9335, got ${port}`);
  process.exit(1);
}
for (const [id, spec] of Object.entries(servers)) {
  const cwd = spec.cwd || plugin;
  const args = spec.args || [];
  const script = args.find((a) => typeof a === "string" && (a.endsWith(".mjs") || a.endsWith(".js")));
  if (!script) {
    console.error(`FAIL: ${id} has no script arg`);
    process.exit(1);
  }
  const resolved = path.resolve(cwd, script);
  if (!fs.existsSync(resolved)) {
    console.error(`FAIL: wrap path missing ${id} -> ${resolved}`);
    process.exit(1);
  }
  console.log(`OK: wrap server ${id} -> ${resolved}`);
}
if (live.env && live.env.DRAWIO_PATH) {
  const p = live.env.DRAWIO_PATH;
  if (!fs.existsSync(p)) {
    console.error(`FAIL: DRAWIO_PATH does not exist: ${p}`);
    process.exit(1);
  }
}
console.log(`OK: DRAWIO_LIVE_PORT=${port}`);
' "$WRAP" "$PLUGIN"

if curl -fsS --max-time 3 "$POLARPORT_URL/api/health" >/dev/null 2>&1; then
  ok "PolarPort available at $POLARPORT_URL/api/health"
  echo "NOTE: claim CDP port before a live launch you own:"
  echo "  source ~/Polarisor/Agent_core/scripts/port-claim.sh"
  echo "  PORT=\$(claim_port \"ao-drawio-live\" \"AutoOffice\" 9330)"
  echo "  # if rejected, retry preferred 9335; never silent port++"
  echo "  # set DRAWIO_LIVE_PORT=\$PORT in Cursor MCP env"
else
  echo "polarport_unavailable — keep DRAWIO_LIVE_PORT=9330; do not increment; do not launch a long-lived CDP/HTTP bridge"
fi

ok "smoke-drawio (no MCP servers started)"
