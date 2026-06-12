import http from 'node:http';
import express from 'express';
import { JSDOM } from 'jsdom';
import DOMPurify from 'dompurify';
import { autoConvertPayload, isSupportedGenerateFormat } from './format/generic-report-data.js';
import { runReportPipeline } from './format/pipeline.js';
import { registerFormatAdapters } from './format/format-adapters.js';
import { summarize } from './summarize/pipeline.js';
import { normalizeRawInputs } from './summarize/parser.js';
import { listTemplates, getTemplateSource, getTemplate, addCustomTemplate, updateCustomTemplate, deleteCustomTemplate } from './templates/gallery.js';
import type { AddTemplateInput } from './templates/gallery.js';
import { enrichWithRAG, normalizePositiveIntegerOption } from './integrations/knowleverage.js';
import { createWikiScaffold } from './integrations/llmwiki.js';
import { buildExternalToolsSummary, detectExternalTools } from './integrations/external-tools.js';
import { analyzeQuality } from './text/quality.js';
import { resolveApiWikiOutputDir } from './wiki-output.js';
import { checkPresentonHealth, generateAndExportPptx } from './integrations/presenton.js';
import type { PresentonGenerateInput } from './integrations/presenton.js';
import { generateAiPptPayload } from './ppt/ai-generate.js';
import type { AiPptInput } from './ppt/ai-generate.js';
import { checkLlmProxyHealth } from './integrations/llm-proxy.js';
import { evaluateDocumentVisual, checkVisualQABackends } from './integrations/visual-qa.js';
import type { VisualQAOptions } from './integrations/visual-qa.js';
import { injectPolarDesignCss, resolveDesignSystemFromPayload } from './integrations/polar-design-bridge.js';
import { AUTOOFFICE_NAME, AUTOOFFICE_VERSION, SUPPORTED_GENERATE_FORMATS } from './index.js';
import { emitLobsterEvent } from './lobster/emitter.js';
import { getLobsterStatus, getLobsterHealth, runLobsterTest } from './lobster/adapter.js';
import { detectBackend, ocrImage, ocrPdf } from './integrations/vlm-ocr.js';
import { normalizeFormulas, detectMathCandidates } from './integrations/normalize-formulas.js';
import type { RawInput } from './summarize/types.js';

function emitServerError(endpoint: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  emitLobsterEvent('bug', 'warning', {
    message,
    context: 'server',
    endpoint,
  }).catch(() => {});
}

const purifyWindow = new JSDOM('').window;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const purify = DOMPurify(purifyWindow as any);

export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    ADD_TAGS: ['style'],
    ADD_ATTR: ['class', 'style', 'lang'],
    WHOLE_DOCUMENT: true,
  });
}

function setupAdapters(): void {
  registerFormatAdapters();
}

const MIME_MAP: Record<string, string> = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  latex: 'application/x-latex',
  'latex-pdf': 'application/pdf',
  html: 'text/html',
};

const HEALTH_DEPENDENCY_PROBE_MS = 8000;

