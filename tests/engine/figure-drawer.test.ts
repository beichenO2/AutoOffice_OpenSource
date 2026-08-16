import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { drawioFromSpec } from '../../src/engine/figure/drawer.js';
import {
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  type DesignSpec,
  type FigureObjectSpec,
} from '../../src/engine/figure/types.js';

const { DOMParser } = new JSDOM('<root/>', { contentType: 'text/xml' }).window;

/** Same three-layer network as scientific-figure.test.ts (3 shape + 1 connector + 1 text). */
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

function collectObjects(spec: DesignSpec): FigureObjectSpec[] {
  return spec.panels.flatMap((panel) => panel.objects);
}

/** Image-typed mxCell count. Per-cell only — not id=sketch-bg, not pageWidth on mxGraphModel. */
function countImageCells(xml: string): number {
  const cells = xml.match(/<mxCell\b[^>]*>/g) ?? [];
  return cells.filter((cell) => /shape=image/i.test(cell) || /image=data/i.test(cell)).length;
}

function openingCell(xml: string, id: string): string {
  const match = xml.match(new RegExp(`<mxCell\\b[^>]*\\bid="${id}"[^>]*>`));
  if (!match) throw new Error(`missing mxCell id="${id}"`);
  return match[0];
}

function assertWellFormedMxfile(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  const parseError = document.getElementsByTagName('parsererror')[0];
  expect(parseError).toBeUndefined();
  expect(document.getElementsByTagName('mxfile')).toHaveLength(1);
  return document;
}

