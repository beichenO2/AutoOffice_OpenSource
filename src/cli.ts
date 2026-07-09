#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { runReportPipeline } from './format/pipeline.js';
import { autoConvertPayload, normalizeGenerateFormat } from './format/generic-report-data.js';
import { registerFormatAdapters } from './format/format-adapters.js';
import { summarize } from './summarize/pipeline.js';
import { normalizeRawInput } from './summarize/parser.js';
import { resolveCliWikiOutputDir } from './wiki-output.js';
import { AUTOOFFICE_NAME, AUTOOFFICE_VERSION, SUPPORTED_GENERATE_FORMATS } from './index.js';
import { emitLobsterEvent } from './lobster/emitter.js';
import type { ReportFormat } from './format/types.js';
import type { RawInput } from './summarize/types.js';

function setupAdapters(): void {
  registerFormatAdapters();
}

function appendResolvedInputs(
  target: RawInput[],
  values: string[] | undefined,
  kind: 'file' | 'archive',
): void {
  if (!values) return;
  for (const value of values) {
    target.push(
      normalizeRawInput({
        kind,
        value: resolve(value),
        formatHint: kind === 'archive' ? 'zip' : undefined,
      }),
    );
  }
}

function parseBatchFormats(value: string): ReportFormat[] {
  const requested = value
    .split(',')
    .map((format) => format.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new Error(`Provide at least one format. Supported: ${SUPPORTED_GENERATE_FORMATS.join(', ')}`);
  }

  const formats: ReportFormat[] = [];
  const seen = new Set<ReportFormat>();
  const invalid: string[] = [];

  for (const requestedFormat of requested) {
    const normalized = normalizeGenerateFormat(requestedFormat);
    if (!normalized) {
      invalid.push(requestedFormat);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      formats.push(normalized);
    }
  }

  if (invalid.length > 0) {
    throw new Error(
      `Unsupported format(s): ${invalid.join(', ')}. Supported: ${SUPPORTED_GENERATE_FORMATS.join(', ')}`,
    );
  }

  return formats;
}

async function resolveWritableOutputPath(pathValue: string): Promise<string> {
  const outputPath = resolve(pathValue);
  await mkdir(dirname(outputPath), { recursive: true });
  return outputPath;
}


const program = new Command();

program
  .name(AUTOOFFICE_NAME)
  .description('AutoOffice — AI-grade report generation without AI flavor')
  .version(AUTOOFFICE_VERSION);

program
  .command('generate')
  .description('Generate a report from structured JSON data')
  .requiredOption('-f, --format <format>', 'Output format: ppt/pptx, pdf, docx, latex, html')
  .requiredOption('-i, --input <file>', 'Input JSON file with structured data')
  .requiredOption('-o, --output <file>', 'Output file path')
  .option('-t, --template <file>', 'Custom Handlebars template file')
  .option('-l, --locale <locale>', 'Locale: zh-CN or en-US', 'zh-CN')
  .action(async (opts) => {
    setupAdapters();

    const format = normalizeGenerateFormat(String(opts.format));
    if (!format) {
      console.error(`Unsupported format: ${opts.format}. Use ppt/pptx, pdf, docx, latex, or html.`);
      process.exit(1);
    }

    const inputRaw = await readFile(resolve(opts.input), 'utf-8');
    const rawData = JSON.parse(inputRaw);
    const data = autoConvertPayload(rawData, format, opts.locale);

    const template = opts.template
      ? { kind: 'file' as const, path: resolve(opts.template) }
      : { kind: 'inline' as const, source: (data._template as string | undefined) ?? '<html><body>{{#each sections}}<h2>{{title}}</h2><p>{{content}}</p>{{/each}}</body></html>' };

    const artifact = await runReportPipeline({ format, data, template, locale: opts.locale });
    const outputPath = await resolveWritableOutputPath(opts.output);
    const buf = artifact.encoding === 'base64'
      ? Buffer.from(artifact.body, 'base64')
      : Buffer.from(artifact.body, 'utf-8');
    await writeFile(outputPath, buf);

    if (format === 'pdf') {
      const { closePdfBrowser } = await import('./pdf/run-playwright.js');
      await closePdfBrowser();
    }

    console.log(`Generated ${format} report: ${outputPath} (${buf.length} bytes)`);
  });

