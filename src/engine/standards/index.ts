/**
 * Standards Engine — public API barrel.
 *
 * Data model (types), runtime schemas (import-boundary defense), applicability
 * resolution + conflict arbitration, preflight execution, and demo fixtures.
 */
export type {
  StandardSourceType,
  RuleLevel,
  RuleSeverity,
  RuleVerification,
  RuleTarget,
  RuleCitation,
  RuleScope,
  StandardRule,
  StandardProfile,
  RuleOverride,
  RuleConflict,
  ResolvedRuleSet,
  DocumentMarginsMm,
  DocumentHeadingFact,
  DocumentElementBox,
  DocumentElementFact,
  DocumentFacts,
  SuggestedFix,
  PreflightFinding,
  PreflightReport,
} from './types.js';

export {
  STANDARD_SOURCE_TYPES,
  RULE_LEVELS,
  RULE_SEVERITIES,
  RULE_VERIFICATIONS,
  RULE_TARGETS,
  standardRuleSchema,
  standardProfileSchema,
  validateRule,
  validateProfile,
  assertRule,
  assertProfile,
} from './schemas.js';

export { resolveApplicableRules } from './resolve.js';
export type { ResolveContext } from './resolve.js';

export { runPreflight, formatBasisCitation } from './preflight.js';

export {
  auditTextLayout,
  DEFAULT_MIN_EDGE_MARGIN_NORM,
  DEFAULT_ALIGNMENT_TOLERANCE_NORM,
} from './text-layout-audit.js';
export type {
  TextLayoutFinding,
  TextLayoutFindingCategory,
  TextLayoutSeverity,
  TextLayoutAuditResult,
  TextLayoutAuditOptions,
} from './text-layout-audit.js';

export { demoRules, demoProfiles } from './fixtures.js';
