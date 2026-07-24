import { describe, it, expect } from 'vitest';
import {
  demoProfiles,
  demoRules,
  formatBasisCitation,
  resolveApplicableRules,
  runPreflight,
} from '../../../src/engine/standards/index.js';
import type {
  DocumentFacts,
  ResolvedRuleSet,
  StandardRule,
} from '../../../src/engine/standards/index.js';
import { makeRule } from './helpers.js';

function setOf(rules: StandardRule[]): ResolvedRuleSet {
  return { rules, overrides: [], conflicts: [], profileIds: ['p_test'] };
}

describe('preflight — auto-fixable vs non-fixable', () => {
  it('a failed auto-fixable rule carries a structured suggestedFix.patch', () => {
    const rule = makeRule({
      id: 'r_font',
      target: 'font',
      constraint: { minPt: 12 },
      autoFixable: true,
    });
    const report = runPreflight(setOf([rule]), { kind: 'pdf', baseFontPt: 10 });
    expect(report.findings).toHaveLength(1);
    const finding = report.findings[0];
    expect(finding?.ok).toBe(false);
    expect(finding?.message).toContain('10');
    expect(finding?.message).toContain('12');
    expect(finding?.suggestedFix?.patch).toEqual({ set: { baseFontPt: 12 } });
    expect(report.warnings).toBe(1);
  });

  it('a failed non-fixable rule reports honestly without a patch', () => {
    const rule = makeRule({
      id: 'r_cover',
      target: 'cover',
      constraint: { requiredFields: ['题目', '作者'] },
      autoFixable: false,
      severity: 'error',
      level: 'mandatory',
    });
    const report = runPreflight(setOf([rule]), { kind: 'pdf', coverFields: ['题目'] });
    const finding = report.findings[0];
    expect(finding?.ok).toBe(false);
    expect(finding?.autoFixable).toBe(false);
    expect(finding?.suggestedFix).toBeUndefined();
    expect(finding?.message).toContain('作者');
    expect(report.errors).toBe(1);
    expect(report.ok).toBe(false);
  });
});

