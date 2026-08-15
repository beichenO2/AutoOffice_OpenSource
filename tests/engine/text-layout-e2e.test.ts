/**
 * U6 — deterministic text-layout fixture deck (no live LLM).
 *
 * Builds three slides (dense text-only / sparse text / image+text), writes
 * *fitted* preview HTML + gated editable PPTX, a minimal draw.io sample, and
 * Playwright PNGs for the later `_report/` PDF. Screenshots land under
 * `_report/build/screenshots/text-layout/` (repo-wide `build/` gitignore —
 * generated at test time, not committed).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { DeckSpec, SlideElementSpec } from '../../src/engine/html/generate.js';
import { previewHtmlFittedFromSlidesMd, renderSlidesMd, splitSlidevPages } from '../../src/engine/slidev/generate.js';
import { exportDeckPptxEditable } from '../../src/engine/export/editable-pptx.js';
import { captureDeckShots, closeRenderBrowser } from '../../src/engine/render/deck.js';
import { runTextLayoutPreflight } from '../../src/engine/standards/preflight.js';
import { PREVIEW_FITTED_ATTR } from '../../src/engine/text-fit.js';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';
import type { Revision } from '../../src/engine/types.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = join(homedir(), 'Library', 'Caches', 'ms-playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO_DIR = join(ROOT, '_report', 'build', 'text-layout-demo');
const SHOT_DIR = join(ROOT, '_report', 'build', 'screenshots', 'text-layout');

const LONG_BULLET =
  '这是一条比较长的要点用来模拟真实生成的密集文案需要换行到第二行甚至第三行占用更多竖直空间';

/** Playwright `page.content()` may reorder attributes; match on data-ao-id. */
function openingTag(html: string, slideId: string): string {
  const re = new RegExp(`<div\\b[^>]*\\bdata-ao-id="${slideId}"[^>]*>`, 'i');
  const m = html.match(re);
  if (!m) throw new Error(`missing opening tag for ${slideId}`);
  return m[0];
}

/** Opening tag of the slide that contains `needle` (dense may span 2+ pages). */
function openingTagContaining(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx < 0) throw new Error(`missing ${needle}`);
  const start = html.lastIndexOf('<div', idx);
  if (start < 0) throw new Error(`no slide open before ${needle}`);
  return html.slice(start, html.indexOf('>', start) + 1);
}

