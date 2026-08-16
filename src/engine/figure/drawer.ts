/**
 * DesignSpec → uncompressed draw.io mxfile (Drawer).
 *
 * Official file discipline: plaintext XML, unique mxCell ids, vertex and edge
 * mutually exclusive, `compressed="false"`. Sketch bytes never become a
 * backdrop image cell. `shape=image` / `image=data` are allowed only on
 * kind=atomic-raster that already carries a rasterReason.
 *
 * Fail-closed: label/value may not embed `<img` / `data:image`; style keys and
 * values may not contain `;`; only style keys may not contain `=` (values may,
 * so base64 padding in `image=` survives; re-checked after assembly).
 */
import type {
  DesignSpec,
  FigureObjectKind,
  FigureObjectSpec,
  FigureObjectStyle,
} from './types.js';

const ROOT_CELL_IDS = new Set(['0', '1']);
const GEOMETRY_KEYS = ['x', 'y', 'w', 'h'] as const;
const EMBEDDED_IMAGE_RE = /<\s*img\b|data:image/i;

const DEFAULT_SHAPE_STYLE = 'rounded=0;whiteSpace=wrap;html=1;';
const DEFAULT_TEXT_STYLE =
  'text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;whiteSpace=wrap;rounded=0;';
const DEFAULT_TABLE_STYLE =
  'shape=table;html=1;whiteSpace=wrap;startSize=0;container=0;collapsible=0;';
const DEFAULT_EDGE_STYLE =
  'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;endArrow=classic;endFill=1;';
const DEFAULT_RASTER_STYLE =
  'shape=image;html=1;imageAspect=0;aspect=fixed;verticalLabelPosition=bottom;verticalAlign=top;';

interface StyleMap {
  flags: string[];
  pairs: Map<string, string>;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function collectObjects(spec: DesignSpec): FigureObjectSpec[] {
  return spec.panels.flatMap((panel) => panel.objects);
}

function assertUniqueObjectIds(objects: FigureObjectSpec[]): void {
  const seen = new Set<string>();
  for (const object of objects) {
    const id = object.id?.trim() ?? '';
    if (!id) {
      throw new Error('Figure object is missing a non-empty id');
    }
    if (ROOT_CELL_IDS.has(id)) {
      throw new Error(`Figure object id '${id}' is reserved for mxGraph root cells`);
    }
    if (seen.has(id)) {
      throw new Error(`Figure object id '${id}' is not unique`);
    }
    seen.add(id);
  }
}

function assertFiniteGeometry(object: FigureObjectSpec): void {
  for (const key of GEOMETRY_KEYS) {
    if (!Number.isFinite(object[key])) {
      throw new Error(`Figure object '${object.id}' has non-finite ${key}`);
    }
  }
}

function assertNoEmbeddedImage(object: FigureObjectSpec): void {
  for (const field of ['text', 'label'] as const) {
    const raw = object[field];
    if (raw === undefined || raw === '') continue;
    if (EMBEDDED_IMAGE_RE.test(raw)) {
      throw new Error(
        `Figure object '${object.id}' ${field} embeds <img or data:image; sketches cannot be rendered through html=1`,
      );
    }
  }
}

function assertConnectorEndpoints(object: FigureObjectSpec, ids: Set<string>): void {
  if (object.kind !== 'connector') return;
  for (const field of ['sourceId', 'targetId'] as const) {
    const endpoint = object[field];
    if (endpoint === undefined) continue;
    if (!ids.has(endpoint)) {
      throw new Error(
        `Connector '${object.id}' ${field} '${endpoint}' is not in the spec id set`,
      );
    }
  }
}

function assertObjectInvariants(objects: FigureObjectSpec[]): void {
  assertUniqueObjectIds(objects);
  const ids = new Set(objects.map((object) => object.id));
  for (const object of objects) {
    assertFiniteGeometry(object);
    assertNoEmbeddedImage(object);
    assertConnectorEndpoints(object, ids);
  }
}

function hasRasterReason(object: FigureObjectSpec): boolean {
  return Boolean(object.rasterReason && object.rasterReason.trim());
}

function allowsImageCell(object: FigureObjectSpec): boolean {
  return object.kind === 'atomic-raster' && hasRasterReason(object);
}

function isImageStyleEntry(key: string, value: string): boolean {
  if (key === 'image') return true;
  if (key === 'shape' && value.toLowerCase() === 'image') return true;
  return false;
}

function assertStyleAtom(objectId: string, kind: 'key' | 'value', token: string, name: string): void {
  if (token.includes(';')) {
    throw new Error(`Figure object '${objectId}' style ${kind} '${name}' contains ';'`);
  }
  if (kind === 'key' && token.includes('=')) {
    throw new Error(`Figure object '${objectId}' style key '${name}' contains '='`);
  }
}

function parseStyle(style: string): StyleMap {
  const flags: string[] = [];
  const pairs = new Map<string, string>();
  for (const part of style.split(';')) {
    const token = part.trim();
    if (!token) continue;
    const eq = token.indexOf('=');
    if (eq === -1) {
      flags.push(token);
      continue;
    }
    pairs.set(token.slice(0, eq), token.slice(eq + 1));
  }
  return { flags, pairs };
}

function formatStyle(map: StyleMap): string {
  const flags = map.flags.join(';');
  const pairs = [...map.pairs.entries()].map(([key, value]) => `${key}=${value}`).join(';');
  const body = [flags, pairs].filter(Boolean).join(';');
  return body ? `${body};` : '';
}

function assertAssembledStyle(objectId: string, style: string): void {
  const tokens = style.split(';');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') {
    tokens.pop();
  }
  if (tokens.some((token) => token === '')) {
    throw new Error(`Figure object '${objectId}' assembled style has an empty token`);
  }
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq === -1) {
      assertStyleAtom(objectId, 'key', token, token);
      continue;
    }
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    assertStyleAtom(objectId, 'key', key, key);
    assertStyleAtom(objectId, 'value', value, key);
  }
}

