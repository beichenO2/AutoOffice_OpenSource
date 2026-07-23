import { describe, it, expect } from 'vitest';
import { validate, assertValid, editIntentSchema, briefSchema } from '../../src/engine/schema.js';
import type { EditIntent } from '../../src/engine/types.js';

const validIntent: EditIntent = {
  id: 'ei_1',
  projectId: 'p_1',
  baseRevisionId: 'rev_1',
  kind: 'content',
  scope: 'local',
  targetNodeIds: ['n_1'],
  instruction: 'make it formal',
  operations: [{ op: 'replaceText', nodeId: 'n_1', payload: { text: 'Hello' } }],
  confidence: 0.9,
  rationale: 'high confidence single node',
  allowedNodeIds: ['n_1'],
};

describe('schema — editIntent', () => {
  it('accepts a valid edit intent', () => {
    const r = validate(validIntent, editIntentSchema);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects missing required field', () => {
    const bad = { ...validIntent } as Record<string, unknown>;
    delete bad.operations;
    const r = validate(bad, editIntentSchema);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('operations'))).toBe(true);
  });

  it('rejects confidence out of range', () => {
    const r = validate({ ...validIntent, confidence: 1.5 }, editIntentSchema);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejects invalid op enum', () => {
    const r = validate(
      { ...validIntent, operations: [{ op: 'nuke', nodeId: 'n_1', payload: {} }] },
      editIntentSchema,
    );
    expect(r.ok).toBe(false);
  });

  it('rejects unexpected property (additional=false)', () => {
    const r = validate({ ...validIntent, danger: true }, editIntentSchema);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('unexpected'))).toBe(true);
  });

  it('rejects empty operations array', () => {
    const r = validate({ ...validIntent, operations: [] }, editIntentSchema);
    expect(r.ok).toBe(false);
  });

  it('assertValid throws with aggregated errors', () => {
    expect(() => assertValid({}, editIntentSchema, 'EditIntent')).toThrow(/Invalid EditIntent/);
  });
});

describe('schema — brief', () => {
  it('accepts a minimal valid brief', () => {
    const r = validate(
      {
        id: 'b_1',
        projectId: 'p_1',
        docType: 'report',
        audience: 'exec',
        scenario: 'quarterly',
        contentGoals: ['a'],
        materials: [],
        deliveryFormats: ['pdf'],
        standards: [],
        preferences: [],
        prohibitions: [],
        uncertainties: [],
        assumptions: [],
        createdAt: '2020-01-01T00:00:00.000Z',
      },
      briefSchema,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects non-integer lengthPages', () => {
    const r = validate(
      {
        id: 'b_1',
        projectId: 'p_1',
        docType: 'report',
        audience: '',
        scenario: '',
        contentGoals: [],
        materials: [],
        lengthPages: 2.5,
        deliveryFormats: [],
        standards: [],
        preferences: [],
        prohibitions: [],
        uncertainties: [],
        assumptions: [],
        createdAt: 'x',
      },
      briefSchema,
    );
    expect(r.ok).toBe(false);
  });
});
