import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DesignSpecPageError,
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  assertDesignSpecPage,
  designSpecFromInput,
  type DesignSpec,
  type FigureInterpreter,
  type FigureObjectSpec,
  type FigureSketch,
} from '../../src/engine/figure/designer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../fixtures/scientific-figure');

const prompt = readFileSync(resolve(fixtureDir, 'prompt.txt'), 'utf-8').trim();
const sketchSvg = readFileSync(resolve(fixtureDir, 'sketch.svg'), 'utf-8');
const sketch: FigureSketch = {
  mime: 'image/svg+xml',
  data: Buffer.from(sketchSvg, 'utf-8').toString('base64'),
};

function nativeLayerSpec(sourcePrompt: string, sketchUsed: boolean): DesignSpec {
  const objects: FigureObjectSpec[] = [
    {
      id: 'shape-input',
      kind: 'shape',
      label: '输入层',
      x: 80,
      y: 320,
      w: 280,
      h: 160,
      style: { fillColor: '#E7F0F8', strokeColor: '#14365A' },
      text: '输入层',
    },
    {
      id: 'shape-hidden',
      kind: 'shape',
      label: '隐藏层',
      x: 660,
      y: 320,
      w: 280,
      h: 160,
      style: { fillColor: '#E7F0F8', strokeColor: '#14365A' },
      text: '隐藏层',
    },
    {
      id: 'shape-output',
      kind: 'shape',
      label: '输出层',
      x: 1240,
      y: 320,
      w: 280,
      h: 160,
      style: { fillColor: '#E7F0F8', strokeColor: '#14365A' },
      text: '输出层',
    },
    {
      id: 'conn-in-hid',
      kind: 'connector',
      label: '前向',
      x: 360,
      y: 390,
      w: 300,
      h: 20,
      sourceId: 'shape-input',
      targetId: 'shape-hidden',
    },
    {
      id: 'text-title',
      kind: 'text',
      label: '三层前馈',
      x: 80,
      y: 48,
      w: 1440,
      h: 56,
      text: '三层前馈',
      style: { align: 'center', fontColor: '#14365A' },
    },
  ];
  return {
    title: '三层前馈示意',
    pageWidth: FIGURE_PAGE_WIDTH,
    pageHeight: FIGURE_PAGE_HEIGHT,
    sourcePrompt,
    sketchUsed,
    ambiguities: [],
    panels: [{ id: 'panel-main', title: '网络结构', objects }],
  };
}

const deterministicInterpreter: FigureInterpreter = {
  interpret: async (input) => nativeLayerSpec(input.prompt, Boolean(input.sketch)),
};

function collectObjects(spec: DesignSpec): FigureObjectSpec[] {
  return spec.panels.flatMap((panel) => panel.objects);
}

describe('designSpecFromInput', () => {
  it('keeps the prompt, marks sketchUsed, and returns stable native objects', async () => {
    const spec = await designSpecFromInput({ prompt, sketch }, deterministicInterpreter);
    expect(spec.sourcePrompt).toBe(prompt);
    expect(spec.sketchUsed).toBe(true);
    expect(spec.pageWidth).toBe(FIGURE_PAGE_WIDTH);
    expect(spec.pageHeight).toBe(FIGURE_PAGE_HEIGHT);
    expect(spec.panels.length).toBeGreaterThan(0);
    const objects = collectObjects(spec);
    expect(objects.length).toBeGreaterThan(0);
    const ids = objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(objects.every((object) => object.kind !== 'atomic-raster')).toBe(true);
    expect(objects.every((object) => !object.rasterReason)).toBe(true);
  });

  it('delegates to the injected interpreter and returns that spec object', async () => {
    const expected = nativeLayerSpec(prompt, true);
    const interpret = vi.fn(async () => expected);
    const spec = await designSpecFromInput({ prompt, sketch }, { interpret });
    expect(interpret).toHaveBeenCalledOnce();
    expect(interpret).toHaveBeenCalledWith({ prompt, sketch });
    expect(spec).toBe(expected);
    expect(JSON.stringify(spec)).not.toContain(sketch.data);
  });

  it('marks sketchUsed false when the interpreter sees no sketch', async () => {
    const spec = await designSpecFromInput({ prompt }, deterministicInterpreter);
    expect(spec.sourcePrompt).toBe(prompt);
    expect(spec.sketchUsed).toBe(false);
  });

  it('throws when the interpreter returns a foreign page size', async () => {
    const interpreter: FigureInterpreter = {
      interpret: async (input) => ({
        ...nativeLayerSpec(input.prompt, Boolean(input.sketch)),
        pageWidth: 1169 as typeof FIGURE_PAGE_WIDTH,
        pageHeight: 827 as typeof FIGURE_PAGE_HEIGHT,
      }),
    };
    await expect(designSpecFromInput({ prompt, sketch }, interpreter)).rejects.toThrow(
      DesignSpecPageError,
    );
    await expect(designSpecFromInput({ prompt, sketch }, interpreter)).rejects.toThrow(
      /1600×900/,
    );
  });
});

describe('assertDesignSpecPage', () => {
  it('accepts the locked 1600×900 page', () => {
    expect(() => assertDesignSpecPage(nativeLayerSpec(prompt, false))).not.toThrow();
  });

  it('rejects a missing spec and a foreign page size', () => {
    expect(() => assertDesignSpecPage(null)).toThrow(DesignSpecPageError);
    expect(() =>
      assertDesignSpecPage({ pageWidth: 1920, pageHeight: FIGURE_PAGE_HEIGHT }),
    ).toThrow(DesignSpecPageError);
  });
});
