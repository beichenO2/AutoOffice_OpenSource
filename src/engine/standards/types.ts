/**
 * Standards Engine — data model.
 *
 * Upgrades "the document should follow national / industry / school /
 * organization standards" from model memory into rule DATA that has a source,
 * a version, an applicability scope, a machine-checkable constraint and a
 * verification state. Every rule can answer: which document, which version,
 * which clause — and whether that citation was actually verified.
 *
 * Honesty discipline: rules that were not checked against a real source MUST
 * carry `verification: 'demo'` (shipped fixtures) or `'not_verified'`; the
 * engine never fabricates national standard codes as if they were real.
 */

/** Where a standard comes from; also used as a profile kind. */
export type StandardSourceType = 'national' | 'industry' | 'school' | 'organization' | 'project';

/**
 * mandatory = normative requirement ("必须"); recommended = advice ("宜/建议").
 * Aesthetic preferences can never override an applicable mandatory rule.
 */
export type RuleLevel = 'mandatory' | 'recommended';

/** Severity a failed check reports with. */
export type RuleSeverity = 'error' | 'warning' | 'info';

/**
 * verified     — citation checked against the real source document;
 * demo         — shipped demonstration fixture, NOT a real standard clause;
 * not_verified — nominally references a real standard whose version/clause
 *                could not be checked; must be displayed as such.
 */
export type RuleVerification = 'verified' | 'demo' | 'not_verified';

/** Machine-checkable aspects of a document a rule can constrain. */
export type RuleTarget =
  | 'page'
  | 'margin'
  | 'font'
  | 'heading'
  | 'numbering'
  | 'header_footer'
  | 'cover'
  | 'caption'
  | 'reference'
  | 'slide'
  | 'text_overflow'
  | 'readability'
  | 'spacing'
  | 'toc';

/** Provenance of a rule: which file/URL, which clause, when retrieved. */
export interface RuleCitation {
  sourceUrl?: string;
  fileHash?: string;
  retrievedAt?: string;
  clause?: string;
}

/** Applicability scope of a single rule. Empty docTypes = applies to all. */
export interface RuleScope {
  docTypes: string[];
  institutions?: string[];
}

/** A single sourced, versioned, machine-checkable formatting rule. */
export interface StandardRule {
  id: string;
  sourceType: StandardSourceType;
  /** Standard code or document name (e.g. "AO-DEMO-THESIS"). */
  standardCode: string;
  /** Publishing body. */
  issuer: string;
  version: string;
  publishedAt?: string;
  /** ISO date; missing = effective since forever. */
  effectiveFrom?: string;
  /** ISO date; missing = never expires. */
  effectiveTo?: string;
  scope: RuleScope;
  level: RuleLevel;
  severity: RuleSeverity;
  title: string;
  /** Structured human explanation of the clause (plain language). */
  explanation: string;
  target: RuleTarget;
  /** Machine-checkable constraint parameters, e.g. {widthMm:210,heightMm:297}. */
  constraint: Record<string, unknown>;
  autoFixable: boolean;
  citation: RuleCitation;
  verification: RuleVerification;
  /** Id of the rule this rule explicitly overrides. */
  overrideOf?: string;
  /** Human reason for the explicit override (kept in the resolve report). */
  overrideReason?: string;
}

/** A named, versioned selection of rules for a doc type / institution. */
export interface StandardProfile {
  id: string;
  name: string;
  kind: StandardSourceType;
  docTypes: string[];
  institution?: string;
  version: string;
  description: string;
  ruleIds: string[];
  /**
   * Higher priority applies first: lets a school/project profile override a
   * national one with an explainable, recorded reason.
   */
  priority: number;
}

/** Record of one rule being overridden by another during resolution. */
export interface RuleOverride {
  ruleId: string;
  overriddenBy: string;
  reason: string;
}

/** An unresolved mandatory-vs-mandatory clash kept for upstream decision. */
export interface RuleConflict {
  ruleIds: string[];
  field: string;
  resolution: string;
}

/** Output of applicability resolution + conflict arbitration. */
export interface ResolvedRuleSet {
  rules: StandardRule[];
  overrides: RuleOverride[];
  conflicts: RuleConflict[];
  /** Profiles that actually applied (provenance for the preflight report). */
  profileIds: string[];
}

export interface DocumentMarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface DocumentHeadingFact {
  level: number;
  text: string;
  numbered?: boolean;
}

/** Normalized [0,1] box of one element on its page/slide. */
export interface DocumentElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DocumentElementFact {
  nodeId: string;
  type: string;
  page: number;
  /** Nearest ancestor `[data-ao-id]` (ul→slide, li→ul). Used to skip nested overlap. */
  parentId?: string;
  textLength?: number;
  fontPt?: number;
  boxNorm?: DocumentElementBox;
  /** Measured rendered-text bbox in the same normalized space as `boxNorm`. */
  contentBoxNorm?: DocumentElementBox;
  /** Playwright: element scrollWidth/Height exceeds its client box. */
  scrollOverflow?: boolean;
  hasCaption?: boolean;
}

/**
 * Facts extracted from a rendered document, the INPUT of preflight checks.
 * The extractor lives outside this module; missing fields simply mean the
 * corresponding checks are reported as "cannot check (missing facts)".
 */
export interface DocumentFacts {
  kind: 'pdf' | 'presentation';
  pageWidthMm?: number;
  pageHeightMm?: number;
  marginsMm?: DocumentMarginsMm;
  baseFontPt?: number;
  fonts?: string[];
  headings?: DocumentHeadingFact[];
  slideCount?: number;
  aspectRatio?: string;
  elements?: DocumentElementFact[];
  coverFields?: string[];
  hasToc?: boolean;
  references?: number;
}

/** Structured auto-fix suggestion attached to a fixable failed finding. */
export interface SuggestedFix {
  description: string;
  patch?: Record<string, unknown>;
}

/** One check result: which rule, pass/fail, on what basis, how to fix. */
export interface PreflightFinding {
  ruleId: string;
  ok: boolean;
  severity: RuleSeverity;
  /** Plain-language message including actual vs expected values. */
  message: string;
  /** Which document/version/clause this verdict is based on. */
  basisCitation: string;
  nodeId?: string;
  autoFixable: boolean;
  suggestedFix?: SuggestedFix;
  /**
   * true = the rule could not be checked because facts were missing; the
   * finding is informational (ok stays true) but visibly counted in `infos`.
   */
  skipped?: boolean;
}

/**
 * Aggregated preflight result.
 * Counting semantics: errors/warnings = failed findings of that severity;
 * infos = failed info-level findings + skipped ("cannot check") findings;
 * passed = actually-checked findings that passed; ok = no error-level failure.
 */
export interface PreflightReport {
  profileIds: string[];
  findings: PreflightFinding[];
  errors: number;
  warnings: number;
  infos: number;
  passed: number;
  ok: boolean;
  ranAt: string;
}
