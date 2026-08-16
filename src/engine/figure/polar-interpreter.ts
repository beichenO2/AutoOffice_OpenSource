/**
 * Production figure interpreter: deterministic native-layer stub, or PolarPrivate V0000.
 *
 * Never generates pictures. Never copies sketch bytes onto the DesignSpec.
 * Wrong page size is left untouched so Designer can fail-close.
 */
import {
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  type DesignSpec,
  type FigureInterpretInput,
  type FigureInterpreter,
  type FigureObjectSpec,
} from './types.js';

const VLM_MODEL = 'V0000';

function polarPrivateV1(): string {
  return `http://127.0.0.1:${process.env.POLARPRIVATE_PORT ?? '12790'}/v1`;
}

function nativeLayerDesignSpec(sourcePrompt: string, sketchUsed: boolean): DesignSpec {
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

function isDeterministicInterpreter(): boolean {
  return (process.env.AUTOOFFICE_ENGINE_INTERPRETER ?? '').trim().toLowerCase() === 'deterministic';
}

const DESIGN_SPEC_PROMPT = `You are the Designer for an editable scientific figure in draw.io.

Return ONE JSON object only (no markdown, no prose) matching this DesignSpec:
{
  "title": string,
  "pageWidth": 1600,
  "pageHeight": 900,
  "panels": [{ "id": string, "title": string, "objects": [FigureObject] }],
  "ambiguities": [{ "id": string, "message": string, "objectIds"?: string[] }],
  "sourcePrompt": string,
  "sketchUsed": boolean
}

FigureObject:
{
  "id": non-empty unique string,
  "kind": "text" | "shape" | "connector" | "table" | "atomic-raster",
  "x": number, "y": number, "w": number, "h": number,
  "label"?: string, "text"?: string,
  "style"?: { fillColor?, strokeColor?, fontColor?, fontSize?, shape?, align?, verticalAlign?, ... },
  "sourceId"?: string, "targetId"?: string,  // required for kind=connector
  "rasterReason"?: "irreducible-photo" | "irreducible-micrograph" | "irreducible-plot-field" | "other-atomic"
}

Hard rules:
- pageWidth MUST be 1600 and pageHeight MUST be 900. Do not pick another size.
- Rebuild boxes, arrows, labels, legends as native text/shape/connector/table cells.
- Do NOT paste the sketch (or any full-page image) onto the canvas.
- Do NOT emit a whole-page or large backdrop raster.
- kind=atomic-raster is allowed ONLY for an irreducible texture/micrograph/plot field, and MUST include a real rasterReason. Never use atomic-raster for the whole sketch.
- sourcePrompt must be the user prompt verbatim. sketchUsed is true iff a sketch image was provided.
- Connectors must reference existing object ids via sourceId and targetId.

User prompt:
`;

type ChatContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

function extractFirstJsonObject(text: string): string | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  return match?.[0];
}

async function interpretViaPolarPrivate(input: FigureInterpretInput): Promise<DesignSpec> {
  const text = `${DESIGN_SPEC_PROMPT}${input.prompt}`;
  let content: ChatContent;
  if (input.sketch?.data) {
    const mime = input.sketch.mime?.trim() || 'image/png';
    const dataUri = `data:${mime};base64,${input.sketch.data}`;
    content = [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: dataUri } },
    ];
  } else {
    content = [{ type: 'text', text }];
  }

  let res: Response;
  try {
    res = await fetch(`${polarPrivateV1()}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{ role: 'user', content }],
        temperature: 0.1,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(300_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`PolarPrivate VLM (V0000) unavailable: ${detail}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`PolarPrivate VLM (V0000) error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  if (!raw.trim()) {
    throw new Error('PolarPrivate VLM (V0000) returned an empty DesignSpec reply');
  }

  const jsonText = extractFirstJsonObject(raw);
  if (!jsonText) {
    throw new Error('PolarPrivate VLM (V0000) reply did not contain valid DesignSpec JSON');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('PolarPrivate VLM (V0000) reply did not contain valid DesignSpec JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PolarPrivate VLM (V0000) reply is not a DesignSpec object');
  }

  return parsed as DesignSpec;
}

/** Default interpreter when tests do not inject one. */
export function defaultFigureInterpreter(): FigureInterpreter {
  if (isDeterministicInterpreter()) {
    return {
      interpret: async (input) => nativeLayerDesignSpec(input.prompt, Boolean(input.sketch)),
    };
  }
  return { interpret: interpretViaPolarPrivate };
}
