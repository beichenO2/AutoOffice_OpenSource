/**
 * Editable PPTX export — native text frames (not WYSIWYG PNG slides).
 * WHY: screenshot PPTX is the default; this opt-in track must emit real <a:t>
 * so PowerPoint can edit title/bullets (scientific-illustrator “prefer editable text”).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import type { DeckSpec } from '../../src/engine/html/generate.js';
import {
  exportDeckPptxEditable,
  isEditablePptxExportEnabled,
  PPTX_EDITABLE_ENV,
} from '../../src/engine/export/editable-pptx.js';
import { EngineService } from '../../src/engine/service.js';
import { createDeterministicIdFactory } from '../../src/engine/ids.js';
import { fixedClock } from '../../src/engine/clock.js';

const TINY_DECK: DeckSpec = {
  title: 'Editable Export Demo',
  slides: [
    {
      title: '封面',
      layout: 'title',
      elements: [
        { id: 'h', type: 'heading', text: '可编辑标题' },
        { id: 's', type: 'paragraph', text: '副标题一行' },
      ],
    },
    {
      title: '要点',
      layout: 'content',
      elements: [
        { id: 'b1', type: 'bullet', text: '第一条要点' },
        { id: 'b2', type: 'bullet', text: '第二条要点' },
      ],
    },
  ],
};

async function slideXml(buffer: Buffer, n = 1): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file(`ppt/slides/slide${n}.xml`);
  expect(file, `missing ppt/slides/slide${n}.xml`).toBeTruthy();
  return file!.async('string');
}

function aTextContents(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1] ?? '');
}

describe('isEditablePptxExportEnabled (opt-in, default off)', () => {
  const prev = process.env[PPTX_EDITABLE_ENV];

  afterEach(() => {
    if (prev === undefined) delete process.env[PPTX_EDITABLE_ENV];
    else process.env[PPTX_EDITABLE_ENV] = prev;
  });

  it('is off unless AUTOOFFICE_PPTX_EDITABLE=1', () => {
    delete process.env[PPTX_EDITABLE_ENV];
    expect(isEditablePptxExportEnabled()).toBe(false);
    process.env[PPTX_EDITABLE_ENV] = '0';
    expect(isEditablePptxExportEnabled()).toBe(false);
    process.env[PPTX_EDITABLE_ENV] = '1';
    expect(isEditablePptxExportEnabled()).toBe(true);
  });
});

describe('exportDeckPptxEditable (DeckSpec → native text frames)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ao-editable-pptx-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes a 16:9 pptx whose slide1.xml has non-empty <a:t> text', async () => {
    const outPath = join(dir, 'tiny.pptx');
    const written = await exportDeckPptxEditable(TINY_DECK, outPath);

    expect(written).toBe(outPath);
    expect(existsSync(outPath)).toBe(true);

    const buf = await readFile(outPath);
    expect(buf.subarray(0, 2).toString()).toBe('PK');

    const xml1 = await slideXml(buf, 1);
    const texts1 = aTextContents(xml1).filter((t) => t.trim().length > 0);
    expect(texts1.length).toBeGreaterThan(0);
    expect(texts1.join('')).toContain('可编辑标题');
    expect(xml1).toContain('wrap="square"');

    const xml2 = await slideXml(buf, 2);
    const texts2 = aTextContents(xml2).join('');
    expect(texts2).toContain('第一条要点');
    expect(texts2).toContain('第二条要点');
    expect(xml2).toContain('wrap="square"');
  });
});

describe('exportProject editable opt-in (does not change default WYSIWYG)', () => {
  let dir: string;
  let svc: EngineService;
  const prev = process.env[PPTX_EDITABLE_ENV];

  beforeEach(async () => {
    delete process.env[PPTX_EDITABLE_ENV];
    process.env.AUTOOFFICE_PPT_SOT = 'slidev';
    process.env.AUTOOFFICE_BOXMAP = 'estimate';
    delete process.env.AUTOOFFICE_LLM_EDIT;
    dir = await mkdtemp(join(tmpdir(), 'ao-editable-svc-'));
    svc = new EngineService({
      root: dir,
      idFactory: createDeterministicIdFactory('edpptx'),
      clock: fixedClock(1_700_000_000_000),
    });
  });

  afterEach(async () => {
    if (prev === undefined) delete process.env[PPTX_EDITABLE_ENV];
    else process.env[PPTX_EDITABLE_ENV] = prev;
    await rm(dir, { recursive: true, force: true });
  });

  it('explicit { editable: true } emits native <a:t> from the live deck', async () => {
    const { project } = await svc.createDeckFromTopic(
      '可编辑导出',
      '固态电池',
      '无量产整车\n成本约为锂电三到五倍\n试产线已启动',
    );
    const pptx = await svc.exportProject(project.id, 'pptx', { editable: true });
    expect(pptx.mime).toContain('presentationml');
    const xml1 = await slideXml(pptx.buffer, 1);
    const texts = aTextContents(xml1).filter((t) => t.trim().length > 0);
    expect(texts.length).toBeGreaterThan(0);
    expect(xml1).toContain('wrap="square"');
  });

  it('AUTOOFFICE_PPTX_EDITABLE=1 selects the same native-text path', async () => {
    process.env[PPTX_EDITABLE_ENV] = '1';
    const { project } = await svc.createDeckFromTopic(
      '环境开关',
      '量子计算',
      '纠错取得进展\n超导与离子阱两条路线',
    );
    const pptx = await svc.exportProject(project.id, 'pptx');
    const xml1 = await slideXml(pptx.buffer, 1);
    expect(aTextContents(xml1).some((t) => t.trim().length > 0)).toBe(true);
  });
});
