import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type AddressInfo } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Ajv from 'ajv';
import {
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  type DesignSpec,
  type FigureInterpreter,
  type FigureObjectSpec,
  type FigureSketch,
} from '../../src/engine/figure/types.js';
import { createFigure } from '../../src/engine/figure/pipeline.js';
import { auditDrawioXml } from '../../src/engine/figure/audit.js';
import { drawioFromSpec } from '../../src/engine/figure/drawer.js';
import { designSpecFromInput } from '../../src/engine/figure/designer.js';
import { EngineService, setEngineServiceForTests } from '../../src/engine/service.js';
import { mountEngineRoutes } from '../../src/engine/routes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const contractsDir = resolve(repoRoot, 'contracts');
const fixtureDir = resolve(repoRoot, 'tests/fixtures/scientific-figure');

function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

const prompt = readFileSync(resolve(fixtureDir, 'prompt.txt'), 'utf-8').trim();
const sketchSvg = readFileSync(resolve(fixtureDir, 'sketch.svg'), 'utf-8');
const sketch: FigureSketch = {
  mime: 'image/svg+xml',
  data: Buffer.from(sketchSvg, 'utf-8').toString('base64'),
};

const RASTER_HARD_CATEGORIES = new Set([
  'whole-sketch-raster',
  'possible-composite-raster',
  'large-raster-surface',
]);

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

/** Image-typed mxCell count. Per-cell only — not id=sketch-bg, not pageWidth on mxGraphModel. */
function countImageCells(xml: string): number {
  const cells = xml.match(/<mxCell\b[^>]*>/g) ?? [];
  return cells.filter((cell) => /shape=image/i.test(cell) || /image=data/i.test(cell)).length;
}

function fullPageRasterSpec(sourcePrompt: string): DesignSpec {
  return {
    title: 'forbidden whole-page raster',
    pageWidth: FIGURE_PAGE_WIDTH,
    pageHeight: FIGURE_PAGE_HEIGHT,
    sourcePrompt,
    sketchUsed: true,
    ambiguities: [],
    panels: [
      {
        id: 'panel-raster',
        title: 'raster',
        objects: [
          {
            id: 'raster-full',
            kind: 'atomic-raster',
            x: 0,
            y: 0,
            w: FIGURE_PAGE_WIDTH,
            h: FIGURE_PAGE_HEIGHT,
            rasterReason: 'other-atomic',
          },
        ],
      },
    ],
  };
}

describe('schema', () => {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = loadJson(resolve(contractsDir, 'figure.schema.json'));
  const example = loadJson(resolve(contractsDir, 'examples/figure.example.json'));
  const validate = ajv.compile(schema as object);
  const validateDesign = ajv.compile({
    $ref: 'autooffice/figure#/definitions/DesignSpec',
  });

  it('figure.example.json satisfies figure.schema.json', () => {
    expect(validate(example)).toBe(true);
  });

  it('rejects an object missing prompt', () => {
    expect(validate({ sketch })).toBe(false);
    expect(validate({})).toBe(false);
  });

  it('rejects empty prompt', () => {
    expect(validate({ prompt: '' })).toBe(false);
  });

  it('DesignSpec definition accepts the locked 1600×900 native layout', () => {
    expect(validateDesign(nativeLayerSpec(prompt, true))).toBe(true);
  });

  it('DesignSpec definition rejects a foreign page size', () => {
    expect(
      validateDesign({
        ...nativeLayerSpec(prompt, false),
        pageWidth: 1169,
        pageHeight: 827,
      } as Record<string, unknown>),
    ).toBe(false);
  });
});

describe('auditDrawioXml', () => {
  it('flags a whole-sketch image cell as a hard raster finding', () => {
    const xml = readFileSync(resolve(fixtureDir, 'whole-sketch.drawio'), 'utf-8');
    const result = auditDrawioXml(xml);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' && RASTER_HARD_CATEGORIES.has(String(finding.category)),
      ),
    ).toBe(true);
  });

  it('flags a large non-full-page image cell as a hard raster finding', () => {
    const xml = readFileSync(resolve(fixtureDir, 'composite-raster.drawio'), 'utf-8');
    expect(xml).not.toContain('id="sketch-bg"');
    expect(countImageCells(xml)).toBe(1);
    const result = auditDrawioXml(xml);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' && RASTER_HARD_CATEGORIES.has(String(finding.category)),
      ),
    ).toBe(true);
  });

  it('rejects illegal XML', () => {
    const result = auditDrawioXml('<<<not-xml');
    expect(result.ok).toBe(false);
  });
});