function stripImageStyle(map: StyleMap): void {
  map.pairs.delete('image');
  if (map.pairs.get('shape')?.toLowerCase() === 'image') {
    map.pairs.delete('shape');
  }
}

function styleValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

function defaultStyleFor(kind: FigureObjectKind, allowImage: boolean): string {
  switch (kind) {
    case 'text':
      return DEFAULT_TEXT_STYLE;
    case 'table':
      return DEFAULT_TABLE_STYLE;
    case 'connector':
      return DEFAULT_EDGE_STYLE;
    case 'atomic-raster':
      return allowImage ? DEFAULT_RASTER_STYLE : DEFAULT_SHAPE_STYLE;
    case 'shape':
    default:
      return DEFAULT_SHAPE_STYLE;
  }
}

function serializeStyle(object: FigureObjectSpec, allowImage: boolean): string {
  const map = parseStyle(defaultStyleFor(object.kind, allowImage));
  const style = object.style ?? ({} as FigureObjectStyle);
  for (const [key, raw] of Object.entries(style)) {
    if (raw === undefined) continue;
    const value = styleValue(raw);
    assertStyleAtom(object.id, 'key', key, key);
    assertStyleAtom(object.id, 'value', value, key);
    if (!allowImage && isImageStyleEntry(key, value)) continue;
    map.pairs.set(key, value);
  }
  if (allowImage) {
    map.pairs.set('shape', 'image');
  } else {
    stripImageStyle(map);
  }
  const assembled = formatStyle(map);
  assertAssembledStyle(object.id, assembled);
  return assembled;
}

function cellValue(object: FigureObjectSpec): string {
  return object.text ?? object.label ?? '';
}

function geometryAttrs(object: FigureObjectSpec): string {
  return `x="${object.x}" y="${object.y}" width="${object.w}" height="${object.h}"`;
}

function renderVertex(object: FigureObjectSpec, allowImage: boolean): string {
  const style = escapeXml(serializeStyle(object, allowImage));
  const value = escapeXml(cellValue(object));
  const id = escapeXml(object.id);
  return `        <mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1">
          <mxGeometry ${geometryAttrs(object)} as="geometry"/>
        </mxCell>`;
}

function renderEdge(object: FigureObjectSpec): string {
  const style = escapeXml(serializeStyle(object, false));
  const value = escapeXml(cellValue(object));
  const id = escapeXml(object.id);
  const source = object.sourceId ? ` source="${escapeXml(object.sourceId)}"` : '';
  const target = object.targetId ? ` target="${escapeXml(object.targetId)}"` : '';
  return `        <mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1"${source}${target}>
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>`;
}

function renderObject(object: FigureObjectSpec): string {
  if (object.kind === 'connector') {
    return renderEdge(object);
  }
  return renderVertex(object, allowsImageCell(object));
}

/**
 * Emit an uncompressed mxfile. Page size comes from spec (locked 1600×900).
 * Does not paste a sketch as a background image.
 */
export function drawioFromSpec(spec: DesignSpec): string {
  const objects = collectObjects(spec);
  assertObjectInvariants(objects);
  const cells = objects.map(renderObject).join('\n');
  const title = escapeXml(spec.title || 'Page-1');
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="AutoOffice" compressed="false" agent="autooffice-figure-drawer" version="22.1.0" type="device">
  <diagram id="figure" name="${title}">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${spec.pageWidth}" pageHeight="${spec.pageHeight}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
`;
}
