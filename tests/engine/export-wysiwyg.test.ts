/**
 * WYSIWYG export (Playwright) — the exported file is rendered from the exact preview
 * HTML the user sees at /aoide/, so it matches the live preview instead of the bare
 * Slidev default theme. The default PDF is a *vector* render (Chromium page.pdf), so
 * text stays selectable/searchable — not a screenshot bitmap. The opt-in `withClicks`
 * path expands each v-click fragment into its own slide/page (screenshot-based).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import { PREVIEW_FITTED_ATTR } from '../../src/engine/text-fit.js';
import type { Project, Revision } from '../../src/engine/types.js';

let dir: string;
let svc: EngineService;

async function pptxSlideCount(buffer: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
}

beforeEach(async () => {
  process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
  process.env.AUTOOFFICE_PPT_SOT = 'slidev';
  process.env.AUTOOFFICE_BOXMAP = 'estimate';
  delete process.env.AUTOOFFICE_LLM_EDIT; // deterministic fallback deck (no GLM)
  dir = await mkdtemp(join(tmpdir(), 'aoide-export-wysiwyg-'));
  svc = new EngineService({
    root: dir,
    idFactory: createDeterministicIdFactory('exp'),
    clock: fixedClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('WYSIWYG export (Playwright) — matches the live preview', () => {
  it('default export = one page/slide per deck slide (report matches website)', async () => {
    const { project, slides } = await svc.createDeckFromTopic('导出测试', '扩散模型加速采样', 'DDIM\n一致性模型\n渐进式蒸馏', {
      animate: true,
    });

    const pdf = await svc.exportProject(project.id, 'pdf');
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.buffer.length).toBeGreaterThan(1000);

    // Default PDF is a *vector* render of the preview HTML → text stays selectable
    // (not a screenshot bitmap). Verify with poppler's pdftotext when it is present;
    // skip the assertion gracefully on machines without poppler.
    const extract = spawnSync('pdftotext', ['-', '-'], { input: pdf.buffer });
    if (!extract.error && extract.status === 0) {
      const text = (extract.stdout?.toString() ?? '').replace(/\s+/g, '');
      expect(text.length).toBeGreaterThan(20);
    }

    const pptx = await svc.exportProject(project.id, 'pptx');
    expect(pptx.mime).toContain('presentationml');
    expect(pptx.buffer.subarray(0, 2).toString()).toBe('PK');
    // WYSIWYG: exactly one image slide per deck slide (everything revealed).
    expect(await pptxSlideCount(pptx.buffer)).toBe(slides);
  }, 60_000);

  it('withClicks export expands each v-click step into its own slide/page (S7)', async () => {
    const { project, slides } = await svc.createDeckFromTopic('分步测试', '扩散模型加速采样', 'DDIM\n一致性模型\n渐进式蒸馏', {
      animate: true,
    });

    const base = await svc.exportProject(project.id, 'pptx');
    const stepped = await svc.exportProject(project.id, 'pptx', { withClicks: true });
    const baseN = await pptxSlideCount(base.buffer);
    const steppedN = await pptxSlideCount(stepped.buffer);

    expect(baseN).toBe(slides);
    // Animated deck has v-click fragments → stepped export has strictly more slides.
    expect(steppedN).toBeGreaterThan(baseN);
  }, 60_000);
});

const FITTABLE_COPY =
  '这是一段故意写得很长很长很长很长很长很长很长很长用来撑破幻灯片的中文段落需要缩小字号才能装进画布';

function fittableOverflowHtml(): string {
  const paras = Array.from(
    { length: 14 },
    (_, i) => `<p class="ao-el" data-ao-id="p${i}" data-ao-type="paragraph">${FITTABLE_COPY}${i}</p>`,
  ).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{
  position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box;
  padding:40px;--ao-body-font:48px;font-family:sans-serif;
}
.ao-slide > p{font-size:var(--ao-body-font,48px);line-height:1.3;margin:0 0 10px}
.ao-slide[data-ao-fit] > p.ao-el{font-size:var(--ao-body-font,1.5vw)}
</style></head>
<body>
<div class="ao-slide" data-ao-id="slide-1" data-ao-layout="content">${paras}</div>
</body></html>`;
}

function cleanFittedHtml(): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
</style></head>
<body ${PREVIEW_FITTED_ATTR}="1">
<div class="ao-slide" data-ao-id="slide-1">
  <p data-ao-id="ok" data-ao-type="text" style="position:absolute;left:80px;top:80px;width:400px;height:48px;font:16px/1.3 sans-serif">短句</p>
</div>
</body></html>`;
}

function clipHtml(): string {
  const clip = '这是一段故意写得很长很长很长很长很长很长很长很长很长很长用来撑破窄单元格的中文';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
html,body{margin:0}
.ao-slide{position:relative;width:1280px;height:720px;overflow:hidden;box-sizing:border-box}
</style></head>
<body>
<div class="ao-slide">
  <div data-ao-id="clip" data-ao-type="text" style="position:absolute;left:80px;top:80px;width:160px;height:36px;overflow:hidden;font:24px/1.3 sans-serif;white-space:nowrap">${clip}</div>
</div>
</body></html>`;
}

describe('exportProject — fit before preflight (GAP-3)', () => {
  async function plantHtmlHead(html: string, renderHtml?: string): Promise<Project> {
    const { project } = await svc.createProject('fit-export', 'presentation');
    const rev: Revision = {
      id: 'rev_fit_export',
      projectId: project.id,
      baseRevisionId: null,
      origin: 'generation',
      createdAt: 't0',
      sourceHash: 'fit',
      source: [{ path: 'deck.html', language: 'html', content: html }],
      renderPath: await svc.store.writeRender(
        project.id,
        'rev_fit_export.html',
        Buffer.from(renderHtml ?? html, 'utf-8'),
      ),
      renderMime: 'text/html',
      renderStatus: 'rendered',
      label: 'fit export fixture',
    };
    await svc.repo.putRevision(rev);
    project.headRevisionId = rev.id;
    project.lastGoodRevisionId = rev.id;
    await svc.repo.putProject(project);
    return project;
  }

  it('fits overflowing HTML before text-layout preflight and exports PDF', async () => {
    const project = await plantHtmlHead(fittableOverflowHtml());
    const pdf = await svc.exportProject(project.id, 'pdf');
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  }, 45_000);

  it('html export of deck.html returns fitted bytes stamped with PREVIEW_FITTED_ATTR', async () => {
    const project = await plantHtmlHead(fittableOverflowHtml());
    const exp = await svc.exportProject(project.id, 'html');
    const html = exp.buffer.toString('utf-8');
    expect(html).toContain(PREVIEW_FITTED_ATTR);
    expect(html).toMatch(/data-ao-fit="1"|--ao-body-font:\s*[\d.]+vw/);
  }, 45_000);

  it('reuses already-fitted render bytes (PREVIEW_FITTED_ATTR) instead of unfitted source', async () => {
    const project = await plantHtmlHead(clipHtml(), cleanFittedHtml());
    const pdf = await svc.exportProject(project.id, 'pdf');
    expect(pdf.mime).toBe('application/pdf');
    expect(pdf.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  }, 45_000);
});