program
  .command('html-to-pdf')
  .description('Convert an HTML file (already styled, print-ready) to PDF via headless Chromium')
  .requiredOption('-i, --input <file>', 'Input HTML file path')
  .requiredOption('-o, --output <file>', 'Output PDF file path')
  .option('--page-format <format>', 'A4 (default) or Letter', 'A4')
  .option('--no-print-background', 'Disable printing of CSS backgrounds')
  .option('--margin-top <v>', 'Top margin (e.g. 0, 12mm)')
  .option('--margin-bottom <v>', 'Bottom margin')
  .option('--margin-left <v>', 'Left margin')
  .option('--margin-right <v>', 'Right margin')
  .option('--wait-until <state>', 'domcontentloaded | load | networkidle', 'domcontentloaded')
  .action(async (opts) => {
    const html = await readFile(resolve(opts.input), 'utf-8');
    const { renderHtmlToPdf, closePdfBrowser } = await import('./pdf/run-playwright.js');
    const margin: Record<string, string> = {};
    if (opts.marginTop) margin.top = opts.marginTop;
    if (opts.marginBottom) margin.bottom = opts.marginBottom;
    if (opts.marginLeft) margin.left = opts.marginLeft;
    if (opts.marginRight) margin.right = opts.marginRight;

    try {
      const pdfBuf = await renderHtmlToPdf(html, {
        format: (opts.pageFormat as 'A4' | 'Letter') ?? 'A4',
        printBackground: opts.printBackground !== false,
        margin: Object.keys(margin).length ? margin : undefined,
        waitUntil: opts.waitUntil as 'domcontentloaded' | 'load' | 'networkidle',
      });
      const outputPath = await resolveWritableOutputPath(opts.output);
      await writeFile(outputPath, pdfBuf);
      console.log(`html-to-pdf: ${outputPath} (${pdfBuf.length} bytes)`);
    } finally {
      await closePdfBrowser();
    }
  });

program
  .command('to-markdown')
  .description('Convert PDF/DOCX/PPTX (and text files) to Markdown for KnowLever / LLM ingest')
  .requiredOption('-i, --input <path>', 'Input file or directory')
  .requiredOption('-o, --output-dir <dir>', 'Directory to write .md files')
  .action(async (opts) => {
    const { convertInputsToMarkdown } = await import('./integrations/to-markdown.js');
    const written = await convertInputsToMarkdown(resolve(opts.input), resolve(opts.outputDir));
    if (written.length === 0) {
      console.error('No supported files converted. Supported: .pdf .docx .pptx .md .txt …');
      process.exit(1);
    }
    console.log(`to-markdown: ${written.length} file(s) → ${resolve(opts.outputDir)}`);
  });

program
  .command('summarize')
  .description('Parse, evaluate, and generate Mermaid diagrams from input content')
  .option('-i, --input <files...>', 'Input files to summarize')
  .option('-a, --archive <files...>', 'Input ZIP archives to summarize')
  .option('-t, --text <text>', 'Direct text input')
  .option('-u, --url <urls...>', 'URLs to fetch and summarize')
  .option('-o, --output <file>', 'Output JSON file for the result')
  .option('--mermaid-only', 'Output only the Mermaid diagram code', false)
  .action(async (opts) => {
    const inputs: RawInput[] = [];

    if (opts.text) {
      inputs.push({ kind: 'text', value: opts.text });
    }
    appendResolvedInputs(inputs, opts.input, 'file');
    appendResolvedInputs(inputs, opts.archive, 'archive');
    if (opts.url) {
      for (const u of opts.url) {
        inputs.push({ kind: 'url', value: u });
      }
    }

    if (inputs.length === 0) {
      console.error('Provide at least one input: --input, --archive, --text, or --url');
      process.exit(1);
    }

    const result = await summarize(inputs);

    if (opts.mermaidOnly) {
      console.log(result.mermaid.code);
      return;
    }

    const output = {
      route: result.evaluation.route,
      reason: result.evaluation.reason,
      totalWords: result.evaluation.totalWords,
      complexity: result.evaluation.complexity,
      mermaid: result.mermaid.code,
      concepts: result.mermaid.concepts,
      sources: result.parsed.length,
      handoff: result.handoff,
    };

    if (opts.output) {
      const outputPath = await resolveWritableOutputPath(opts.output);
      await writeFile(outputPath, JSON.stringify(output, null, 2));
      console.log(`Summary written to ${outputPath}`);
    } else {
      console.log(JSON.stringify(output, null, 2));
    }
  });