describe('drawioFromSpec', () => {
  it('emits named mxCells and a connector edge without a whole-page image', () => {
    const spec = nativeLayerSpec('三层前馈网络', false);
    const xml = drawioFromSpec(spec);
    expect(xml).toMatch(/<mxfile\b/);
    expect(xml).toContain('pageWidth="1600"');
    expect(xml).toContain('pageHeight="900"');
    for (const object of collectObjects(spec)) {
      expect(xml).toContain(`id="${object.id}"`);
    }
    expect(xml).toMatch(/id="conn-in-hid"[^>]*\bedge="1"/);
    expect(countImageCells(xml)).toBe(0);
    expect(xml).toContain('compressed="false"');
    assertWellFormedMxfile(xml);
  });

  it('keeps official uncompressed mxfile discipline: unique ids, vertex/edge exclusive, no sketch backdrop', () => {
    const spec = nativeLayerSpec('三层前馈网络', true);
    const xml = drawioFromSpec(spec);

    expect(xml).toMatch(/^\s*(?:<\?xml[^>]*>\s*)?<mxfile\b/);
    expect(xml).toContain('compressed="false"');
    assertWellFormedMxfile(xml);
    expect(xml).toContain('<mxCell id="0"');
    expect(xml).toContain('<mxCell id="1"');
    expect(xml).not.toContain('id="sketch-bg"');
    expect(countImageCells(xml)).toBe(0);

    const ids = [...xml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const cellIds = [...xml.matchAll(/<mxCell\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(cellIds).size).toBe(cellIds.length);
    expect(ids).toEqual(expect.arrayContaining(['0', '1', 'shape-input', 'conn-in-hid', 'text-title']));

    const connector = openingCell(xml, 'conn-in-hid');
    expect(connector).toMatch(/\bedge="1"/);
    expect(connector).not.toMatch(/\bvertex="1"/);
    expect(connector).toMatch(/\bsource="shape-input"/);
    expect(connector).toMatch(/\btarget="shape-hidden"/);

    for (const id of ['shape-input', 'shape-hidden', 'shape-output', 'text-title']) {
      const cell = openingCell(xml, id);
      expect(cell).toMatch(/\bvertex="1"/);
      expect(cell).not.toMatch(/\bedge="1"/);
    }
  });

  it('XML-escapes value text (& < > ")', () => {
    const spec = nativeLayerSpec('escape', false);
    spec.panels[0]!.objects[4] = {
      ...spec.panels[0]!.objects[4]!,
      id: 'text-title',
      text: 'A & B <C> "D"',
    };
    const xml = drawioFromSpec(spec);
    const cell = openingCell(xml, 'text-title');
    expect(cell).toContain('value="A &amp; B &lt;C&gt; &quot;D&quot;"');
    expect(cell).not.toMatch(/value="[^"]*&[a-z]*[^;"]*"/);
  });

  it('emits image cells only for atomic-raster that already has rasterReason', () => {
    const base = nativeLayerSpec('raster-gate', false);
    const smuggled: FigureObjectSpec = {
      id: 'shape-smuggle',
      kind: 'shape',
      x: 80,
      y: 80,
      w: 120,
      h: 80,
      style: { shape: 'image', image: 'data:image/png,abc' },
      text: 'not a raster',
    };
    const raster: FigureObjectSpec = {
      id: 'raster-field',
      kind: 'atomic-raster',
      x: 400,
      y: 80,
      w: 200,
      h: 160,
      rasterReason: 'irreducible-micrograph',
      style: { image: 'data:image/png,abc' },
    };
    base.panels[0]!.objects.push(smuggled, raster);

    const xml = drawioFromSpec(base);
    const smuggleCell = openingCell(xml, 'shape-smuggle');
    expect(smuggleCell).not.toMatch(/shape=image/i);
    expect(smuggleCell).not.toMatch(/image=data/i);
    expect(smuggleCell).toMatch(/\bvertex="1"/);

    const rasterCell = openingCell(xml, 'raster-field');
    expect(rasterCell).toMatch(/shape=image/i);
    expect(rasterCell).toMatch(/image=data/i);
    expect(rasterCell).toMatch(/\bvertex="1"/);
    expect(rasterCell).not.toMatch(/\bedge="1"/);
    expect(countImageCells(xml)).toBe(1);
  });

  it('renders table as a vertex, never as an image cell', () => {
    const spec = nativeLayerSpec('table', false);
    spec.panels[0]!.objects.push({
      id: 'table-metrics',
      kind: 'table',
      x: 80,
      y: 560,
      w: 400,
      h: 200,
      text: 'acc | loss',
    });
    const xml = drawioFromSpec(spec);
    const cell = openingCell(xml, 'table-metrics');
    expect(cell).toMatch(/\bvertex="1"/);
    expect(cell).not.toMatch(/\bedge="1"/);
    expect(cell).not.toMatch(/shape=image/i);
    expect(countImageCells(xml)).toBe(0);
  });

  it('throws when label/value smuggles an html img or data:image sketch', () => {
    const imgSpec = nativeLayerSpec('img-smuggle', false);
    imgSpec.panels[0]!.objects[4] = {
      ...imgSpec.panels[0]!.objects[4]!,
      text: '<img src="sketch.png" alt="backdrop">',
    };
    expect(() => drawioFromSpec(imgSpec)).toThrow(/<img|data:image/i);

    const dataSpec = nativeLayerSpec('data-image-smuggle', false);
    dataSpec.panels[0]!.objects[0] = {
      ...dataSpec.panels[0]!.objects[0]!,
      label: 'layer data:image/png;base64,abc',
    };
    expect(() => drawioFromSpec(dataSpec)).toThrow(/<img|data:image/i);
  });

  it('throws when a style value smuggles extra tokens via ";"', () => {
    const spec = nativeLayerSpec('style-smuggle', false);
    spec.panels[0]!.objects[0] = {
      ...spec.panels[0]!.objects[0]!,
      style: { fillColor: '#E7F0F8;shape=image' },
    };
    expect(() => drawioFromSpec(spec)).toThrow(/;/);
  });

  it('emits an atomic-raster image cell when rasterReason and fixture data URI are present', () => {
    const spec = nativeLayerSpec('raster-fixture-uri', false);
    spec.panels[0]!.objects.push({
      id: 'raster-fixture',
      kind: 'atomic-raster',
      x: 400,
      y: 80,
      w: 200,
      h: 160,
      rasterReason: 'irreducible-micrograph',
      style: {
        image:
          'data:image/png,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      },
    });
    const xml = drawioFromSpec(spec);
    const cell = openingCell(xml, 'raster-fixture');
    expect(cell).toMatch(/shape=image/i);
    expect(cell).toMatch(/image=data/i);
    expect(cell).toContain(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    );
    expect(countImageCells(xml)).toBe(1);
  });

  it('throws when geometry is not finite or a connector endpoint is missing from the spec', () => {
    const nanSpec = nativeLayerSpec('nan-geom', false);
    nanSpec.panels[0]!.objects[0] = { ...nanSpec.panels[0]!.objects[0]!, w: Number.NaN };
    expect(() => drawioFromSpec(nanSpec)).toThrow(/non-finite w/);

    const dangling = nativeLayerSpec('dangling-connector', false);
    dangling.panels[0]!.objects[3] = {
      ...dangling.panels[0]!.objects[3]!,
      targetId: 'missing-layer',
    };
    expect(() => drawioFromSpec(dangling)).toThrow(/targetId 'missing-layer'/);
  });
});