describe('drawioFromSpec', () => {
  it('emits named mxCells and a connector edge without a whole-page image', () => {
    const spec = nativeLayerSpec(prompt, false);
    const xml = drawioFromSpec(spec);
    expect(xml).toMatch(/<mxfile\b/);
    expect(xml).toContain(`pageWidth="${FIGURE_PAGE_WIDTH}"`);
    expect(xml).toContain(`pageHeight="${FIGURE_PAGE_HEIGHT}"`);
    for (const object of collectObjects(spec)) {
      expect(xml).toContain(`id="${object.id}"`);
    }
    expect(xml).toMatch(/id="conn-in-hid"[^>]*\bedge="1"/);
    expect(countImageCells(xml)).toBe(0);
  });
});

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
});

describe('createFigure pipeline', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'ao-fig-pipe-'));
  });

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('deterministic interpreter emits no raster objects', async () => {
    const spec = await deterministicInterpreter.interpret({ prompt, sketch });
    expect(collectObjects(spec).every((object) => object.kind !== 'atomic-raster')).toBe(true);
    expect(collectObjects(spec).every((object) => !object.rasterReason)).toBe(true);
  });

  it('throws when prompt is empty', async () => {
    await expect(createFigure({ prompt: '' }, { interpreter: deterministicInterpreter })).rejects.toThrow(
      /prompt/i,
    );
    await expect(
      createFigure({ prompt: '   ' }, { interpreter: deterministicInterpreter }),
    ).rejects.toThrow(/prompt/i);
  });

  it('returns an audited draw.io figure from prompt + sketch + injected interpreter', async () => {
    const result = await createFigure(
      { prompt, sketch },
      { interpreter: deterministicInterpreter, outputDir },
    );
    expect(result.drawioXml).toMatch(/<mxfile\b/);
    expect(result.audit.hardCount).toBe(0);
    expect(collectObjects(result.designSpec).every((object) => object.kind !== 'atomic-raster')).toBe(
      true,
    );
    expect(countImageCells(result.drawioXml)).toBe(0);
    expect(result.designSpec.sourcePrompt).toBe(prompt);
    expect(result.designSpec.sketchUsed).toBe(true);
    expect(result.figureId.length).toBeGreaterThan(0);
    expect(result.drawioPath).toMatch(/\.drawio$/);
  });

  /**
   * Contract: pipeline MUST run audit on drawer XML.
   * A full-page atomic-raster DesignSpec is accepted as interpreter output
   * but must not be delivered clean — we require `audit.hardCount > 0`
   * (not a throw). Empty prompt is the only pipeline throw in this slice.
   */
  it('surfaces audit hard findings when the interpreter returns a full-page raster', async () => {
    const rasterInterpreter: FigureInterpreter = {
      interpret: async (input) => fullPageRasterSpec(input.prompt),
    };
    const result = await createFigure(
      { prompt, sketch },
      { interpreter: rasterInterpreter, outputDir },
    );
    expect(result.audit.hardCount).toBeGreaterThan(0);
    expect(
      result.audit.findings.some((finding) => finding.category === 'invalid-design-spec'),
    ).toBe(false);
  });

  it('flags atomic-raster without rasterReason as an invalid-design-spec hard finding', async () => {
    const nakedRaster: FigureInterpreter = {
      interpret: async (input) => ({
        title: 'naked raster',
        pageWidth: FIGURE_PAGE_WIDTH,
        pageHeight: FIGURE_PAGE_HEIGHT,
        sourcePrompt: input.prompt,
        sketchUsed: false,
        ambiguities: [],
        panels: [
          {
            id: 'panel-bad',
            title: 'bad',
            objects: [
              {
                id: 'raster-naked',
                kind: 'atomic-raster',
                x: 10,
                y: 10,
                w: 100,
                h: 80,
              },
            ],
          },
        ],
      }),
    };
    const result = await createFigure({ prompt }, { interpreter: nakedRaster, outputDir });
    expect(result.audit.ok).toBe(false);
    expect(result.audit.hardCount).toBeGreaterThan(0);
    expect(
      result.audit.findings.some(
        (finding) => finding.category === 'invalid-design-spec' && finding.severity === 'hard',
      ),
    ).toBe(true);
  });
});