program
  .command('batch')
  .description('Generate the same report in multiple formats simultaneously')
  .requiredOption('-i, --input <file>', 'Input JSON file with structured data')
  .requiredOption('-f, --formats <formats>', 'Comma-separated formats: pptx,pdf,docx,latex,html')
  .requiredOption('-d, --dir <directory>', 'Output directory')
  .option('-l, --locale <locale>', 'Locale: zh-CN or en-US', 'zh-CN')
  .option('--no-deai', 'Skip de-AI flavor processing')
  .action(async (opts) => {
    const { generateMultiFormat } = await import('./batch/processor.js');
    const inputRaw = await readFile(resolve(opts.input), 'utf-8');
    const rawData = JSON.parse(inputRaw);
    const formats = parseBatchFormats(String(opts.formats));
    const outDir = resolve(opts.dir);
    await mkdir(outDir, { recursive: true });

    const batchData: Record<string, unknown> = {};
    for (const fmt of formats) {
      const converted = autoConvertPayload(rawData, fmt, opts.locale);
      Object.assign(batchData, converted);
    }
    Object.assign(batchData, rawData);

    console.log(`Generating ${formats.length} formats: ${formats.join(', ')}`);
    const results = await generateMultiFormat(batchData, formats, {
      deai: opts.deai !== false,
      locale: opts.locale,
    });

    let hadErrors = false;
    for (const [fmt, result] of results) {
      if (result.error) {
        hadErrors = true;
        console.error(`  ${fmt}: ERROR — ${result.error}`);
        continue;
      }
      const outPath = resolve(outDir, `report.${fmt}`);
      const buf = result.artifact.encoding === 'base64'
        ? Buffer.from(result.artifact.body, 'base64')
        : Buffer.from(result.artifact.body, 'utf-8');
      await writeFile(outPath, buf);
      console.log(`  ${fmt}: ${outPath} (${buf.length} bytes, ${result.durationMs}ms)`);
    }
    if (hadErrors) {
      process.exitCode = 1;
    }
  });

program
  .command('enrich')
  .description('Enrich content with KnowLeverage RAG context')
  .option('-i, --input <file>', 'Input markdown file')
  .option('-t, --text <text>', 'Direct text input')
  .option('-o, --output <file>', 'Output enriched markdown file')
  .option('-k, --top-k <n>', 'Number of RAG results per query', '3')
  .option('-q, --max-queries <n>', 'Maximum number of RAG queries', '3')
  .action(async (opts) => {
    const { enrichWithRAG, normalizePositiveIntegerOption } = await import('./integrations/knowleverage.js');
    let markdown: string;
    if (opts.input) {
      markdown = await readFile(resolve(opts.input), 'utf-8');
    } else if (opts.text) {
      markdown = opts.text;
    } else {
      console.error('Provide --input or --text');
      process.exit(1);
    }

    console.log('Querying KnowLeverage RAG engine...');
    const result = await enrichWithRAG(markdown, {
      maxQueries: normalizePositiveIntegerOption(opts.maxQueries),
      topK: normalizePositiveIntegerOption(opts.topK),
    });

    console.log(`Enrichment: ${result.enrichmentCount} contexts added`);
    for (const r of result.ragContexts) {
      console.log(`  "${r.query}": ${r.success ? 'OK' : `FAIL (${r.error})`}`);
    }

    if (opts.output) {
      const outputPath = await resolveWritableOutputPath(opts.output);
      await writeFile(outputPath, result.enriched);
      console.log(`Written to ${outputPath}`);
    } else {
      console.log('\n' + result.enriched);
    }
  });

