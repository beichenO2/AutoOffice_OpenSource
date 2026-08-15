# scientific-illustrator → AutoOffice (draw.io MCP wrap)

Cursor-facing wrap around the pinned vendor plugin
`vendor/scientific-illustrator` (**v1.5.4**, MIT). AutoOffice does **not** run
upstream `install.sh` (Codex Marketplace only).

This wrap exposes three **stdio** MCP servers so agents can build **editable**
`.drawio` figures. It does **not** replace Slidev / WYSIWYG PPTX.

---

## PPTX export tracks (AutoOffice)

Scientific Illustrator prefers **editable text objects** over flattened rasters.
AutoOffice keeps two PPTX tracks; screenshot remains the default so `/aoide/`
WYSIWYG is unchanged.

| Track | When | What you get |
|---|---|---|
| **WYSIWYG (default)** | no flag | Playwright PNG per slide → full-bleed image PPTX (`exportDeckPptxWysiwyg`) |
| **Editable objects (opt-in)** | env or API | `DeckSpec` → native title/bullet text frames, 16:9, word wrap on (`exportDeckPptxEditable`) |

Opt in **one** of:

```bash
# env — generate-deck / exportProject PPTX uses native text frames
AUTOOFFICE_PPTX_EDITABLE=1
```

```ts
import { exportDeckPptxEditable } from './src/engine/export/editable-pptx.js';
await exportDeckPptxEditable(spec, '/tmp/deck.pptx');
// or: svc.exportProject(id, 'pptx', { editable: true })
```

Do not set the env in ordinary preview/export tests: the default path must stay
screenshot WYSIWYG. This wrap still does **not** drive live PowerPoint; the
opt-in only changes AutoOffice’s file export.

| Server id | Vendor script | Role |
|---|---|---|
| `ao-drawio-live` | `scripts/live-server.mjs` | CDP → live canvas (`drawio_live_*`) |
| `ao-drawio-files` | `scripts/server.mjs` | validate / inspect / export `.drawio` |
| `ao-powerpoint-live` | `scripts/powerpoint-server.mjs` | PPT / WPS objects (optional here) |

Vendor catalog (relative `cwd="."`):
`vendor/scientific-illustrator/plugins/scientific-illustrator/.mcp.json`.

---

## Prerequisites

| Need | Why |
|---|---|
| **draw.io Desktop** | Live canvas + file export. Cask artifact is `/Applications/draw.io.app`. |
| Node **≥22** | Upstream `engines` for the three servers. |
| Vendor pin | `vendor/scientific-illustrator` submodule (U9). |
| PolarPort `:11050` | Optional. Claim CDP **9330** or **9335** when AutoOffice owns the launch. |

Install Desktop if missing:

```bash
brew install --cask drawio
test -x /Applications/draw.io.app/Contents/MacOS/draw.io
```

If the binary lives elsewhere, set `DRAWIO_PATH` in the MCP env (do not invent a second app name).

---

## Enable in Cursor

1. Copy the wrap file to the **project** MCP entry (`.cursor/` is gitignored):

   ```bash
   cp integrations/scientific-illustrator/mcp.autooffice.json .cursor/mcp.json
   ```

   A committed twin lives at `.cursor/mcp.json.example` (same JSON). Do not
   overwrite an existing user `.cursor/mcp.json` without merging.

2. Cursor → Settings → MCP → confirm `ao-drawio-live`, `ao-drawio-files`,
   `ao-powerpoint-live` are listed. Reload the window if they do not appear.

3. Cursor spawns the servers as **stdio children** of the IDE session. That is
   not a PolarProcess service. **Do not HTTP-wrap** these servers. An always-on
   HTTP MCP or Office.js bridge **is** a persistent listener and must go through
   PolarProcess + PolarPort (not this wrap).

4. After a live session, close via `drawio_live_close_session` /
   `powerpoint_close_presentation` (`confirm=true`). Never `pkill` / `killall`
   draw.io or PowerPoint.

---

## Ports (PolarPort-safe)

Vendor default CDP port is **9333** (illegal for PolarPort: must end in 0 or 5)
and `live-server.mjs` **silently increments** (`findAvailablePort`) when
`drawio_live_launch` is called **without** `port` and 9333/9330 is busy.

AutoOffice wrap pins:

| Preferred | When |
|---|---|
| **9330** | Default `DRAWIO_LIVE_PORT` in `mcp.autooffice.json` |
| **9335** | Only if PolarPort rejects 9330; update MCP env to the claimed value |

No silent `port++`. If 9330 is occupied by a non-draw.io process, pass
`port: 9330` on `drawio_live_launch` so vendor **throws** instead of walking to
9331. Then claim **9335** and set `DRAWIO_LIVE_PORT=9335`.

### PolarPort available

Health check (this host uses `/api/health`; `/health` is 404):

```bash
curl -fsS --max-time 3 http://127.0.0.1:11050/api/health
```

Claim before a live launch you own:

```bash
source ~/Polarisor/Agent_core/scripts/port-claim.sh
PORT=$(claim_port "ao-drawio-live" "AutoOffice" 9330)
# if PolarPort rejects 9330:
# PORT=$(claim_port "ao-drawio-live" "AutoOffice" 9335)
# then set DRAWIO_LIVE_PORT=$PORT in .cursor/mcp.json and reload MCP
```

`claim_port` has no heartbeat. It is a reservation for the draw.io CDP port,
not a license to run a daemon. Do not `nohup` / background the MCP process.

Office.js loopback **17645** (ends in 5) is vendor-hardcoded. Only start it as a
long-lived service after PolarPort claim + PolarProcess register. This wrap
does not start Office.js.

### PolarPort unavailable (`polarport_unavailable`)

Keep `DRAWIO_LIVE_PORT=9330`. Do not invent another port. Do not launch a
long-lived CDP/HTTP bridge. File-only `ao-drawio-files` (validate / inspect)
still works once Desktop is installed. Same spirit as `budget_unavailable`:
continue the one-shot path, do not stand up a second process manager.

---

## Smoke (one-shot, no servers left running)

```bash
integrations/scientific-illustrator/smoke-drawio.sh
```

Checks Desktop exists, vendor `.mcp.json` script paths resolve, wrap JSON
points at those scripts, and PolarPort health (non-fatal). It does **not**
spawn `live-server.mjs` / `server.mjs` / `powerpoint-server.mjs`.

---

## PolarManager

| Thing | Rule |
|---|---|
| MCP stdio | Cursor-spawned, session-scoped — OK |
| HTTP MCP / always-on bridge | Forbidden unless PolarProcess + PolarPort |
| draw.io CDP | Claim **9330** or **9335**; no 9333; no silent increment |
| GUI apps | Close via MCP tools; never `pkill` / `killall` |
| Secrets | None in this plugin; LLM still PolarPrivate `:12790` |
