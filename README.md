# AutoOffice

AI-grade report generation without AI flavor. Part of the [Polarisor](https://github.com/beichenO2/Polarisor) ecosystem.

```bash
# Install via Polarisor ecosystem
git clone https://github.com/beichenO2/Polarisor.git && cd Polarisor && ./install.sh auto-office

# Or standalone
git clone https://github.com/beichenO2/AutoOffice.git && cd AutoOffice && npm install
```

## Features

- **5 Format Report Generation** — PPT, PDF, Word, LaTeX, HTML from structured JSON data
- **Content Analysis & Routing** — Parse any input → evaluate → route to LLMWiki or KnowLeverage
- **De-AI Flavor Processing** — 50+ rules (Chinese + English) strip AI-typical phrasing
- **Monotony Detection** — Statistical analysis of sentence/paragraph patterns
- **Mermaid Diagrams** — Auto-generate and render architecture diagrams
- **Batch Processing** — Generate multiple format outputs in parallel
- **Template Gallery** — Business report, academic paper, slide deck presets
- **External Tool Discovery** — Detect OfficeCLI/Pandoc/LibreOffice-style helpers and recommend format engines
- **Cross-Project Integration** — KnowLeverage RAG enrichment, LLMWiki scaffolding

## Quick Start

```bash
npm install
npm run build

# Generate a report
node dist/cli.js generate -f html -i data.json -o report.html

# Analyze content
node dist/cli.js summarize -t "# Topic\n\n## Section\n\nContent here"

# Batch generate
node dist/cli.js batch -i data.json -f pdf,docx,html -d output/

# Inspect external office automation tools
node dist/cli.js tools

# Start API server
node dist/cli.js serve -p 3900
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `generate` | Generate report from JSON (pptx/pdf/docx/latex/html) |
| `summarize` | Parse + evaluate + Mermaid diagram + routing |
| `batch` | Multi-format parallel generation |
| `enrich` | Enhance content via KnowLeverage RAG |
| `wiki` | Create LLMWiki project scaffold |
| `tools` | Detect external office tools and format recommendations |
| `templates` | List available report templates |
| `serve` | Start HTTP API server |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/generate` | POST | Generate report |
| `/api/summarize` | POST | Content analysis + routing |
| `/api/enrich` | POST | RAG content enrichment |
| `/api/wiki` | POST | Wiki scaffold generation |
| `/api/tools` | GET | External office tool detection + recommendations |
| `/api/templates` | GET | Template gallery |
| `/api/formats` | GET | Supported formats |
| `/health` | GET | Health check |

## Testing

```bash
npm test          # 125 tests, 21 files
npm run test:watch  # Watch mode
```

## Architecture

```
src/
├── batch/         Parallel multi-format generation
├── chart/         Mermaid rendering (mmdc → kroki → HTML fallback)
├── docx/          Word report adapter + python-docx bridge
├── format/        Report pipeline + format adapters
├── integrations/  KnowLeverage RAG + LLMWiki scaffold
├── latex/         LaTeX adapter + xelatex bridge
├── pdf/           PDF adapter + WeasyPrint bridge
├── ppt/           PPT adapter + python-pptx bridge
├── summarize/     Content parsing + evaluation + routing + handoff
├── templates/     Template gallery
├── text/          De-AI flavor + monotony detection
└── workflow/      gsd-2 document workflow config
```

## Integration with Polarisor Ecosystem

AutoOffice can work standalone, but integrates with:
- [KnowLever](https://github.com/beichenO2/KnowLever) — RAG content enrichment for reports
- [PolarPrivate](https://github.com/beichenO2/PolarPrivate) — LLM proxy for de-AI and summarization

## License

MIT