program
  .command('wiki')
  .description('Create a LLMWiki scaffold from content')
  .option('-i, --input <files...>', 'Input files')
  .option('-t, --text <text>', 'Direct text input')
  .requiredOption('-d, --dir <directory>', 'Output wiki project directory')
  .action(async (opts) => {
    const { createWikiScaffold } = await import('./integrations/llmwiki.js');

    const inputs: RawInput[] = [];
    if (opts.text) inputs.push({ kind: 'text', value: opts.text });
    if (opts.input) {
      for (const f of opts.input) {
        inputs.push(normalizeRawInput({ kind: 'file', value: resolve(f) }));
      }
    }

    if (inputs.length === 0) {
      console.error('Provide --input or --text');
      process.exit(1);
    }

    const result = await summarize(inputs);
    const scaffold = await createWikiScaffold(result, resolveCliWikiOutputDir(opts.dir));

    if (scaffold.success) {
      console.log(`Wiki scaffold created at ${scaffold.projectDir}`);
      console.log(`Files: ${scaffold.filesCreated.length}`);
      console.log(`Build: cd ${scaffold.projectDir} && ${scaffold.buildCommand}`);
    } else {
      console.error(`Failed: ${scaffold.error}`);
    }
  });

program
  .command('quality')
  .description('Analyze text quality: de-AI + monotony + diversity scoring')
  .option('-i, --input <file>', 'Input text/markdown file')
  .option('-t, --text <text>', 'Direct text input')
  .option('-o, --output <file>', 'Output JSON report file')
  .action(async (opts) => {
    const { analyzeQuality } = await import('./text/quality.js');
    let text: string;
    if (opts.input) {
      text = await readFile(resolve(opts.input), 'utf-8');
    } else if (opts.text) {
      text = opts.text;
    } else {
      console.error('Provide --input or --text');
      process.exit(1);
    }

    const report = analyzeQuality(text);

    const summary = {
      grade: report.grade,
      score: report.overallScore,
      wordCount: report.wordCount,
      aiFlavorCharsRemoved: report.aiFlavorDetected,
      monotonyScore: report.monotony.score,
      diversityScore: report.diversity.score,
      recommendations: report.recommendations,
    };

    if (opts.output) {
      const outputPath = await resolveWritableOutputPath(opts.output);
      await writeFile(outputPath, JSON.stringify(summary, null, 2));
      console.log(`Quality report written to ${outputPath}`);
    }

    console.log(`\nQuality Grade: ${report.grade} (${report.overallScore}/100)`);
    console.log(`Words: ${report.wordCount}`);
    console.log(`AI flavor removed: ${report.aiFlavorDetected} chars`);
    console.log(`Monotony: ${report.monotony.score}/100`);
    console.log(`Diversity: ${report.diversity.score}/100`);
    if (report.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const r of report.recommendations) {
        console.log(`  - ${r}`);
      }
    }
  });

