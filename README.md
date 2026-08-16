# AutoOffice

An AI document IDE — box-select any element, say what you want in plain language, and the
change lands in the text source. Plus the original headless report pipeline, still intact.
Part of the [Polarisor](https://github.com/beichenO2/Polarisor) ecosystem.

```bash
# Via the Polarisor ecosystem
git clone https://github.com/beichenO2/Polarisor.git && cd Polarisor && ./install.sh auto-office
# Or standalone
git clone https://github.com/beichenO2/AutoOffice.git && cd AutoOffice && npm ci
```

## Features

### Document IDE (`aoide` engine, served at `/aoide/`)

- **Topic → Editable Deck** — one `POST /api/engine/decks` with a topic produces a full deck;
  outline, authoritative guidance, pre-chosen images, LaTeX formulas and step animation are
  optional. Authoring goes through the PolarPrivate LLM proxy; without it a deterministic
  fallback still produces a real deck.
- **Box-Select AI Editing** — click a highlighted hotspot or drag a box around any element,
  type an instruction, and the engine patches the text source surgically. Deck previews give
  every element a stable `data-ao-id` and a source range; LaTeX projects address nodes through
  `\aoNode` markers and a SyncTeX map. Either way an edit touches one node and commits a
  revision with undo, redo and a change summary.
- **Scope-Aware Routing** — a literal "change it to X" is a deterministic replacement; a
  free-form rewrite stays on the framed node; a color or style word restyles the whole deck;
  "replace every A with B" is a deck-wide term swap (image `alt` included); a vague deck-wide
  tone request becomes a multi-node semantic rewrite; element tweaks (center, bold, size) go
  through a style whitelist.
- **Deck Style Packs** — `tech`, `gov`, `business`, `academic`, `minimal`, each changing layout
  rather than palette alone: `gov` borrows the visual signatures of GB/T 9704-2012 official
  documents (red rule, centered serif title, numbered hierarchy — not the full A4 standard),
  `academic` uses numbered badges, `minimal` is title-dominant, `tech` is a hero figure,
  `business` a consulting header bar. Chinese aliases (科技风, 党政风, 国标, 顶会…) resolve to
  the same packs, in frontmatter or in a box-select instruction.
- **Text Source of Truth** — presentations are Slidev `slides.md`, rendered to a deterministic
  self-contained preview HTML; PDF projects are LaTeX `main.tex` compiled by `xelatex` and
  previewed as the PDF itself. Both carry a box map of selectable coordinates.
- **WYSIWYG Deck Export** — deck PDF is a vector Chromium print of the exact preview HTML, so
  text stays selectable and the file stays small. `?clicks=1` expands each `v-click` step into
  its own page; default PPTX is image-based, full-bleed, matching the preview. Set
  `AUTOOFFICE_PPTX_EDITABLE=1` for an opt-in native-text PPTX (title/bullet frames, 16:9).
  LaTeX projects export their compiled PDF directly.
- **Data Grounding** — percentages, decimals and multi-digit numbers in the generated copy are
  string-checked against the supplied research and guidance and reported back when unsourced
  (single digits, formulas and images exempt).
- **Adaptive Layout** — figure sizing follows content density; over-dense slides wrap, tighten
  type, and **paginate** (`paginateDeckSpec`, theme / line-budget) instead of truncating body
  copy. Continuation titles use `（2/N）`. Optional editable PPTX: `AUTOOFFICE_PPTX_EDITABLE=1`.
- **Desktop App** — `npm run app` for development, `npm run app:dist` for a `dmg` in `release/`.
  The desktop app bundles its own API child process on a random localhost port — a packaging
  exception that lives outside PolarManager governance.
- **Scientific figures** — a parallel track: deck SoT stays Slidev `slides.md`; figure SoT is a
  standalone `.drawio` (native mxGraph objects). `POST /api/engine/figures` (`:3900`, PolarProcess
  `autooffice`) takes required `prompt`, optional `sketch: { mime, data }` (raw base64, no `data:`
  prefix), and optional `attachToProjectId` / `attachPage` (1-based) to hang on existing
  presentation media — no new project kind. Designer uses PolarPrivate **V0000** (the sketch is
  understood, never pasted whole); Drawer writes an uncompressed 1600×900 mxfile; Audit hard-fails
  `whole-sketch-raster`. No DALL·E / Flux / Midjourney / AutoFigure. A preview, if present, is a
  draw.io Desktop CLI export; this slice does not require `previewPath`. Skill:
  `PolarSkills/ao-scientific-figure/SKILL.md`.

### Report Pipeline

- **5 Format Report Generation** — PPT, PDF, Word, LaTeX, HTML from structured JSON data
- **Content Analysis & Routing** — Parse any input → evaluate → route to LLMWiki or KnowLeverage
- **De-AI Flavor Processing** — 50+ rules (Chinese + English) strip AI-typical phrasing, with
  statistical monotony detection over sentence and paragraph patterns
- **Mermaid Diagrams** — Auto-generate and render architecture diagrams
- **VLM Visual Quality** — Local vision model scores rendered document pages
- **Batch & Templates** — Parallel multi-format output; business, academic and deck presets
- **External Tools & Integration** — Detect OfficeCLI/Pandoc/LibreOffice-style helpers;
  KnowLeverage RAG enrichment and LLMWiki scaffolding

## Quick Start

```bash
npm run build

# Start the persistent API through PolarProcess, then open the IDE at :3900/aoide/
bash scripts/register-runtime.sh finalize
curl -fsS -X POST http://127.0.0.1:11055/api/services/autooffice/start

# One-click deck from a topic
curl -fsS -X POST http://127.0.0.1:3900/api/engine/decks -H 'Content-Type: application/json' \
  -d '{"topic":"Retrieval-augmented generation in production","slides":8,"animate":true}'

# Same thing from the CLI, with a vector PDF written next to the preview
node dist/cli.js generate-deck --topic "RAG in production" \
  --guidance facts.md --animate --out out/ --export pdf

# Scientific figure → standalone .drawio (PolarPrivate V0000; sketch optional, never pasted)
curl -fsS -X POST http://127.0.0.1:3900/api/engine/figures -H 'Content-Type: application/json' \
  -d '{"prompt":"Three-layer neural net: input, hidden, output, labeled arrows"}'

# Report pipeline
node dist/cli.js batch -i data.json -f pdf,docx,html -d output/
```

PolarProcess is the only API lifecycle authority and PolarPort is the only port authority.
Do not run `serve` directly, background it, or manage it with PID files. The production
service is `autooffice` on `:3900`; the isolated agent preview is `autooffice-agent-preview`
on `:3905`. Both serve `/api/engine/*` and `/aoide/`.

## Docs & repository layout

SSoT map: [`docs/ssot.md`](docs/ssot.md). Docs index: [`docs/README.md`](docs/README.md).

Keep the root small (`src/` `tests/` `docs/` `_design/` `_report/` `deploy/` `integrations/`
`vendor/` …). Planning and sessions live under `docs/`. Presenton is optional (`deploy/` +
`PRESENTON_URL`), not vendored. Draw.io wrap: `integrations/scientific-illustrator/` around
the `vendor/scientific-illustrator` pin. Lobster events: `logs/lobster/events.jsonl`.

## CLI Commands

| Command | Description |
|---------|-------------|
| `generate-deck` | Topic → editable deck; `--research/--outline/--guidance/--image/--formulas/--animate/--export` |
| `generate` | Generate report from JSON (pptx/pdf/docx/latex/latex-pdf/html) |
| `batch` | Multi-format parallel generation |
| `summarize` | Parse + evaluate + Mermaid diagram + routing |
| `quality` / `humanize` | De-AI, monotony and diversity scoring; adversarial de-AI rewriting |
| `html-to-pdf` / `to-markdown` | Styled HTML → PDF via Chromium; PDF/DOCX/PPTX → Markdown |
| `enrich` / `wiki` | KnowLeverage RAG enrichment (opt-in, archived v1 path); LLMWiki scaffold |
| `tools` / `templates` | External tool detection; template gallery |
| `serve` | Start HTTP API server (PolarProcess only) |

## API Endpoints

### Engine (`/api/engine`)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/decks` | POST | Topic → deck; returns project, revision and grounding report |
| `/figures` | POST | Text + optional sketch → audited `.drawio` (PolarPrivate V0000); optional attach to an existing presentation |
| `/projects` | GET, POST | List projects; create a `pdf` / `presentation` project |
| `/projects/:id/overview` | GET | Head state, revision timeline, annotations |
| `/projects/:id/annotations` | POST | Box-select edit: normalized rect + instruction |
| `/projects/:id/images` | POST | Insert an image element (upload, URL, or color card) |
| `/projects/:id/requirements`, `…/events` | POST, GET | Post a free-form requirement; read the event stream |
| `/projects/:id/undo`, `/redo` | POST | Non-destructive history navigation |
| `/projects/:id/export` | GET | `?format=pdf\|pptx\|html` — decks: vector PDF / bitmap PPTX / `slides.md` source; LaTeX projects: the compiled PDF. `?clicks=1` for step animation |
| `/revisions/:id/render` | GET | Rendered preview (HTML for decks, PDF for LaTeX projects) |
| `/revisions/:id/boxes` | GET | Box map for a page: selectable element coordinates |
| `/revisions/:id/diff` | GET | Change summary: base revision, changed node ids, patch summary |
| `/tasks/:id`, `/tasks/:id/cancel` | GET, POST | Long-running task state and cancellation |
| `/proposals/:id/choose` | POST | Pick one option from a proposed edit set |
| `/standards/profiles`, `/projects/:id/standard-profile` | GET, PUT | List and bind document standard profiles |

### Report pipeline

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/generate`, `/api/generate/ai` | POST | Generate report; AI presentation (LLM proxy or Presenton) |
| `/api/summarize`, `/api/enrich` | POST | Content analysis + routing; RAG enrichment |
| `/api/quality` | POST | De-AI + monotony + diversity report |
| `/api/visual-qa` | POST | VLM visual quality evaluation |
| `/api/ocr`, `/api/wiki` | POST | VLM OCR for PDF/image → text/LaTeX; wiki scaffold generation |
| `/api/tools` | GET | External office tool detection + recommendations |
| `/api/templates`, `/api/templates/:id` | GET, POST, PUT, DELETE | Template gallery (item routes on `/:id`) |
| `/api/formats`, `/health` | GET | Supported formats; health check |

## Testing

```bash
npm run build && npm test
```

The full suite spans unit, contract, visual-baseline (pixel), browser E2E (Playwright), and
real `xelatex` / Slidev / LLM integration tests.

## Architecture

```
src/
├── engine/        AI document IDE (aoide)
│   ├── slidev/      slides.md as source of truth: generate, parse, patch, source map
│   ├── figure/      scientific figure track: Designer → Drawer → Audit → standalone .drawio
│   ├── latex/       LaTeX source: \aoNode generation, patching, xelatex compile
│   ├── html/        self-contained preview HTML, MathML formulas, hit testing
│   ├── render/      Chromium render, vector PDF and image-based PPTX export
│   ├── standards/   document standard profiles + preflight
│   ├── skills.ts    deterministic edit-scope classifier (deck vs. local)
│   ├── llm-*.ts     DeckSpec authoring + surgical edit patches via LLM proxy
│   └── routes.ts    /api/engine/* routes + /aoide/ static UI
├── batch/         Parallel multi-format generation
├── chart/         Mermaid rendering (mmdc → kroki → HTML fallback)
├── docx/          Word report adapter (docx library)
├── format/        Report pipeline + format adapters
├── integrations/  KnowLeverage RAG, LLMWiki, LLM proxy, VLM OCR / visual QA
├── latex/         LaTeX adapter + xelatex runner
├── pdf/           PDF adapter (Playwright / headless Chromium)
├── ppt/           PPT adapter (PptxGenJS)
├── summarize/     Content parsing + evaluation + routing + handoff
├── templates/     Template gallery
├── text/          De-AI flavor + monotony detection
└── workflow/      gsd-2 document workflow config
```

PPT, Word, PDF and HTML generation plus the whole aoide engine are pure Node.js. The report
pipeline's `latex` / `latex-pdf` formats still shell out to a Python template helper
(`tools/latexgen/build_latex.py`) and require a system `xelatex`; converging that helper to
TypeScript is on the roadmap.

## Integration with Polarisor Ecosystem

AutoOffice works standalone, but integrates with
[KnowLever](https://github.com/beichenO2/KnowLever) for RAG content enrichment and
[PolarPrivate](https://github.com/beichenO2/PolarPrivate) for the LLM proxy that backs deck
authoring, box-select editing, and scientific-figure Designer (**V0000** visual QCSA; de-AI
processing is local rule-based, no LLM involved).

## License

MIT
