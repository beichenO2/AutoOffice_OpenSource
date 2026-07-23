/**
 * Dependency-free structural validator. Model output (edit plans, briefs,
 * annotations) MUST pass validation before it can touch the source tree.
 * Small, deterministic, fully unit-tested — no free-text-to-filesystem path.
 */

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export type Schema =
  | { kind: 'string'; enum?: readonly string[]; minLength?: number; maxLength?: number }
  | { kind: 'number'; min?: number; max?: number; int?: boolean }
  | { kind: 'boolean' }
  | { kind: 'array'; items: Schema; minItems?: number; maxItems?: number }
  | {
      kind: 'object';
      fields: Record<string, { schema: Schema; optional?: boolean }>;
      additional?: boolean;
    }
  | { kind: 'record'; values: Schema }
  | { kind: 'any' };

export function validate(value: unknown, schema: Schema, path = '$'): ValidationResult {
  const errors: string[] = [];
  walk(value, schema, path, errors);
  return { ok: errors.length === 0, errors };
}

export function assertValid(value: unknown, schema: Schema, label = 'value'): void {
  const result = validate(value, schema, '$');
  if (!result.ok) {
    throw new SchemaError(`Invalid ${label}: ${result.errors.join('; ')}`, result.errors);
  }
}

export class SchemaError extends Error {
  readonly errors: string[];
  constructor(message: string, errors: string[]) {
    super(message);
    this.name = 'SchemaError';
    this.errors = errors;
  }
}

function walk(value: unknown, schema: Schema, path: string, errors: string[]): void {
  switch (schema.kind) {
    case 'any':
      return;
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`${path}: expected string, got ${typeName(value)}`);
        return;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push(`${path}: "${value}" not in {${schema.enum.join(', ')}}`);
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path}: string shorter than ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path}: string longer than ${schema.maxLength}`);
      }
      return;
    }
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push(`${path}: expected number, got ${typeName(value)}`);
        return;
      }
      if (schema.int && !Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
      }
      if (schema.min !== undefined && value < schema.min) {
        errors.push(`${path}: ${value} < min ${schema.min}`);
      }
      if (schema.max !== undefined && value > schema.max) {
        errors.push(`${path}: ${value} > max ${schema.max}`);
      }
      return;
    }
    case 'boolean':
      if (typeof value !== 'boolean') {
        errors.push(`${path}: expected boolean, got ${typeName(value)}`);
      }
      return;
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${typeName(value)}`);
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path}: array shorter than ${schema.minItems}`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path}: array longer than ${schema.maxItems}`);
      }
      value.forEach((item, i) => walk(item, schema.items, `${path}[${i}]`, errors));
      return;
    }
    case 'record': {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object, got ${typeName(value)}`);
        return;
      }
      for (const [k, v] of Object.entries(value)) {
        walk(v, schema.values, `${path}.${k}`, errors);
      }
      return;
    }
    case 'object': {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object, got ${typeName(value)}`);
        return;
      }
      const obj = value as Record<string, unknown>;
      for (const [key, spec] of Object.entries(schema.fields)) {
        const present = Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined;
        if (!present) {
          if (!spec.optional) errors.push(`${path}.${key}: required`);
          continue;
        }
        walk(obj[key], spec.schema, `${path}.${key}`, errors);
      }
      if (schema.additional === false) {
        for (const key of Object.keys(obj)) {
          if (!(key in schema.fields)) errors.push(`${path}.${key}: unexpected property`);
        }
      }
      return;
    }
  }
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---- Concrete schemas -------------------------------------------------------

const EDIT_OP_TYPES = [
  'replaceText',
  'setStyle',
  'setAttr',
  'insertAfter',
  'insertBefore',
  'remove',
  'wrap',
  'replaceSource',
] as const;

const EDIT_KINDS = ['content', 'style', 'layout', 'structure', 'media'] as const;
const EDIT_SCOPES = ['local', 'multi'] as const;

export const editOpSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    op: { schema: { kind: 'string', enum: EDIT_OP_TYPES } },
    nodeId: { schema: { kind: 'string', minLength: 1 } },
    payload: { schema: { kind: 'record', values: { kind: 'any' } } },
  },
};

export const editIntentSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    id: { schema: { kind: 'string', minLength: 1 } },
    projectId: { schema: { kind: 'string', minLength: 1 } },
    baseRevisionId: { schema: { kind: 'string', minLength: 1 } },
    kind: { schema: { kind: 'string', enum: EDIT_KINDS } },
    scope: { schema: { kind: 'string', enum: EDIT_SCOPES } },
    targetNodeIds: { schema: { kind: 'array', items: { kind: 'string', minLength: 1 }, minItems: 1 } },
    instruction: { schema: { kind: 'string' } },
    operations: { schema: { kind: 'array', items: editOpSchema, minItems: 1 } },
    confidence: { schema: { kind: 'number', min: 0, max: 1 } },
    rationale: { schema: { kind: 'string' } },
    allowedNodeIds: { schema: { kind: 'array', items: { kind: 'string', minLength: 1 }, minItems: 1 } },
  },
};

export const briefSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    id: { schema: { kind: 'string', minLength: 1 } },
    projectId: { schema: { kind: 'string', minLength: 1 } },
    docType: { schema: { kind: 'string', minLength: 1 } },
    audience: { schema: { kind: 'string' } },
    scenario: { schema: { kind: 'string' } },
    contentGoals: { schema: { kind: 'array', items: { kind: 'string' } } },
    materials: { schema: { kind: 'array', items: { kind: 'string' } } },
    lengthPages: { schema: { kind: 'number', min: 1, int: true }, optional: true },
    deliveryFormats: { schema: { kind: 'array', items: { kind: 'string' } } },
    deadline: { schema: { kind: 'string' }, optional: true },
    standards: { schema: { kind: 'array', items: { kind: 'string' } } },
    preferences: { schema: { kind: 'array', items: { kind: 'string' } } },
    prohibitions: { schema: { kind: 'array', items: { kind: 'string' } } },
    uncertainties: { schema: { kind: 'array', items: { kind: 'string' } } },
    assumptions: { schema: { kind: 'array', items: { kind: 'string' } } },
    createdAt: { schema: { kind: 'string', minLength: 1 } },
  },
};

export const annotationCreateSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    page: { schema: { kind: 'number', min: 1, int: true } },
    rectNorm: {
      schema: {
        kind: 'object',
        additional: false,
        fields: {
          x: { schema: { kind: 'number', min: 0, max: 1 } },
          y: { schema: { kind: 'number', min: 0, max: 1 } },
          w: { schema: { kind: 'number', min: 0, max: 1 } },
          h: { schema: { kind: 'number', min: 0, max: 1 } },
        },
      },
    },
    viewport: {
      schema: {
        kind: 'object',
        additional: true,
        fields: {
          zoom: { schema: { kind: 'number', min: 0 } },
          rotation: { schema: { kind: 'number' } },
          dpr: { schema: { kind: 'number', min: 0 } },
          pageWidthPx: { schema: { kind: 'number', min: 0 } },
          pageHeightPx: { schema: { kind: 'number', min: 0 } },
        },
      },
    },
    instruction: { schema: { kind: 'string', minLength: 1 } },
    nearbyText: { schema: { kind: 'string' }, optional: true },
  },
};