program
  .command('humanize')
  .description('Adversarial de-AI rewriting: evade AI text detectors')
  .option('-i, --input <file>', 'Input text/markdown file')
  .option('-t, --text <text>', 'Direct text input')
  .option('-o, --output <file>', 'Output rewritten file')
  .option('-s, --strength <n>', 'Aggressiveness 1-5 (default: 3)', '3')
  .option('--json', 'Output machine-readable JSON report')
  .action(async (opts) => {
    const { adversarialRewrite } = await import('./text/adversarial.js');
    let text: string;
    if (opts.input) {
      text = await readFile(resolve(opts.input), 'utf-8');
    } else if (opts.text) {
      text = opts.text;
    } else {
      console.error('Provide --input or --text');
      process.exit(1);
    }

    const strength = Math.max(1, Math.min(5, parseInt(opts.strength, 10) || 3));
    const report = adversarialRewrite(text, { strength });

    if (opts.json) {
      const out = {
        passes: report.passes,
        stats: report.stats,
        rewritten: report.rewritten,
      };
      if (opts.output) {
        const outputPath = await resolveWritableOutputPath(opts.output);
        await writeFile(outputPath, JSON.stringify(out, null, 2));
        console.log(`JSON report written to ${outputPath}`);
      } else {
        console.log(JSON.stringify(out, null, 2));
      }
      return;
    }

    if (opts.output) {
      const outputPath = await resolveWritableOutputPath(opts.output);
      await writeFile(outputPath, report.rewritten);
      console.log(`Rewritten text saved to ${outputPath}`);
    }

    console.log('\nAdversarial De-AI Report');
    console.log('========================');
    for (const p of report.passes) {
      console.log(`  ${p.name}: ${p.applied} edits`);
    }
    console.log(`\nStats:`);
    console.log(`  Char delta: ${report.stats.charDelta > 0 ? '+' : ''}${report.stats.charDelta}`);
    console.log(`  Sentences: ${report.stats.sentenceCountBefore} → ${report.stats.sentenceCountAfter}`);
    console.log(`  Avg sentence len: ${report.stats.avgSentLenBefore} → ${report.stats.avgSentLenAfter}`);
    console.log(`  Sentence-len CV: ${report.stats.sentLenCvBefore} → ${report.stats.sentLenCvAfter}`);
    if (!opts.output && !opts.json) {
      console.log('\n--- Rewritten text ---\n');
      console.log(report.rewritten);
    }
  });

program
  .command('templates')
  .description('List available report templates')
  .action(async () => {
    const { listTemplates } = await import('./templates/gallery.js');
    const templates = listTemplates();
    console.log('Available templates:\n');
    for (const t of templates) {
      console.log(`  ${t.id}`);
      console.log(`    ${t.name} — ${t.description}`);
      console.log(`    Format: ${t.format} | Locale: ${t.locale}`);
      console.log('');
    }
  });

const templateCmd = program.command('template').description('Custom template utilities (gallery)');