describe('preflight — missing facts are visible, never silent', () => {
  it('reports an info finding with skipped=true when facts are absent', () => {
    const rule = makeRule({ id: 'r_font', target: 'font', constraint: { minPt: 12 } });
    const report = runPreflight(setOf([rule]), { kind: 'pdf' });
    const finding = report.findings[0];
    expect(finding?.ok).toBe(true);
    expect(finding?.skipped).toBe(true);
    expect(finding?.severity).toBe('info');
    expect(finding?.message).toContain('无法检查');
    expect(report.infos).toBe(1);
    expect(report.passed).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('targets without extractable facts (spacing) skip honestly', () => {
    const rule = makeRule({ id: 'r_spacing', target: 'spacing', constraint: { minLine: 1.5 } });
    const report = runPreflight(setOf([rule]), { kind: 'pdf' });
    expect(report.findings[0]?.skipped).toBe(true);
    expect(report.infos).toBe(1);
  });
});

describe('preflight — checker behaviours', () => {
  it('emits one finding per offending element for text_overflow, with nodeIds', () => {
    const rule = makeRule({
      id: 'r_overflow',
      target: 'text_overflow',
      constraint: { maxChars: 10 },
      severity: 'error',
      level: 'mandatory',
    });
    const facts: DocumentFacts = {
      kind: 'presentation',
      elements: [
        { nodeId: 'n_long', type: 'text', page: 1, textLength: 50 },
        { nodeId: 'n_out', type: 'text', page: 2, boxNorm: { x: 0.5, y: 0.5, w: 0.6, h: 0.2 } },
        { nodeId: 'n_ok', type: 'text', page: 3, textLength: 5, boxNorm: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
      ],
    };
    const report = runPreflight(setOf([rule]), facts);
    expect(report.findings).toHaveLength(2);
    expect(report.findings.map((f) => f.nodeId).sort()).toEqual(['n_long', 'n_out']);
    expect(report.errors).toBe(2);
  });

  it('detects heading level skips (h1 → h3)', () => {
    const rule = makeRule({
      id: 'r_heading',
      target: 'heading',
      constraint: { maxLevels: 3 },
      severity: 'error',
      level: 'mandatory',
    });
    const report = runPreflight(setOf([rule]), {
      kind: 'pdf',
      headings: [
        { level: 1, text: '绪论' },
        { level: 3, text: '细节' },
      ],
    });
    const finding = report.findings[0];
    expect(finding?.ok).toBe(false);
    expect(finding?.message).toContain('跳级');
  });

  it('checks slide aspect ratio and proposes the fix', () => {
    const rule = makeRule({
      id: 'r_ratio',
      target: 'slide',
      constraint: { aspectRatio: '16:9' },
      severity: 'error',
      level: 'mandatory',
      autoFixable: true,
    });
    const report = runPreflight(setOf([rule]), { kind: 'presentation', aspectRatio: '4:3' });
    const finding = report.findings[0];
    expect(finding?.ok).toBe(false);
    expect(finding?.message).toContain('4:3');
    expect(finding?.suggestedFix?.patch).toEqual({ set: { aspectRatio: '16:9' } });
  });

  it('splits multi-aspect slide constraints into checked and skipped parts', () => {
    const rule = makeRule({
      id: 'r_slide',
      target: 'slide',
      constraint: { aspectRatio: '16:9', maxSlideCount: 30 },
    });
    const report = runPreflight(setOf([rule]), { kind: 'presentation', aspectRatio: '16:9' });
    expect(report.findings).toHaveLength(2);
    expect(report.passed).toBe(1);
    expect(report.infos).toBe(1);
  });

  it('uses the injected clock for ranAt', () => {
    const rule = makeRule({ id: 'r_font', target: 'font', constraint: { minPt: 12 } });
    const report = runPreflight(setOf([rule]), { kind: 'pdf', baseFontPt: 14 }, () => 'T0');
    expect(report.ranAt).toBe('T0');
    expect(report.passed).toBe(1);
  });
});

describe('preflight — full run over resolved demo fixtures', () => {
  const nonCompliantThesis: DocumentFacts = {
    kind: 'pdf',
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginsMm: { top: 20, right: 20, bottom: 20, left: 25 },
    baseFontPt: 12,
    headings: [
      { level: 1, text: '绪论', numbered: true },
      { level: 3, text: '相关工作细节', numbered: false },
    ],
    coverFields: ['题目', '作者'],
    hasToc: false,
    references: 5,
    elements: [{ nodeId: 'n_small', type: 'paragraph', page: 2, fontPt: 9 }],
  };

  it('produces exact severity counts, override provenance and basis citations', () => {
    const ruleSet = resolveApplicableRules(demoProfiles(), demoRules(), {
      docType: 'thesis',
      institution: '演示大学',
      date: '2026-06-01',
    });
    const report = runPreflight(ruleSet, nonCompliantThesis, () => '2026-07-24T00:00:00.000Z');

    expect(report.profileIds).toEqual(['profile_demo_project_overlay', 'profile_demo_thesis']);
    expect(report.findings).toHaveLength(9);
    expect(report.errors).toBe(4); // margin, heading levels, cover, toc
    expect(report.warnings).toBe(4); // font(14pt override), numbering, references, readability
    expect(report.infos).toBe(0);
    expect(report.passed).toBe(1); // page size passes
    expect(report.ok).toBe(false);
    expect(report.ranAt).toBe('2026-07-24T00:00:00.000Z');

    // The project override (not the school base rule) is what actually ran.
    const fontFinding = report.findings.find((f) => f.ruleId === 'rule_demo_project_font_override');
    expect(fontFinding?.ok).toBe(false);
    expect(fontFinding?.suggestedFix?.patch).toEqual({ set: { baseFontPt: 14 } });
    expect(
      report.findings.find((f) => f.ruleId === 'rule_demo_thesis_font_base'),
    ).toBeUndefined();

    // Every finding can answer: which document, which version, which clause.
    for (const finding of report.findings) {
      expect(finding.basisCitation).toContain('依据');
      expect(finding.basisCitation.length).toBeGreaterThan(10);
    }
    const referenceFinding = report.findings.find(
      (f) => f.ruleId === 'rule_demo_thesis_reference_min',
    );
    expect(referenceFinding?.basisCitation).toContain('【未核实】');
    const marginFinding = report.findings.find((f) => f.ruleId === 'rule_demo_thesis_margin');
    expect(marginFinding?.basisCitation).toContain('AO-DEMO-THESIS');
    expect(marginFinding?.basisCitation).toContain('【演示规则】');
    expect(marginFinding?.suggestedFix?.patch).toEqual({
      set: { marginsMm: { top: 25, right: 20, bottom: 25, left: 30 } },
    });
    const headingFinding = report.findings.find(
      (f) => f.ruleId === 'rule_demo_thesis_heading_levels',
    );
    expect(headingFinding?.suggestedFix).toBeUndefined();
  });

  it('formatBasisCitation renders the verification badge', () => {
    const verified = makeRule({ id: 'r_v', verification: 'verified' });
    const demo = makeRule({ id: 'r_d', verification: 'demo' });
    const unverified = makeRule({ id: 'r_n', verification: 'not_verified' });
    expect(formatBasisCitation(verified)).not.toContain('【');
    expect(formatBasisCitation(demo)).toContain('【演示规则】');
    expect(formatBasisCitation(unverified)).toContain('【未核实】');
  });
});