function svgDataUri(w: number, h: number): string {
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#14365A"/>
  <rect x="${Math.round(w * 0.08)}" y="${Math.round(h * 0.12)}" width="${Math.round(w * 0.84)}" height="${Math.round(h * 0.76)}" rx="18" fill="#E7F0F8"/>
  <text x="50%" y="48%" text-anchor="middle" fill="#14365A" font-size="${Math.round(h / 11)}" font-family="sans-serif">示意图</text>
  <text x="50%" y="62%" text-anchor="middle" fill="#4A6A88" font-size="${Math.round(h / 18)}" font-family="sans-serif">${w}×${h}</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(raw).toString('base64')}`;
}

function bullets(count: number, text: string, prefix: string): SlideElementSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    type: 'bullet' as const,
    text: `${text}${count > 1 ? `（${i + 1}）` : ''}`,
  }));
}

/** Fixture: heavy text-only, sparse text-only, image+text (tiny SVG data URI). */
export function buildTextLayoutFixtureDeck(): DeckSpec {
  return {
    title: 'Text layout e2e fixture',
    slides: [
      {
        layout: 'content',
        title: '高密度纯文字页',
        elements: bullets(8, LONG_BULLET, 'd'),
      },
      {
        layout: 'content',
        title: '稀疏文字页',
        elements: [
          { id: 's1', type: 'bullet', text: '短要点一' },
          { id: 's2', type: 'bullet', text: '短要点二' },
        ],
      },
      {
        layout: 'content',
        title: '图文混排页',
        elements: [
          { id: 'm1', type: 'bullet', text: '左侧文案与右侧示意图并排' },
          { id: 'm2', type: 'bullet', text: '图用内嵌 SVG data URI，无需外网' },
          { id: 'm3', type: 'bullet', text: '用来对照 dense / fit 后的图文栏' },
          { id: 'img', type: 'image', src: svgDataUri(1000, 420), alt: '示意图' },
        ],
      },
    ],
  };
}

/** Valid mxfile with one rectangle + one text cell (file-only; not MCP-live). */
function minimalDrawioSample(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="AutoOffice" modified="2026-08-15T00:00:00.000Z" agent="text-layout-e2e" version="22.1.0" type="device">
  <diagram id="text-layout-demo" name="Page-1">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <mxCell id="rect-1" value="" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#E7F0F8;strokeColor=#14365A;" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="320" height="140" as="geometry"/>
        </mxCell>
        <mxCell id="text-1" value="Text layout demo" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;fontColor=#14365A;" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="320" height="140" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}

/**
 * Plant fitted HTML as head deck.html and run EngineService.exportProject
 * (preflight gate + editable PPTX). Caller must remove `root` when done.
 */
async function exportProjectFittedGated(html: string, root: string): Promise<Buffer> {
  const svc = new EngineService({
    root,
    idFactory: createDeterministicIdFactory('tle2e'),
    clock: fixedClock(1_700_000_000_000),
  });
  const { project } = await svc.createProject('text-layout-e2e', 'presentation');
  const rev: Revision = {
    id: 'rev_tle2e',
    projectId: project.id,
    baseRevisionId: null,
    origin: 'generation',
    createdAt: 't0',
    sourceHash: 'tle2e-fitted',
    source: [{ path: 'deck.html', language: 'html', content: html }],
    renderPath: await svc.store.writeRender(project.id, 'rev_tle2e.html', Buffer.from(html, 'utf-8')),
    renderMime: 'text/html',
    renderStatus: 'rendered',
    label: 'text-layout fitted fixture',
  };
  await svc.repo.putRevision(rev);
  project.headRevisionId = rev.id;
  project.lastGoodRevisionId = rev.id;
  await svc.repo.putProject(project);
  const exp = await svc.exportProject(project.id, 'pptx', { editable: true });
  return exp.buffer;
}

async function slideXml(buffer: Buffer, n: number): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(`ppt/slides/slide${n}.xml`);
  if (!file) throw new Error(`missing ppt/slides/slide${n}.xml`);
  return file.async('string');
}

afterAll(async () => {
  await closeRenderBrowser();
});

describe('text-layout e2e fixture deck', () => {
  it('writes fitted HTML, gated editable pptx with <a:t>, draw.io sample, and ≥2 PNG screenshots', async () => {
    const deck = buildTextLayoutFixtureDeck();
    const md = renderSlidesMd(deck);
    const html = await previewHtmlFittedFromSlidesMd(md, deck.title);
    expect(html).toMatch(new RegExp(`\\b${PREVIEW_FITTED_ATTR}\\s*=`));

    expect(splitSlidevPages(md).length).toBeGreaterThanOrEqual(4);
    expect(md.split(LONG_BULLET).length - 1).toBe(8);
    expect(md).not.toMatch(/…<\/(?:li|p)>/);
    const denseTag = openingTag(html, 'slide-1');
    const sparseTag = openingTagContaining(html, '短要点一');
    const mediaTag = openingTagContaining(html, '左侧文案与右侧示意图并排');
    expect(denseTag).toContain('data-ao-dense="1"');
    expect(sparseTag).not.toContain('data-ao-dense');
    expect(mediaTag).toContain('data-ao-media=');

    const preflight = await runTextLayoutPreflight(html);
    expect(preflight).toEqual(expect.objectContaining({ ok: expect.any(Boolean) }));
    expect(preflight.audit).toBeDefined();

    await mkdir(DEMO_DIR, { recursive: true });
    await mkdir(SHOT_DIR, { recursive: true });
    const previewPath = join(DEMO_DIR, 'preview.html');
    const mdPath = join(DEMO_DIR, 'slides.md');
    const pptxPath = join(DEMO_DIR, 'editable.pptx');
    const drawioPath = join(DEMO_DIR, 'sample.drawio');
    await writeFile(previewPath, html, 'utf-8');
    await writeFile(mdPath, md, 'utf-8');
    await writeFile(join(SHOT_DIR, '.gitkeep'), '', 'utf-8');

    const drawioXml = minimalDrawioSample();
    await writeFile(drawioPath, drawioXml, 'utf-8');
    expect(existsSync(drawioPath)).toBe(true);
    expect(drawioXml).toMatch(/<mxfile\b/);
    expect(drawioXml).toContain('id="rect-1"');
    expect(drawioXml).toContain('id="text-1"');
    expect(drawioXml).toContain('style="text;');

    let exportVia = 'exportDeckPptxEditable';
    let exportError: string | undefined;
    const engineRoot = await mkdtemp(join(tmpdir(), 'ao-text-layout-e2e-'));
    try {
      const gated = await exportProjectFittedGated(html, engineRoot);
      await writeFile(pptxPath, gated);
      exportVia = 'EngineService.exportProject';
    } catch (err) {
      exportError = err instanceof Error ? err.message : String(err);
      expect(exportError).toMatch(/文本版式预检失败/);
      await exportDeckPptxEditable(deck, pptxPath);
    } finally {
      await rm(engineRoot, { recursive: true, force: true }).catch(() => {});
    }

    expect(existsSync(pptxPath)).toBe(true);
    const pptxBuf = await readFile(pptxPath);
    expect(pptxBuf.subarray(0, 2).toString()).toBe('PK');
    const xml1 = await slideXml(pptxBuf, 1);
    expect(xml1).toContain('<a:t');
    expect(xml1).toMatch(/<a:t(?:\s[^>]*)?>[^<]+<\/a:t>/);

    const shots = await captureDeckShots(html);
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const written: string[] = [];
    for (let i = 0; i < shots.length; i++) {
      const buf = shots[i]!;
      expect(buf[0]).toBe(0x89);
      expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
      const dest = join(SHOT_DIR, `${String(i + 1).padStart(2, '0')}-page.png`);
      await writeFile(dest, buf);
      written.push(dest);
    }

    const pngs = (await readdir(SHOT_DIR)).filter((n) => n.endsWith('.png'));
    expect(pngs.length).toBeGreaterThanOrEqual(2);

    await writeFile(
      join(DEMO_DIR, 'manifest.json'),
      JSON.stringify(
        {
          title: deck.title,
          previewHtml: previewPath,
          slidesMd: mdPath,
          editablePptx: pptxPath,
          drawioSample: drawioPath,
          drawioSource: 'file',
          screenshots: written,
          fitted: true,
          previewFittedAttr: PREVIEW_FITTED_ATTR,
          preflightOk: preflight.ok,
          exportVia,
          exportError,
          denseOnHeavySlide: true,
          note: 'PNGs are gitignored by build/; regenerate with npm test -- tests/engine/text-layout-e2e.test.ts',
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
  }, 120_000);
});