templateCmd
  .command('discover')
  .description(
    'Simulate user-driven template discovery: GitHub search → stub Handlebars HTML → register in ~/.autooffice/templates/',
  )
  .requiredOption('-q, --query <text>', 'User description, e.g. 中国药科大学 学士论文 LaTeX')
  .option('--dry-run', 'Print steps and GitHub hits only; do not write template files')
  .action(async (opts: { query: string; dryRun?: boolean }) => {
    const q = String(opts.query).trim();
    if (!q) {
      console.error('Empty query');
      process.exit(1);
    }
    const searchUrls = [
      `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} thesis latex template`)}&sort=stars&per_page=5`,
      `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} template`)}&sort=stars&per_page=5`,
      'https://api.github.com/search/repositories?q=latex+thesis+template+china&sort=stars&per_page=5',
    ];
    console.log('Step 1 — user query:', q);

    let items: Array<{ full_name: string; html_url: string; description: string | null }> = [];
    try {
      for (const ghUrl of searchUrls) {
        console.log('Step 2 — GitHub search:', ghUrl);
        const res = await fetch(ghUrl, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AutoOffice-template-discover' },
        });
        if (!res.ok) {
          console.error(`GitHub API: ${res.status} ${await res.text().then((t) => t.slice(0, 200))}`);
          process.exit(1);
        }
        const data = (await res.json()) as { items?: typeof items };
        items = data.items ?? [];
        if (items.length > 0) break;
      }
    } catch (e) {
      console.error('GitHub request failed:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    if (items.length === 0) {
      console.log('No repositories found. Try an English keyword query or set GITHUB_TOKEN for higher rate limits.');
      process.exit(0);
    }

    const top = items[0]!;
    console.log('Step 3 — top hit:', top.full_name, top.html_url);
    for (const it of items.slice(0, 3)) {
      console.log(`  - ${it.full_name}: ${(it.description ?? '').slice(0, 80)}`);
    }

    let hash = 0;
    for (let i = 0; i < q.length; i += 1) {
      hash = (hash * 31 + q.charCodeAt(i)) | 0;
    }
    const id = `discover-${Math.abs(hash).toString(36)}`;

    const source = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/>
<title>{{title}}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;line-height:1.6;color:#1e293b}
.note{background:#f1f5f9;border-left:4px solid #3b82f6;padding:12px 16px;margin:1rem 0;font-size:14px}
a{color:#2563eb}</style></head><body>
<p class="note">模板发现占位页（discover 管线）。用户查询：<strong>${q.replace(/</g, '')}</strong><br/>
参考仓库：<a href="${top.html_url}">${top.full_name}</a> — 请将官方 .cls/.sty 下载后放入工程并由人工审阅后替换此 stub。</p>
<h1>{{title}}</h1>
{{#each sections}}<h2>{{title}}</h2><p>{{content}}</p>{{/each}}
</body></html>`;

    if (opts.dryRun) {
      console.log('Step 4 — dry-run: would register id=', id);
      process.exit(0);
    }

    const { addCustomTemplate } = await import('./templates/gallery.js');
    try {
      addCustomTemplate({
        id,
        name: `发现: ${q.slice(0, 40)}`,
        description: `GitHub: ${top.full_name}`,
        format: 'html',
        locale: 'zh-CN',
        source,
      });
      console.log('Step 4 — registered custom template:', id);
      console.log('Next: replace stub with real LaTeX assets from the repo, or POST /api/templates with LaTeX source.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('already exists')) {
        console.log('Template id exists:', id, '— delete first or change query.');
        process.exit(1);
      }
      throw e;
    }
  });

program
  .command('tools')
  .description('Detect external office automation tools and recommended format engines')
  .option('--json', 'Output machine-readable JSON')
  .action(async (opts) => {
    const { buildExternalToolsSummary } = await import('./integrations/external-tools.js');
    const summary = await buildExternalToolsSummary();

    if (opts.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log('External tools:\n');
    for (const tool of summary.tools) {
      const availability = tool.available ? 'available' : 'unavailable';
      const version = tool.version ? ` (${tool.version})` : '';
      console.log(`  ${tool.name}: ${availability}${version}`);
    }

    console.log('\nFormat recommendations:\n');
    for (const rec of summary.formatSupport) {
      const engines = rec.availableExternalEngines.length > 0
        ? rec.availableExternalEngines.join(', ')
        : 'none';
      console.log(`  ${rec.format}: recommended=${rec.recommendedEngine}, external=${engines}`);
      console.log(`    ${rec.note}`);
    }

    console.log('\nConversion helpers:\n');
    for (const path of summary.conversionPaths) {
      const state = path.available ? 'available' : 'unavailable';
      console.log(`  ${path.input} -> ${path.output} via ${path.engine}: ${state}`);
    }
  });

program
  .command('serve')
  .description('Start the HTTP API server')
  .option('-p, --port <port>', 'Port number (overridden by PORT env when set)', '3900')
  .action(async (opts) => {
    const { startServer } = await import('./server.js');
    const fromEnv = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : Number.NaN;
    const preferred = Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : parseInt(opts.port, 10);

    // Tests / ad-hoc runs bind the exact port without PolarPort involvement.
    if (process.env.AUTOOFFICE_DIRECT_PORT === '1') {
      startServer(preferred);
      return;
    }

    const sdkPath = resolve(dirname(new URL(import.meta.url).pathname), '..', '..', 'PolarPort', 'dist', 'sdk', 'index.js');
    const { claimPort } = await import(sdkPath);
    const port = await claimPort({ service: 'autooffice', project: 'AutoOffice', preferred, heartbeat: true });

    startServer(port);
  });

await program.parseAsync(process.argv).catch(async (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  await emitLobsterEvent('bug', 'error', {
    message,
    context: 'cli',
    argv: process.argv.slice(2).join(' '),
  }).catch(() => {});
  process.exit(1);
});
