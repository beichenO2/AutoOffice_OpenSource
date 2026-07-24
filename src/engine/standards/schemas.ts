/**
 * Standards Engine — runtime schemas (import-boundary defense).
 *
 * Rule packs and profiles may arrive from disk, network or model output, so
 * they MUST pass these structural validators before entering the resolver.
 * Unknown target / sourceType / level / severity / verification values are
 * rejected — a typo can not silently disable a check.
 */
import { assertValid, validate } from '../schema.js';
import type { Schema, ValidationResult } from '../schema.js';
import type { StandardProfile, StandardRule } from './types.js';

export const STANDARD_SOURCE_TYPES = [
  'national',
  'industry',
  'school',
  'organization',
  'project',
] as const;

export const RULE_LEVELS = ['mandatory', 'recommended'] as const;

export const RULE_SEVERITIES = ['error', 'warning', 'info'] as const;

export const RULE_VERIFICATIONS = ['verified', 'demo', 'not_verified'] as const;

export const RULE_TARGETS = [
  'page',
  'margin',
  'font',
  'heading',
  'numbering',
  'header_footer',
  'cover',
  'caption',
  'reference',
  'slide',
  'text_overflow',
  'readability',
  'spacing',
  'toc',
] as const;

const citationSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    sourceUrl: { schema: { kind: 'string' }, optional: true },
    fileHash: { schema: { kind: 'string' }, optional: true },
    retrievedAt: { schema: { kind: 'string' }, optional: true },
    clause: { schema: { kind: 'string' }, optional: true },
  },
};

const scopeSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    docTypes: { schema: { kind: 'array', items: { kind: 'string', minLength: 1 } } },
    institutions: {
      schema: { kind: 'array', items: { kind: 'string', minLength: 1 } },
      optional: true,
    },
  },
};

export const standardRuleSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    id: { schema: { kind: 'string', minLength: 1 } },
    sourceType: { schema: { kind: 'string', enum: STANDARD_SOURCE_TYPES } },
    standardCode: { schema: { kind: 'string', minLength: 1 } },
    issuer: { schema: { kind: 'string', minLength: 1 } },
    version: { schema: { kind: 'string', minLength: 1 } },
    publishedAt: { schema: { kind: 'string' }, optional: true },
    effectiveFrom: { schema: { kind: 'string' }, optional: true },
    effectiveTo: { schema: { kind: 'string' }, optional: true },
    scope: { schema: scopeSchema },
    level: { schema: { kind: 'string', enum: RULE_LEVELS } },
    severity: { schema: { kind: 'string', enum: RULE_SEVERITIES } },
    title: { schema: { kind: 'string', minLength: 1 } },
    explanation: { schema: { kind: 'string', minLength: 1 } },
    target: { schema: { kind: 'string', enum: RULE_TARGETS } },
    constraint: { schema: { kind: 'record', values: { kind: 'any' } } },
    autoFixable: { schema: { kind: 'boolean' } },
    citation: { schema: citationSchema },
    verification: { schema: { kind: 'string', enum: RULE_VERIFICATIONS } },
    overrideOf: { schema: { kind: 'string', minLength: 1 }, optional: true },
    overrideReason: { schema: { kind: 'string' }, optional: true },
  },
};

export const standardProfileSchema: Schema = {
  kind: 'object',
  additional: false,
  fields: {
    id: { schema: { kind: 'string', minLength: 1 } },
    name: { schema: { kind: 'string', minLength: 1 } },
    kind: { schema: { kind: 'string', enum: STANDARD_SOURCE_TYPES } },
    docTypes: { schema: { kind: 'array', items: { kind: 'string', minLength: 1 }, minItems: 1 } },
    institution: { schema: { kind: 'string', minLength: 1 }, optional: true },
    version: { schema: { kind: 'string', minLength: 1 } },
    description: { schema: { kind: 'string' } },
    ruleIds: { schema: { kind: 'array', items: { kind: 'string', minLength: 1 } } },
    priority: { schema: { kind: 'number' } },
  },
};

/** Validate without throwing (for UI-facing error lists). */
export function validateRule(value: unknown): ValidationResult {
  return validate(value, standardRuleSchema);
}

/** Validate without throwing (for UI-facing error lists). */
export function validateProfile(value: unknown): ValidationResult {
  return validate(value, standardProfileSchema);
}

/** Throwing gate: everything crossing the import boundary goes through here. */
export function assertRule(value: unknown): StandardRule {
  assertValid(value, standardRuleSchema, 'StandardRule');
  return value as StandardRule;
}

/** Throwing gate: everything crossing the import boundary goes through here. */
export function assertProfile(value: unknown): StandardProfile {
  assertValid(value, standardProfileSchema, 'StandardProfile');
  return value as StandardProfile;
}
