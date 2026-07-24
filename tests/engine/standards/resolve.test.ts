import { describe, it, expect } from 'vitest';
import {
  demoProfiles,
  demoRules,
  resolveApplicableRules,
} from '../../../src/engine/standards/index.js';
import { makeRule, makeProfile } from './helpers.js';

describe('resolve — applicability filtering', () => {
  it('filters out profiles whose docTypes do not match', () => {
    const rule = makeRule({ id: 'r_1' });
    const profile = makeProfile({ id: 'p_1', docTypes: ['thesis'], ruleIds: ['r_1'] });
    const result = resolveApplicableRules([profile], [rule], { docType: 'presentation' });
    expect(result.rules).toEqual([]);
    expect(result.profileIds).toEqual([]);
  });

  it('filters out rules whose own scope.docTypes do not match, even via a broad profile', () => {
    const rule = makeRule({ id: 'r_1', scope: { docTypes: ['thesis'] } });
    const profile = makeProfile({
      id: 'p_1',
      docTypes: ['thesis', 'presentation'],
      ruleIds: ['r_1'],
    });
    const result = resolveApplicableRules([profile], [rule], { docType: 'presentation' });
    expect(result.profileIds).toEqual(['p_1']);
    expect(result.rules).toEqual([]);
  });

  it('applies effectiveFrom/effectiveTo with inclusive boundaries', () => {
    const expired = makeRule({ id: 'r_expired', effectiveTo: '2025-12-31' });
    const future = makeRule({ id: 'r_future', effectiveFrom: '2027-01-01' });
    const open = makeRule({ id: 'r_open' });
    const profile = makeProfile({ id: 'p_1', ruleIds: ['r_expired', 'r_future', 'r_open'] });

    const after = resolveApplicableRules([profile], [expired, future, open], {
      docType: 'thesis',
      date: '2026-01-01',
    });
    expect(after.rules.map((r) => r.id)).toEqual(['r_open']);

    const boundary = resolveApplicableRules([profile], [expired, future, open], {
      docType: 'thesis',
      date: '2025-12-31',
    });
    expect(boundary.rules.map((r) => r.id)).toContain('r_expired');

    const noDate = resolveApplicableRules([profile], [expired, future, open], {
      docType: 'thesis',
    });
    expect(noDate.rules).toHaveLength(3);
  });

  it('keeps an institution-bound profile only for the matching institution', () => {
    const rule = makeRule({ id: 'r_1' });
    const profile = makeProfile({ id: 'p_school', institution: 'A大学', ruleIds: ['r_1'] });

    expect(
      resolveApplicableRules([profile], [rule], { docType: 'thesis' }).profileIds,
    ).toEqual([]);
    expect(
      resolveApplicableRules([profile], [rule], { docType: 'thesis', institution: 'B大学' })
        .profileIds,
    ).toEqual([]);
    expect(
      resolveApplicableRules([profile], [rule], { docType: 'thesis', institution: 'A大学' })
        .rules.map((r) => r.id),
    ).toEqual(['r_1']);
  });

  it('honours rule-level scope.institutions', () => {
    const rule = makeRule({ id: 'r_1', scope: { docTypes: ['thesis'], institutions: ['A大学'] } });
    const profile = makeProfile({ id: 'p_1', ruleIds: ['r_1'] });
    expect(
      resolveApplicableRules([profile], [rule], { docType: 'thesis', institution: 'B大学' }).rules,
    ).toEqual([]);
    expect(
      resolveApplicableRules([profile], [rule], { docType: 'thesis', institution: 'A大学' })
        .rules.map((r) => r.id),
    ).toEqual(['r_1']);
  });
});

