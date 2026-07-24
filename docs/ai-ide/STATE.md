# AutoOffice AI Document IDE — Project State

> Canonical worktree: `~/Polarisor/AutoOffice`  
> Last verified: 2026-07-24 — `npm run build` + `npx vitest run` (453+ tests)

## Goal

Evolve AutoOffice from batch report generation into a **document intelligence engine** with a three-pane IDE (history / document canvas / agent chat), box-select editing with source mapping, revisions/undo, and demo-only standards preflight.

## Acceptance Criteria (A–H)

| ID | Requirement | Status | Evidence |
|----|-------------|--------|----------|
| A | Three-pane Liquid Glass UI at `/aoide/` | **DONE** | `public/aoide/*`, static mount in `src/engine/routes.ts` |
| B | Agent runtime: projects, tasks, revisions, events, proposals | **DONE** | `src/engine/{types,store,repo,service,orchestrator}.ts` |
| C | PDF loop: NL → LaTeX → compile → annotate → patch → recompile → undo | **DONE** | `src/engine/latex/*`, `tests/engine/e2e-engine.test.ts` (xelatex gated) |
| D | PPT/HTML loop: NL → deck → box edit → re-render → undo → export | **DONE** | `src/engine/html/*`, `src/engine/render/deck.ts`, E2E presentation test |
| E | Standards Engine (Demo/Fixture only, no fake 国标) | **DONE** | `src/engine/standards/*`, profiles labeled Demo in fixtures |
| F | Render sandbox: path confinement, timeout, no shell-escape default | **DONE** | `src/engine/latex/compile.ts`, `tests/engine/security.test.ts` |
| G | Express `/api/engine/*` wired into server | **DONE** | `src/engine/routes.ts`, `src/server.ts`, `tests/engine/api-routes.test.ts` |
| H | Docs + requirement traceability | **DONE** | This file + README engine section (below) |

## Verification Commands

```bash
cd ~/Polarisor/AutoOffice
npm ci
npm run build
npx vitest run
```

Optional (requires `xelatex`): PDF E2E in `tests/engine/e2e-engine.test.ts`.

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
| Format adapters (pptx/pdf/docx/latex/html) | Render backends | **MIGRATED** — reused by engine orchestrator |
| `/api/engine/*` | IDE persistence + edit loops | **NEW** |

## Known Gaps / NOT RUN

- Real LLM Requirement Interpreter — **DONE** via `src/engine/brief.ts` + LLM Proxy (`AUTOOFFICE_ENGINE_INTERPRETER=auto|llm|deterministic`); offline/tests use deterministic
- SyncTeX reverse lookup under load — unit-tested resolver; full pixel-accuracy E2E **partial**
- Playwright visual regression screenshots (9 UI states) — demo mode available (`?demo=1&state=…`); run `npm run test:visual-states:update` once to seed baselines, then `npm run test:visual-states`
- `src/engine/pdf/*` duplicate helpers — unused; safe to delete in cleanup pass

## Architecture Map

```
public/aoide/          Three-pane SPA
src/engine/routes.ts   HTTP + static
src/engine/service.ts  Facade
src/engine/orchestrator.ts  Pipelines
src/engine/latex/    PDF source + compile
src/engine/html/     Deck source + DOM edit
src/engine/standards/ Demo preflight
~/.autooffice/engine/  JSON persistence (override: AUTOOFFICE_ENGINE_HOME)
```
