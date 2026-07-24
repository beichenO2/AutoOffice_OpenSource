import { describe, it, expect } from 'vitest';
import {
  assertProfile,
  assertRule,
  demoProfiles,
  demoRules,
  validateProfile,
  validateRule,
} from '../../../src/engine/standards/index.js';
import { makeRule, makeProfile } from './helpers.js';

describe('standards schemas — rule', () => {
  it('accepts a valid rule', () => {
    const r = validateRule(makeRule({ id: 'r_ok' }));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects an unknown target', () => {
    const r = validateRule({ ...makeRule({ id: 'r_bad' }), target: 'vibes' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('target'))).toBe(true);
  });

  it('rejects an unknown sourceType', () => {
    const r = validateRule({ ...makeRule({ id: 'r_bad' }), sourceType: 'galaxy' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('sourceType'))).toBe(true);
  });

  it('rejects an unknown level', () => {
    const r = validateRule({ ...makeRule({ id: 'r_bad' }), level: 'optional' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('level'))).toBe(true);
  });

  it('rejects a missing required field', () => {
    const bad = { ...makeRule({ id: 'r_bad' }) } as Record<string, unknown>;
    delete bad.explanation;
    const r = validateRule(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('explanation'))).toBe(true);
  });

  it('rejects unexpected properties (additional=false)', () => {
    const r = validateRule({ ...makeRule({ id: 'r_bad' }), hacky: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('unexpected'))).toBe(true);
  });

  it('assertRule throws with an aggregated message', () => {
    expect(() => assertRule({})).toThrow(/Invalid StandardRule/);
  });
});

describe('standards schemas — profile', () => {
  it('accepts a valid profile', () => {
    const r = validateProfile(makeProfile({ id: 'p_ok' }));
    expect(r.ok).toBe(true);
  });

  it('rejects an empty docTypes list', () => {
    const r = validateProfile({ ...makeProfile({ id: 'p_bad' }), docTypes: [] });
    expect(r.ok).toBe(false);
  });

  it('assertProfile throws for garbage', () => {
    expect(() => assertProfile(42)).toThrow(/Invalid StandardProfile/);
  });
});

describe('standards fixtures — integrity & honesty discipline', () => {
  it('every demo rule and profile passes its runtime schema', () => {
    for (const rule of demoRules()) expect(() => assertRule(rule)).not.toThrow();
    for (const profile of demoProfiles()) expect(() => assertProfile(profile)).not.toThrow();
  });

  it('rule ids are unique and every profile ruleId exists', () => {
    const rules = demoRules();
    const ids = new Set(rules.map((rule) => rule.id));
    expect(ids.size).toBe(rules.length);
    for (const profile of demoProfiles()) {
      for (const ruleId of profile.ruleIds) expect(ids.has(ruleId)).toBe(true);
    }
  });

  it('never presents a national standard code as verified: any GB/T mention is not_verified', () => {
    const rules = demoRules();
    const gbRules = rules.filter((rule) => /GB\/T/i.test(rule.standardCode));
    expect(gbRules).toHaveLength(1);
    const gb = gbRules[0];
    expect(gb?.verification).toBe('not_verified');
    expect(gb?.standardCode).toContain('未核实');
    expect(gb?.citation).toEqual({});
  });

  it('all demo-verification rules are labelled as fixtures, not real standards', () => {
    for (const rule of demoRules().filter((r) => r.verification === 'demo')) {
      expect(rule.issuer).toBe('AutoOffice Demo Fixture');
      expect(rule.citation.clause).toContain('非真实标准条文');
    }
  });

  it('ships the required demo coverage: thesis 8+ rules, deck 5+ rules, 1 project override', () => {
    const profiles = demoProfiles();
    const thesis = profiles.find((p) => p.id === 'profile_demo_thesis');
    const deck = profiles.find((p) => p.id === 'profile_demo_deck');
    const overlay = profiles.find((p) => p.id === 'profile_demo_project_overlay');
    expect(thesis?.ruleIds.length).toBeGreaterThanOrEqual(8);
    expect(deck?.ruleIds.length).toBeGreaterThanOrEqual(5);
    const overrideRule = demoRules().find((r) => r.id === overlay?.ruleIds[0]);
    expect(overrideRule?.sourceType).toBe('project');
    expect(overrideRule?.overrideOf).toBe('rule_demo_thesis_font_base');
  });
});
