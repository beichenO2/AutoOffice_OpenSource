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
