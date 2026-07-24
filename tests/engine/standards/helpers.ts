/**
 * Shared builders for Standards Engine tests: valid-by-default rule/profile
 * factories so each test only spells out the fields it cares about.
 */
import type { StandardProfile, StandardRule } from '../../../src/engine/standards/index.js';

export function makeRule(overrides: Partial<StandardRule> & { id: string }): StandardRule {
  return {
    sourceType: 'school',
    standardCode: 'TEST-CODE',
    issuer: 'Test Issuer',
    version: '1.0.0',
    scope: { docTypes: ['thesis'] },
    level: 'recommended',
    severity: 'warning',
    title: '测试规则',
    explanation: '测试用规则解释。',
    target: 'font',
    constraint: {},
    autoFixable: false,
    citation: {},
    verification: 'demo',
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<StandardProfile> & { id: string }): StandardProfile {
  return {
    name: '测试 Profile',
    kind: 'school',
    docTypes: ['thesis'],
    version: '1.0.0',
    description: '测试用 profile。',
    ruleIds: [],
    priority: 10,
    ...overrides,
  };
}
