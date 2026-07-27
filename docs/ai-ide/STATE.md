# AutoOffice IDE Engine — Project State

> Canonical worktree: `~/Polarisor/AutoOffice`  
> Last verified: 2026-07-27 — `npm run build` + `npm test` → **546 passed, 1 skipped** (547 total)

## Goal

Evolve AutoOffice from batch report generation into a **document intelligence engine** with a three-pane IDE (history / document canvas / agent chat), box-select editing with source mapping, revisions/undo, and demo-only standards preflight.

## Acceptance Criteria (A–H)

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| A | Three-pane Liquid Glass UI at `/aoide/` | **DONE** | `public/aoide/*`, static mount in `src/engine/routes.ts` |
| B | Agent runtime: projects, tasks, revisions, events, proposals | **DONE** | `src/engine/{types,store,repo,service,orchestrator}.ts` |
| C | PDF loop: NL → LaTeX → compile → annotate → patch → recompile → undo | **DONE** | `tests/engine/e2e-engine.test.ts` (service + SEC-5 rebuild); `tests/engine/annotate-browser.test.ts` (PDF iframe drag) |
| D | PPT loop: NL → deck → box edit → re-render → undo → export | **DONE** | Slidev SoT svc + browser E2E; legacy HTML in `e2e-engine.test.ts`; CLI build test skipped until `npm install` |
| E | Standards Engine (Demo/Fixture only, no fake 国标) | **DONE** | `src/engine/standards/*`, profiles labeled Demo in fixtures |
| F | Render sandbox: path confinement, timeout, no shell-escape default | **DONE** | `src/engine/latex/compile.ts`, `src/engine/slidev/cli.ts`, `tests/engine/security.test.ts` |
| G | Express `/api/engine/*` wired into server | **DONE** | `src/engine/routes.ts`, `src/server.ts`, `tests/engine/api-routes.test.ts` |
| H | Docs + requirement traceability | **DONE** | This file + `.planning/ide-engine/COVERAGE.md` |

### AD6 / AD8 (Presentation engine)

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| AD6 | Slidev (`slides.md`) as PPT source-of-truth | **PARTIAL** | Unit + svc + browser E2E pass via preview HTML; **`slidev build` integration skipped** until `@slidev/cli` installs |
| AD8 | Legacy HTML + pptxgenjs compatibility bridge | **DONE** | `AUTOOFFICE_PPT_SOT=html`; `exportDeckPptxImageFallback`; `/api/generate` unchanged |

**PPTX disclosure:** Slidev `slidev export --format pptx` produces **image-based** slides — text is **not selectable** in PowerPoint. Legacy HTML path uses the same pptxgenjs image fallback.

## Verification Commands

```bash
cd ~/Polarisor/AutoOffice
npm ci
npm run build
npx vitest run tests/engine/slidev-bridge.test.ts
AUTOOFFICE_PPT_SOT=html npx vitest run tests/engine/e2e-engine.test.ts
npx vitest run
npm run test:visual-states
```

Latest full run (2026-07-27): **67 files, 546 passed, 1 skipped** (`slidev build` integration skipped when CLI unavailable).

Requires `xelatex` for PDF E2E (`tests/engine/e2e-engine.test.ts`, PDF row in `tests/engine/annotate-browser.test.ts`).

Playwright: `PLAYWRIGHT_BROWSERS_PATH=~/Library/Caches/ms-playwright` on macOS.

**Slidev export:** requires `@slidev/cli` + `playwright-chromium`. Reuse existing Playwright browsers via `PLAYWRIGHT_BROWSERS_PATH` (default: `~/Library/Caches/ms-playwright` on macOS). Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to avoid re-downloading.

Production serve uses PolarProcess/PolarPort; tests use `AUTOOFFICE_DIRECT_PORT=1` hatch (see `tests/server.test.ts`).

## Legacy Tool Migration

| Surface | Role in IDE era | Disposition |
|---------|-----------------|-------------|
| `POST /api/generate` | One-shot multi-format reports | **KEPT** — batch/export bridge |
| `POST /api/summarize` | Content routing | **KEPT** — upstream of brief interpreter |
| `POST /api/enrich` | RAG enrichment | **KEPT** |
| `POST /api/quality` | Text quality | **KEPT** |
| `POST /api/wiki` | LLMWiki scaffold | **KEPT** |
| `POST /api/generate/ai` | Presenton AI PPT | **BRIDGED** — parallel to engine deck gen |
| `POST /api/visual-qa` | VLM document QA | **KEPT** — verification adjunct |
| `POST /api/ocr` | VLM OCR | **KEPT** — material ingestion |
| `POST /api/normalize-formulas` | Math normalization | **KEPT** |
| Templates CRUD | Gallery | **KEPT** |
| Lobster endpoints | Observability | **KEPT** |
| Format adapters (pptx/pdf/docx/latex/html) | Render backends | **MIGRATED** — Slidev preferred; HTML/pptxgenjs legacy |
| `/api/engine/*` | IDE persistence + edit loops | **NEW** |

## Known Gaps / NOT RUN

- `@slidev/cli` npm install — **BLOCKED** (ECONNRESET to registry.npmjs.org 2026-07-27); preview HTML + unit/svc/browser E2E pass without CLI
- Slidev `slidev build` integration test — **skipped** until CLI installed
- Real LLM Requirement Interpreter — **DONE** via `src/engine/brief.ts` + LLM Proxy (`AUTOOFFICE_ENGINE_INTERPRETER=auto|llm|deterministic`); offline/tests use deterministic
- SyncTeX reverse lookup under load — unit-tested resolver; full pixel-accuracy E2E **partial**
- Playwright visual regression (9 UI states) — **DONE** — baselines in `tests/engine/visual-baseline/`; `npm run test:visual-states`
- iframe load/error/timeout — **DONE** — `tests/engine/render-surface.test.ts` (4 tests)
- `@slidev/cli` in package.json — **install required** (`npm ci`) before CLI integration; unit tests pass without CLI
- `src/engine/pdf/*` duplicate helpers — unused; safe to delete in cleanup pass

## Architecture Map

```
public/aoide/          Three-pane SPA
src/engine/routes.ts   HTTP + static
src/engine/service.ts  Facade
src/engine/orchestrator.ts  Pipelines (Slidev default for PPT)
src/engine/slidev/     slides.md SoT — generate, cli, sourcemap, edit
src/engine/latex/      PDF source + compile
src/engine/html/       Legacy deck source + DOM edit (AUTOOFFICE_PPT_SOT=html)
src/engine/render/deck.ts  Playwright measure + pptxgenjs legacy export
src/engine/standards/  Demo preflight
~/.autooffice/engine/  JSON persistence (override: AUTOOFFICE_ENGINE_HOME)
```

**Env:** `AUTOOFFICE_PPT_SOT=slidev|html` (default: slidev when deps installed, else html)