describe('createFigure default PolarPrivate path (V0000)', () => {
  it('sends V0000 + sketch data URI and audits a native-layer reply', async () => {
    const prevInterpreter = process.env.AUTOOFFICE_ENGINE_INTERPRETER;
    const prevPort = process.env.POLARPRIVATE_PORT;
    delete process.env.AUTOOFFICE_ENGINE_INTERPRETER;

    const captured: Array<{
      model?: string;
      messages?: Array<{
        content?: Array<{ type?: string; image_url?: { url?: string } } | string>;
      }>;
    }> = [];

    const stub = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        res.writeHead(404);
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        captured.push(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as (typeof captured)[0]);
        const spec = nativeLayerSpec(prompt, true);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(spec) } }],
          }),
        );
      });
    });

    const outputDir = await mkdtemp(join(tmpdir(), 'ao-fig-v0000-'));
    await new Promise<void>((resolve) => {
      stub.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = stub.address() as AddressInfo;
    process.env.POLARPRIVATE_PORT = String(port);

    try {
      const result = await createFigure({ prompt, sketch }, { outputDir });
      expect(captured).toHaveLength(1);
      expect(captured[0]!.model).toBe('V0000');
      const content = captured[0]!.messages?.[0]?.content;
      expect(Array.isArray(content)).toBe(true);
      const imagePart = (content as Array<{ type?: string; image_url?: { url?: string } }>).find(
        (part) => part.type === 'image_url',
      );
      expect(imagePart?.image_url?.url).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(result.drawioXml).toMatch(/<mxfile\b/);
      expect(result.audit.hardCount).toBe(0);
      expect(countImageCells(result.drawioXml)).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        stub.close((err) => (err ? reject(err) : resolve()));
      });
      if (prevInterpreter === undefined) delete process.env.AUTOOFFICE_ENGINE_INTERPRETER;
      else process.env.AUTOOFFICE_ENGINE_INTERPRETER = prevInterpreter;
      if (prevPort === undefined) delete process.env.POLARPRIVATE_PORT;
      else process.env.POLARPRIVATE_PORT = prevPort;
      await rm(outputDir, { recursive: true, force: true });
    }
  });
});

describe('POST /api/engine/figures (in-process)', () => {
  let baseUrl = '';
  let engineRoot = '';
  let server: ReturnType<typeof createServer> | undefined;
  let prevInterpreter: string | undefined;

  beforeAll(async () => {
    prevInterpreter = process.env.AUTOOFFICE_ENGINE_INTERPRETER;
    process.env.AUTOOFFICE_ENGINE_INTERPRETER = 'deterministic';
    engineRoot = await mkdtemp(join(tmpdir(), 'ao-fig-api-'));
    const app = express();
    app.use(express.json({ limit: '2mb' }));
    setEngineServiceForTests(new EngineService({ root: engineRoot }));
    mountEngineRoutes(app);
    server = createServer(app);
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((err) => (err ? reject(err) : resolve()));
    });
    setEngineServiceForTests(null);
    if (prevInterpreter === undefined) delete process.env.AUTOOFFICE_ENGINE_INTERPRETER;
    else process.env.AUTOOFFICE_ENGINE_INTERPRETER = prevInterpreter;
    if (engineRoot) await rm(engineRoot, { recursive: true, force: true });
  });

  async function postFigures(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${baseUrl}/api/engine/figures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  it('returns 400 when prompt is missing, empty, or whitespace', async () => {
    for (const body of [{}, { prompt: '' }, { prompt: '   ' }]) {
      const res = await postFigures(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.json)).toMatch(/prompt/i);
    }
  });

  it('returns 201 with an audited native-layer figure', async () => {
    const res = await postFigures({ prompt, sketch });
    expect(res.status).toBe(201);
    expect(res.json.ok).toBe(true);
    expect(String(res.json.figureId).length).toBeGreaterThan(0);
    expect(String(res.json.drawioXml)).toMatch(/<mxfile\b/);
    expect(String(res.json.drawioPath)).toMatch(/\.drawio$/);
    const audit = res.json.audit as { hardCount: number };
    expect(audit.hardCount).toBe(0);
    const spec = res.json.designSpec as DesignSpec;
    expect(collectObjects(spec).every((object) => object.kind !== 'atomic-raster')).toBe(true);
    expect(countImageCells(String(res.json.drawioXml))).toBe(0);
  });

  it('returns 404 when attachToProjectId is missing', async () => {
    const res = await postFigures({ prompt, attachToProjectId: 'proj_missing' });
    expect(res.status).toBe(404);
  });
});