/** HTTP API — bind port from CLI (`serve -p`) or `PORT` env (see cli `serve` command). */
export function startServer(port: number = 3900): void {
  setupAdapters();
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get(['/health', '/api/health'], async (_req, res) => {
    const body: Record<string, unknown> = {
      status: 'ok',
      service: AUTOOFFICE_NAME,
      version: AUTOOFFICE_VERSION,
    };
    try {
      const report = await Promise.race([
        detectExternalTools(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('dependency probe timeout')), HEALTH_DEPENDENCY_PROBE_MS);
        }),
      ]);
      const checks: Record<string, { ok: boolean; error?: string }> = {};
      for (const tool of report.tools) {
        checks[tool.name] = tool.available ? { ok: true } : { ok: false, error: 'unavailable' };
      }
      body.checks = checks;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      body.checks = {
        external_tools: { ok: false, error: message },
      };
    }
    res.json(body);
  });

  app.get('/api/formats', (_req, res) => {
    res.json({ formats: [...SUPPORTED_GENERATE_FORMATS] });
  });

  app.get('/api/tools', async (_req, res) => {
    try {
      res.json(await buildExternalToolsSummary());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/templates', (_req, res) => {
    res.json({ templates: listTemplates() });
  });

  app.get('/api/templates/:id', (req, res) => {
    const tpl = getTemplate(req.params.id);
    if (!tpl) {
      res.status(404).json({ error: `Template not found: ${req.params.id}` });
      return;
    }
    res.json({ id: tpl.id, name: tpl.name, format: tpl.format, locale: tpl.locale, custom: tpl.custom ?? false, source: tpl.source });
  });

  app.post('/api/templates', (req, res) => {
    try {
      const input = req.body as AddTemplateInput;
      if (!input.id || !input.name || !input.source) {
        res.status(400).json({ error: 'Missing required fields: id, name, source' });
        return;
      }
      const tpl = addCustomTemplate(input);
      res.status(201).json({ ok: true, template: { id: tpl.id, name: tpl.name, format: tpl.format, custom: true } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  app.put('/api/templates/:id', (req, res) => {
    try {
      const tpl = updateCustomTemplate(req.params.id, req.body);
      res.json({ ok: true, template: { id: tpl.id, name: tpl.name, format: tpl.format } });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(err instanceof Error && message.includes('not found') ? 404 : 400).json({ error: message });
    }
  });

  app.delete('/api/templates/:id', (req, res) => {
    const deleted = deleteCustomTemplate(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: `Custom template not found: ${req.params.id}` });
      return;
    }
    res.json({ ok: true, deleted: req.params.id });
  });

  app.post('/api/generate', async (req, res) => {
    try {
      const { format, data, template, locale } = req.body;
      if (!format || !data) {
        res.status(400).json({ error: 'Missing required fields: format, data' });
        return;
      }
      if (!isSupportedGenerateFormat(format)) {
        res.status(400).json({ error: `Unsupported format: ${format}` });
        return;
      }

      const resolvedLocale = locale || 'zh-CN';
      const normalizedData = autoConvertPayload(data as Record<string, unknown>, format, resolvedLocale);
      const designSystem = resolveDesignSystemFromPayload(normalizedData as Record<string, unknown>);

      const tpl = template
        ? { kind: 'inline' as const, source: template }
        : { kind: 'inline' as const, source: '<html><body>{{#each sections}}<h2>{{title}}</h2><p>{{content}}</p>{{/each}}</body></html>' };

      const artifact = await runReportPipeline({
        format,
        data: normalizedData,
        template: tpl,
        locale: resolvedLocale,
      });

      const mime = MIME_MAP[format] || 'application/octet-stream';
      let finalBody = artifact.encoding === 'utf-8' ? artifact.body : artifact.body;
      if (format === 'html' && designSystem && artifact.encoding === 'utf-8') {
        finalBody = injectPolarDesignCss(String(finalBody), designSystem);
      }
      if (format === 'html' && artifact.encoding === 'utf-8') {
        finalBody = sanitizeHtml(String(finalBody));
      } else if (format === 'html') {
        finalBody = String(finalBody);
      }
      const buf = artifact.encoding === 'base64'
        ? Buffer.from(finalBody, 'base64')
        : Buffer.from(finalBody, 'utf-8');

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `attachment; filename="report.${format}"`);
      res.send(buf);
    } catch (err: unknown) {
      emitServerError('/api/generate', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/summarize', async (req, res) => {
    try {
      const { inputs } = req.body as { inputs?: RawInput[] };
      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        res.status(400).json({ error: 'Missing or empty inputs array' });
        return;
      }

      const result = await summarize(normalizeRawInputs(inputs));
      res.json({
        route: result.evaluation.route,
        reason: result.evaluation.reason,
        totalWords: result.evaluation.totalWords,
        complexity: result.evaluation.complexity,
        mermaid: result.mermaid.code,
        concepts: result.mermaid.concepts,
        combinedMarkdown: result.combinedMarkdown,
        handoff: result.handoff,
      });
    } catch (err: unknown) {
      emitServerError('/api/summarize', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/enrich', async (req, res) => {
    try {
      const { markdown, maxQueries, topK } = req.body as { markdown?: string; maxQueries?: unknown; topK?: unknown };
      if (!markdown) {
        res.status(400).json({ error: 'Missing required field: markdown' });
        return;
      }
      const safeMaxQueries = normalizePositiveIntegerOption(maxQueries);
      const safeTopK = normalizePositiveIntegerOption(topK);
      const result = await enrichWithRAG(markdown, { maxQueries: safeMaxQueries, topK: safeTopK });
      res.json(result);
    } catch (err: unknown) {
      emitServerError('/api/enrich', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/quality', async (req, res) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text) {
        res.status(400).json({ error: 'Missing required field: text' });
        return;
      }
      const report = analyzeQuality(text);
      res.json({
        grade: report.grade,
        score: report.overallScore,
        wordCount: report.wordCount,
        aiFlavorCharsRemoved: report.aiFlavorDetected,
        monotonyScore: report.monotony.score,
        diversityScore: report.diversity.score,
        recommendations: report.recommendations,
        processedText: report.processedText,
      });
    } catch (err: unknown) {
      emitServerError('/api/quality', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/wiki', async (req, res) => {
    try {
      const { inputs, outputDir } = req.body as { inputs?: RawInput[]; outputDir?: string };
      if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
        res.status(400).json({ error: 'Missing or empty inputs array' });
        return;
      }
      if (!outputDir) {
        res.status(400).json({ error: 'Missing outputDir' });
        return;
      }
      let wikiOutputDir: string;
      try {
        wikiOutputDir = resolveApiWikiOutputDir(outputDir);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
        return;
      }
      const result = await summarize(normalizeRawInputs(inputs));
      const scaffold = await createWikiScaffold(result, wikiOutputDir);
      res.json(scaffold);
    } catch (err: unknown) {
      emitServerError('/api/wiki', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/generate/ai', async (req, res) => {
    try {
      const input = req.body as AiPptInput;
      if (!input.prompt) {
        res.status(400).json({ error: 'Missing required field: prompt' });
        return;
      }

      const backend = (req.query.backend as string) ?? 'llm-proxy';

      if (backend === 'presenton') {
        const pInput: PresentonGenerateInput = {
          prompt: input.prompt,
          numSlides: input.numSlides,
          tone: input.tone,
          language: input.language,
        };
        const { buffer, presentationId } = await generateAndExportPptx(pInput);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
        res.setHeader('Content-Disposition', `attachment; filename="ai-presentation.pptx"`);
        res.setHeader('X-Presentation-Id', presentationId);
        res.setHeader('X-Backend', 'presenton');
        res.send(buffer);
        return;
      }

      const payload = await generateAiPptPayload(input);
      const { renderPptxWithPptxGenJS } = await import('./ppt/run-pptxgenjs.js');
      const { stripAiFlavorDeep } = await import('./text/deai.js');
      const cleaned = stripAiFlavorDeep(payload) as typeof payload;
      const buffer = await renderPptxWithPptxGenJS(cleaned);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="ai-presentation.pptx"`);
      res.setHeader('X-Backend', 'llm-proxy');
      res.setHeader('X-Theme', cleaned.theme);
      res.setHeader('X-Slides', String(cleaned.slides.length));
      res.send(buffer);
    } catch (err: unknown) {
      emitServerError('/api/generate/ai', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/presenton/health', async (_req, res) => {
    const status = await checkPresentonHealth();
    res.json(status);
  });

  app.get('/api/llm-proxy/health', async (_req, res) => {
    const status = await checkLlmProxyHealth();
    res.json(status);
  });

  app.post('/api/visual-qa', async (req, res) => {
    try {
      const { image, escalated, locale } = req.body as {
        image?: string;
        escalated?: boolean;
        locale?: string;
      };
      if (!image) {
        res.status(400).json({ error: 'Missing required field: image (base64 PNG)' });
        return;
      }
      const options: VisualQAOptions = {
        escalated: escalated ?? false,
        locale: (locale as 'zh-CN' | 'en-US') ?? 'zh-CN',
      };
      const result = await evaluateDocumentVisual(image, options);
      res.json(result);
    } catch (err: unknown) {
      emitServerError('/api/visual-qa', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/visual-qa/health', async (_req, res) => {
    const { ollama, preferred } = await checkVisualQABackends();
    res.json({
      available: preferred !== null,
      preferred,
      proxy: { ok: ollama, url: `http://127.0.0.1:${process.env.POLARPRIVATE_PORT ?? '12790'}` },
      models: { vlm: 'L101', chat8b: 'L000', chat32b: 'L100' },
    });
  });

  app.get('/api/ocr/backends', async (_req, res) => {
    try {
      const status = await detectBackend();
      res.json(status);
    } catch (err: unknown) {
      emitServerError('/api/ocr/backends', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ocr', async (req, res) => {
    try {
      const { imagePath, pdfPath, normalize } = req.body as {
        imagePath?: string; pdfPath?: string; normalize?: boolean;
      };

      if (!imagePath && !pdfPath) {
        res.status(400).json({ error: 'Provide imagePath or pdfPath' });
        return;
      }

      const backend = await detectBackend();
      if (!backend.available) {
        res.status(503).json({ error: `No VLM backend available: ${backend.reason}` });
        return;
      }

      let text: string;
      let pages: number | undefined;

      if (pdfPath) {
        const result = await ocrPdf(pdfPath, backend);
        text = result.text;
        pages = result.pages;
      } else {
        text = await ocrImage(imagePath!, backend);
      }

      if (normalize && text.length > 0) {
        const normalized = await normalizeFormulas(text);
        res.json({
          text: normalized.output,
          pages,
          backend: backend.backend,
          chars: normalized.output.length,
          normalized: normalized.changed,
          formulaCandidates: normalized.candidates,
          formulasFixed: normalized.fixed,
        });
        return;
      }

      res.json({ text, pages, backend: backend.backend, chars: text.length });
    } catch (err: unknown) {
      emitServerError('/api/ocr', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/normalize-formulas', async (req, res) => {
    try {
      const { text } = req.body as { text?: string };
      if (!text) {
        res.status(400).json({ error: 'Missing required field: text' });
        return;
      }

      const result = await normalizeFormulas(text);
      res.json({
        text: result.output,
        changed: result.changed,
        candidates: result.candidates,
        fixed: result.fixed,
      });
    } catch (err: unknown) {
      emitServerError('/api/normalize-formulas', err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/lobster/status', async (_req, res) => {
    try {
      res.json(await getLobsterStatus());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/lobster/health', async (_req, res) => {
    try {
      res.json(await getLobsterHealth());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/lobster/test', async (_req, res) => {
    try {
      res.json(await runLobsterTest());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);
  let shutdownStarted = false;

  const onShutdownSignal = (): void => {
    if (shutdownStarted) {
      process.exit(1);
    }
    shutdownStarted = true;
    server.close((err) => {
      if (err) {
        console.error('Error during server shutdown:', err);
        process.exit(1);
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', onShutdownSignal);
  process.on('SIGTERM', onShutdownSignal);

  server.listen(port, '127.0.0.1', () => {
    console.log(`AutoOffice API server running on http://127.0.0.1:${port}`);
    console.log(`  POST /api/generate    — Generate reports`);
    console.log(`  POST /api/summarize   — Summarize & route content`);
    console.log(`  POST /api/ocr         — VLM OCR (PDF/image → LaTeX)`);
    console.log(`  POST /api/normalize-formulas — Fix bare math in text`);
    console.log(`  GET  /api/ocr/backends — Check VLM backend status`);
    console.log(`  GET  /api/tools       — Detect external office tools`);
    console.log(`  GET  /api/formats     — List supported formats`);
    console.log(`  GET  /api/templates   — List template gallery`);
    console.log(`  GET  /api/templates/:id — Get template source`);
    console.log(`  POST /api/generate/ai — AI presentation (Presenton)`);
    console.log(`  POST /api/visual-qa   — VLM visual quality check`);
    console.log(`  GET  /api/lobster/status  — Lobster project status`);
    console.log(`  GET  /api/lobster/health  — Lobster health check`);
    console.log(`  GET  /api/lobster/test    — Lobster run tests`);
    console.log(`  GET  /health          — Health check`);
  });
}
