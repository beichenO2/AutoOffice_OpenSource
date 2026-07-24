/**
 * Standards Engine — applicability resolution + conflict arbitration.
 *
 * Pipeline: filter profiles by docType/institution → collect their rules →
 * filter rules by scope + effective dates → arbitrate conflicts. Every
 * override is RECORDED with a human-readable reason; unresolvable
 * mandatory-vs-mandatory clashes are kept in `conflicts` for an upstream
 * decision — never silently dropped.
 *
 * Design constraint: aesthetics can never beat standards. This resolver
 * deliberately accepts NO preference/aesthetic input, so an applicable
 * mandatory rule can only lose to another standards rule under the recorded
 * arbitration order below (never to taste).
 */
import type {
  ResolvedRuleSet,
  RuleConflict,
  RuleOverride,
  StandardProfile,
  StandardRule,
} from './types.js';

export interface ResolveContext {
  docType: string;
  institution?: string;
  /** ISO date used against effectiveFrom/effectiveTo; missing = no date filter. */
  date?: string;
}

interface Candidate {
  rule: StandardRule;
  profileId: string;
  priority: number;
}

function profileApplies(profile: StandardProfile, ctx: ResolveContext): boolean {
  if (!profile.docTypes.includes(ctx.docType)) return false;
  // An institution-bound profile only applies when the context declares the
  // same institution; without a context institution it stays inapplicable.
  if (profile.institution !== undefined && profile.institution !== ctx.institution) return false;
  return true;
}

function ruleApplies(rule: StandardRule, ctx: ResolveContext): boolean {
  if (rule.scope.docTypes.length > 0 && !rule.scope.docTypes.includes(ctx.docType)) return false;
  const institutions = rule.scope.institutions;
  if (institutions && institutions.length > 0) {
    if (ctx.institution === undefined || !institutions.includes(ctx.institution)) return false;
  }
  if (ctx.date !== undefined) {
    // ISO dates compare correctly as strings; missing bounds = valid forever.
    if (rule.effectiveFrom !== undefined && ctx.date < rule.effectiveFrom) return false;
    if (rule.effectiveTo !== undefined && ctx.date > rule.effectiveTo) return false;
  }
  return true;
}

/** Constraint fields both rules set but with different values. */
function conflictingFields(a: StandardRule, b: StandardRule): string[] {
  const fields: string[] = [];
  for (const key of Object.keys(a.constraint)) {
    if (!(key in b.constraint)) continue;
    if (JSON.stringify(a.constraint[key]) !== JSON.stringify(b.constraint[key])) fields.push(key);
  }
  return fields;
}

export function resolveApplicableRules(
  profiles: StandardProfile[],
  rules: StandardRule[],
  ctx: ResolveContext,
): ResolvedRuleSet {
  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));
  const applicableProfiles = [...profiles]
    .filter((profile) => profileApplies(profile, ctx))
    .sort((a, b) => b.priority - a.priority);

  // Dedupe by rule id; when several profiles reference the same rule the
  // highest-priority profile owns it (matters for same-level arbitration).
  const active = new Map<string, Candidate>();
  for (const profile of applicableProfiles) {
    for (const ruleId of profile.ruleIds) {
      const rule = ruleById.get(ruleId);
      if (!rule || !ruleApplies(rule, ctx)) continue;
      const prev = active.get(ruleId);
      if (!prev || profile.priority > prev.priority) {
        active.set(ruleId, { rule, profileId: profile.id, priority: profile.priority });
      }
    }
  }

  const overrides: RuleOverride[] = [];
  const conflicts: RuleConflict[] = [];

  // Pass 1 — explicit overrideOf declarations (e.g. a project rule replacing
  // a school rule). A recommended rule may never displace a mandatory one.
  const declared = [...active.values()].sort((a, b) => a.rule.id.localeCompare(b.rule.id));
  for (const candidate of declared) {
    if (!active.has(candidate.rule.id)) continue;
    const victimId = candidate.rule.overrideOf;
    if (victimId === undefined) continue;
    const victim = active.get(victimId);
    if (!victim) continue;
    if (candidate.rule.level === 'recommended' && victim.rule.level === 'mandatory') {
      conflicts.push({
        ruleIds: [candidate.rule.id, victimId],
        field: '(explicit overrideOf)',
        resolution: 'recommended 规则不得覆盖 mandatory 规则；双方保留，交上层决策',
      });
      continue;
    }
    active.delete(victimId);
    overrides.push({
      ruleId: victimId,
      overriddenBy: candidate.rule.id,
      reason:
        candidate.rule.overrideReason ??
        `规则 ${candidate.rule.id} 显式声明覆盖 ${victimId}（overrideOf）`,
    });
  }

  // Pass 2 — implicit conflicts: same target + same constraint field with
  // different values. Whole-rule arbitration on the first conflicting field:
  // mandatory beats recommended; same level → higher profile priority wins;
  // mandatory vs mandatory without a priority gap is KEPT as a conflict.
  const ordered = () =>
    [...active.values()].sort((a, b) => a.rule.id.localeCompare(b.rule.id));
  for (const a of ordered()) {
    if (!active.has(a.rule.id)) continue;
    for (const b of ordered()) {
      if (a.rule.id >= b.rule.id) continue;
      if (!active.has(a.rule.id) || !active.has(b.rule.id)) continue;
      if (a.rule.target !== b.rule.target) continue;
      const fields = conflictingFields(a.rule, b.rule);
      const field = fields[0];
      if (field === undefined) continue;

      if (a.rule.level !== b.rule.level) {
        const winner = a.rule.level === 'mandatory' ? a : b;
        const loser = winner === a ? b : a;
        active.delete(loser.rule.id);
        overrides.push({
          ruleId: loser.rule.id,
          overriddenBy: winner.rule.id,
          reason: `mandatory 优先于 recommended：${winner.rule.id}（${winner.rule.title}）在 ${a.rule.target}.${field} 上覆盖 ${loser.rule.id}`,
        });
        continue;
      }
      if (a.priority !== b.priority) {
        const winner = a.priority > b.priority ? a : b;
        const loser = winner === a ? b : a;
        active.delete(loser.rule.id);
        overrides.push({
          ruleId: loser.rule.id,
          overriddenBy: winner.rule.id,
          reason: `同级规则按 profile 优先级仲裁：「${winner.profileId}」(priority ${winner.priority}) 覆盖「${loser.profileId}」(priority ${loser.priority}) 的 ${a.rule.target}.${field} 约束`,
        });
        continue;
      }
      conflicts.push({
        ruleIds: [a.rule.id, b.rule.id],
        field,
        resolution:
          a.rule.level === 'mandatory'
            ? 'mandatory 直接冲突且无优先级差：双方保留，交上层 UI 决策'
            : 'recommended 同级同优先级冲突：双方保留，交上层 UI 决策',
      });
    }
  }

  return {
    rules: ordered().map((candidate) => candidate.rule),
    overrides,
    conflicts,
    profileIds: applicableProfiles.map((profile) => profile.id),
  };
}