describe('resolve — conflict arbitration', () => {
  it('mandatory beats recommended regardless of profile priority, and records the override', () => {
    const mandatory = makeRule({
      id: 'r_mand',
      level: 'mandatory',
      target: 'font',
      constraint: { minPt: 12 },
    });
    const recommended = makeRule({
      id: 'r_rec',
      level: 'recommended',
      target: 'font',
      constraint: { minPt: 14 },
    });
    const low = makeProfile({ id: 'p_low', priority: 10, ruleIds: ['r_mand'] });
    const high = makeProfile({ id: 'p_high', priority: 90, ruleIds: ['r_rec'] });

    const result = resolveApplicableRules([low, high], [mandatory, recommended], {
      docType: 'thesis',
    });
    expect(result.rules.map((r) => r.id)).toEqual(['r_mand']);
    expect(result.conflicts).toEqual([]);
    expect(result.overrides).toHaveLength(1);
    const override = result.overrides[0];
    expect(override?.ruleId).toBe('r_rec');
    expect(override?.overriddenBy).toBe('r_mand');
    expect(override?.reason).toContain('mandatory');
  });

  it('same level: the higher-priority profile wins with an explainable reason', () => {
    const base = makeRule({ id: 'r_base', target: 'font', constraint: { minPt: 12 } });
    const school = makeRule({ id: 'r_school', target: 'font', constraint: { minPt: 14 } });
    const national = makeProfile({ id: 'p_national', priority: 10, ruleIds: ['r_base'] });
    const campus = makeProfile({ id: 'p_campus', priority: 40, ruleIds: ['r_school'] });

    const result = resolveApplicableRules([national, campus], [base, school], {
      docType: 'thesis',
    });
    expect(result.rules.map((r) => r.id)).toEqual(['r_school']);
    const override = result.overrides[0];
    expect(override?.ruleId).toBe('r_base');
    expect(override?.overriddenBy).toBe('r_school');
    expect(override?.reason).toContain('priority 40');
    expect(override?.reason).toContain('priority 10');
  });

  it('mandatory vs mandatory without a priority gap is kept as a visible conflict', () => {
    const a = makeRule({
      id: 'r_a',
      level: 'mandatory',
      target: 'font',
      constraint: { minPt: 12 },
    });
    const b = makeRule({
      id: 'r_b',
      level: 'mandatory',
      target: 'font',
      constraint: { minPt: 14 },
    });
    const profile = makeProfile({ id: 'p_1', ruleIds: ['r_a', 'r_b'] });

    const result = resolveApplicableRules([profile], [a, b], { docType: 'thesis' });
    expect(result.rules.map((r) => r.id).sort()).toEqual(['r_a', 'r_b']);
    expect(result.overrides).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
    const conflict = result.conflicts[0];
    expect(conflict?.ruleIds.sort()).toEqual(['r_a', 'r_b']);
    expect(conflict?.field).toBe('minPt');
    expect(conflict?.resolution).toContain('保留');
  });

  it('explicit overrideOf replaces the base rule and keeps the declared reason', () => {
    const result = resolveApplicableRules(demoProfiles(), demoRules(), {
      docType: 'thesis',
      institution: '演示大学',
      date: '2026-06-01',
    });
    const ids = result.rules.map((r) => r.id);
    expect(ids).toContain('rule_demo_project_font_override');
    expect(ids).not.toContain('rule_demo_thesis_font_base');
    const override = result.overrides.find((o) => o.ruleId === 'rule_demo_thesis_font_base');
    expect(override?.overriddenBy).toBe('rule_demo_project_font_override');
    expect(override?.reason).toContain('14pt');
  });

  it('a recommended rule may not explicitly override a mandatory rule — kept as conflict', () => {
    const mandatory = makeRule({
      id: 'r_mand',
      level: 'mandatory',
      target: 'toc',
      constraint: { required: true },
    });
    const sneaky = makeRule({
      id: 'r_sneaky',
      level: 'recommended',
      target: 'toc',
      constraint: { required: false },
      overrideOf: 'r_mand',
    });
    const profile = makeProfile({ id: 'p_1', ruleIds: ['r_mand', 'r_sneaky'] });

    const result = resolveApplicableRules([profile], [mandatory, sneaky], { docType: 'thesis' });
    expect(result.rules.map((r) => r.id)).toContain('r_mand');
    expect(
      result.conflicts.some((c) => c.field === '(explicit overrideOf)'),
    ).toBe(true);
  });
});
