/**
 * Standards Engine — preflight executor.
 *
 * Runs a resolved rule set against extracted DocumentFacts and produces a
 * report whose findings carry severity, a basis citation (which document,
 * which version, which clause) and structured auto-fix suggestions.
 *
 * Extensibility: checks live in a checker REGISTRY keyed by RuleTarget — a
 * new target means adding one checker entry, not growing a monolithic
 * switch. Element-scoped checkers emit one finding per offending element so
 * the UI can jump to the node. Missing facts never fail silently: they show
 * up as visible "cannot check" info findings counted in `infos`.
 */
import { measureDeckBoxes } from '../render/deck.js';
import { auditTextLayout, type TextLayoutAuditResult } from './text-layout-audit.js';
import type {
  DocumentElementFact,
  DocumentFacts,
  PreflightFinding,
  PreflightReport,
  ResolvedRuleSet,
  RuleTarget,
  StandardRule,
} from './types.js';

/** Which document / version / clause a verdict is based on. */
export function formatBasisCitation(rule: StandardRule): string {
  const clause = rule.citation.clause !== undefined ? `，${rule.citation.clause}` : '';
  const badge =
    rule.verification === 'verified'
      ? ''
      : rule.verification === 'demo'
        ? '【演示规则】'
        : '【未核实】';
  return `依据 ${rule.standardCode}（${rule.issuer} · v${rule.version}${clause}）${badge}`;
}

type CheckOutcome =
  | { status: 'pass'; detail?: string }
  | {
      status: 'fail';
      message: string;
      nodeId?: string;
      fixDescription?: string;
      fixPatch?: Record<string, unknown>;
    }
  | { status: 'skip'; missing: string };

type RuleChecker = (rule: StandardRule, facts: DocumentFacts) => CheckOutcome[];

// ---- Constraint parameter accessors (rule-authoring errors surface as skips,
// never as invented defaults) --------------------------------------------------

function num(constraint: Record<string, unknown>, key: string): number | undefined {
  const value = constraint[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function bool(constraint: Record<string, unknown>, key: string): boolean | undefined {
  const value = constraint[key];
  return typeof value === 'boolean' ? value : undefined;
}

function str(constraint: Record<string, unknown>, key: string): string | undefined {
  const value = constraint[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function strArr(constraint: Record<string, unknown>, key: string): string[] | undefined {
  const value = constraint[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;
}

const pass = (detail?: string): CheckOutcome[] => [{ status: 'pass', ...(detail !== undefined ? { detail } : {}) }];
const skip = (missing: string): CheckOutcome[] => [{ status: 'skip', missing }];

// ---- Checkers ----------------------------------------------------------------

const checkPage: RuleChecker = (rule, facts) => {
  const widthMm = num(rule.constraint, 'widthMm');
  const heightMm = num(rule.constraint, 'heightMm');
  const toleranceMm = num(rule.constraint, 'toleranceMm') ?? 1;
  if (widthMm === undefined && heightMm === undefined) return skip('约束缺少 widthMm/heightMm 参数');
  if (facts.pageWidthMm === undefined || facts.pageHeightMm === undefined) {
    return skip('缺少 pageWidthMm/pageHeightMm 事实');
  }
  const widthOk = widthMm === undefined || Math.abs(facts.pageWidthMm - widthMm) <= toleranceMm;
  const heightOk = heightMm === undefined || Math.abs(facts.pageHeightMm - heightMm) <= toleranceMm;
  if (widthOk && heightOk) return pass();
  return [
    {
      status: 'fail',
      message: `页面尺寸为 ${facts.pageWidthMm}×${facts.pageHeightMm}mm，期望 ${widthMm ?? '不限'}×${heightMm ?? '不限'}mm（容差 ±${toleranceMm}mm）`,
      fixDescription: '将页面尺寸调整为标准尺寸',
      fixPatch: { set: { pageWidthMm: widthMm, pageHeightMm: heightMm } },
    },
  ];
};

const checkMargin: RuleChecker = (rule, facts) => {
  const uniform = num(rule.constraint, 'minMm');
  const mins = {
    top: num(rule.constraint, 'minTopMm') ?? uniform,
    right: num(rule.constraint, 'minRightMm') ?? uniform,
    bottom: num(rule.constraint, 'minBottomMm') ?? uniform,
    left: num(rule.constraint, 'minLeftMm') ?? uniform,
  };
  if (Object.values(mins).every((min) => min === undefined)) return skip('约束缺少页边距下限参数');
  const margins = facts.marginsMm;
  if (margins === undefined) return skip('缺少 marginsMm 事实');
  const violations: string[] = [];
  const fixed = { ...margins };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const min = mins[side];
    if (min === undefined) continue;
    if (margins[side] < min) {
      violations.push(`${side} ${margins[side]}mm < 下限 ${min}mm`);
      fixed[side] = min;
    }
  }
  if (violations.length === 0) return pass();
  return [
    {
      status: 'fail',
      message: `页边距不达标：${violations.join('；')}`,
      fixDescription: '将不达标的页边距提升到下限值',
      fixPatch: { set: { marginsMm: fixed } },
    },
  ];
};

const checkFont: RuleChecker = (rule, facts) => {
  const minPt = num(rule.constraint, 'minPt');
  const allowedFonts = strArr(rule.constraint, 'allowedFonts');
  if (minPt === undefined && allowedFonts === undefined) {
    return skip('约束缺少 minPt/allowedFonts 参数');
  }
  const outcomes: CheckOutcome[] = [];
  if (minPt !== undefined) {
    if (facts.baseFontPt === undefined) {
      outcomes.push({ status: 'skip', missing: '缺少 baseFontPt 事实' });
    } else if (facts.baseFontPt < minPt) {
      outcomes.push({
        status: 'fail',
        message: `正文字号为 ${facts.baseFontPt}pt，低于下限 ${minPt}pt`,
        fixDescription: `将正文字号提升至 ${minPt}pt`,
        fixPatch: { set: { baseFontPt: minPt } },
      });
    } else {
      outcomes.push({ status: 'pass' });
    }
  }
  if (allowedFonts !== undefined) {
    if (facts.fonts === undefined) {
      outcomes.push({ status: 'skip', missing: '缺少 fonts 事实' });
    } else {
      const offending = facts.fonts.filter((font) => !allowedFonts.includes(font));
      if (offending.length > 0) {
        outcomes.push({
          status: 'fail',
          message: `使用了白名单之外的字体：${offending.join('、')}（允许：${allowedFonts.join('、')}）`,
          fixDescription: '将非白名单字体替换为允许的字体',
          fixPatch: { replace: { fonts: offending, allowed: allowedFonts } },
        });
      } else {
        outcomes.push({ status: 'pass' });
      }
    }
  }
  return outcomes;
};

const checkHeading: RuleChecker = (rule, facts) => {
  const headings = facts.headings;
  if (headings === undefined) return skip('缺少 headings 事实');
  const maxLevels = num(rule.constraint, 'maxLevels');
  const violations: string[] = [];
  let previousLevel = 0;
  for (const heading of headings) {
    if (heading.level > previousLevel + 1) {
      violations.push(
        `「${heading.text}」从 ${previousLevel === 0 ? '文首' : `${previousLevel} 级`}跳到 ${heading.level} 级（跳级）`,
      );
    }
    previousLevel = heading.level;
    if (maxLevels !== undefined && heading.level > maxLevels) {
      violations.push(`「${heading.text}」为 ${heading.level} 级，超出最大层级 ${maxLevels}`);
    }
  }
  if (violations.length === 0) return pass();
  return [
    {
      status: 'fail',
      message: `标题层级不合规：${violations.join('；')}`,
    },
  ];
};

const checkNumbering: RuleChecker = (rule, facts) => {
  if (bool(rule.constraint, 'required') !== true) return skip('约束缺少 required:true 参数');
  const headings = facts.headings;
  if (headings === undefined) return skip('缺少 headings 事实');
  const maxLevel = num(rule.constraint, 'maxLevel') ?? Number.POSITIVE_INFINITY;
  const offending = headings.filter(
    (heading) => heading.level <= maxLevel && heading.numbered !== true,
  );
  if (offending.length === 0) return pass();
  return [
    {
      status: 'fail',
      message: `以下标题缺少编号：${offending.map((heading) => `「${heading.text}」(${heading.level} 级)`).join('、')}`,
    },
  ];
};

const checkCover: RuleChecker = (rule, facts) => {
  const requiredFields = strArr(rule.constraint, 'requiredFields');
  if (requiredFields === undefined) return skip('约束缺少 requiredFields 参数');
  const coverFields = facts.coverFields;
  if (coverFields === undefined) return skip('缺少 coverFields 事实');
  const missing = requiredFields.filter((field) => !coverFields.includes(field));
  if (missing.length === 0) return pass();
  return [
    {
      status: 'fail',
      message: `封面缺少必填字段：${missing.join('、')}（已有：${coverFields.length > 0 ? coverFields.join('、') : '无'}）`,
    },
  ];
};

const checkCaption: RuleChecker = (rule, facts) => {
  const types = strArr(rule.constraint, 'types') ?? ['table', 'image'];
  const elements = facts.elements;
  if (elements === undefined) return skip('缺少 elements 事实');
  const offending = elements.filter(
    (element) => types.includes(element.type) && element.hasCaption !== true,
  );
  if (offending.length === 0) return pass();
  return offending.map((element) => ({
    status: 'fail' as const,
    nodeId: element.nodeId,
    message: `第 ${element.page} 页的 ${element.type} 元素（${element.nodeId}）缺少题注，要求 ${types.join('/')} 元素必须带题注`,
  }));
};

const checkReference: RuleChecker = (rule, facts) => {
  const min = num(rule.constraint, 'min');
  if (min === undefined) return skip('约束缺少 min 参数');
  if (facts.references === undefined) return skip('缺少 references 事实');
  if (facts.references >= min) return pass();
  return [
    {
      status: 'fail',
      message: `参考文献仅 ${facts.references} 条，低于下限 ${min} 条`,
    },
  ];
};

const checkSlide: RuleChecker = (rule, facts) => {
  const aspectRatio = str(rule.constraint, 'aspectRatio');
  const maxSlideCount = num(rule.constraint, 'maxSlideCount');
  if (aspectRatio === undefined && maxSlideCount === undefined) {
    return skip('约束缺少 aspectRatio/maxSlideCount 参数');
  }
  const outcomes: CheckOutcome[] = [];
  if (aspectRatio !== undefined) {
    if (facts.aspectRatio === undefined) {
      outcomes.push({ status: 'skip', missing: '缺少 aspectRatio 事实' });
    } else if (facts.aspectRatio !== aspectRatio) {
      outcomes.push({
        status: 'fail',
        message: `画布比例为 ${facts.aspectRatio}，期望 ${aspectRatio}`,
        fixDescription: `将画布比例调整为 ${aspectRatio}`,
        fixPatch: { set: { aspectRatio } },
      });
    } else {
      outcomes.push({ status: 'pass' });
    }
  }
  if (maxSlideCount !== undefined) {
    if (facts.slideCount === undefined) {
      outcomes.push({ status: 'skip', missing: '缺少 slideCount 事实' });
    } else if (facts.slideCount > maxSlideCount) {
      outcomes.push({
        status: 'fail',
        message: `共 ${facts.slideCount} 页，超出上限 ${maxSlideCount} 页`,
      });
    } else {
      outcomes.push({ status: 'pass' });
    }
  }
  return outcomes;
};

const BOX_EPSILON = 0.001;

function contentExceedsCell(
  content: { x: number; y: number; w: number; h: number },
  cell: { x: number; y: number; w: number; h: number },
  tol: number,
): boolean {
  return (
    content.x < cell.x - tol ||
    content.y < cell.y - tol ||
    content.x + content.w > cell.x + cell.w + tol ||
    content.y + content.h > cell.y + cell.h + tol
  );
}

const checkTextOverflow: RuleChecker = (rule, facts) => {
  const elements = facts.elements;
  if (elements === undefined) return skip('缺少 elements 事实');
  const maxChars = num(rule.constraint, 'maxChars');
  const outcomes: CheckOutcome[] = [];
  for (const element of elements) {
    const box = element.boxNorm;
    if (box !== undefined) {
      const outOfBounds =
        box.x < -BOX_EPSILON ||
        box.y < -BOX_EPSILON ||
        box.x + box.w > 1 + BOX_EPSILON ||
        box.y + box.h > 1 + BOX_EPSILON;
      if (outOfBounds) {
        outcomes.push({
          status: 'fail',
          nodeId: element.nodeId,
          message: `第 ${element.page} 页元素（${element.nodeId}）越出画布：box=(${box.x}, ${box.y}, ${box.w}, ${box.h})，要求完整落在 [0,1] 范围内`,
        });
        continue;
      }
    }
    if (element.scrollOverflow === true) {
      outcomes.push({
        status: 'fail',
        nodeId: element.nodeId,
        message: `第 ${element.page} 页元素（${element.nodeId}）实测滚动溢出单元格`,
      });
      continue;
    }
    if (box !== undefined && element.contentBoxNorm !== undefined) {
      if (contentExceedsCell(element.contentBoxNorm, box, BOX_EPSILON)) {
        outcomes.push({
          status: 'fail',
          nodeId: element.nodeId,
          message: `第 ${element.page} 页元素（${element.nodeId}）实测文本越出单元格`,
        });
        continue;
      }
    }
    if (
      maxChars !== undefined &&
      element.textLength !== undefined &&
      element.textLength > maxChars
    ) {
      outcomes.push({
        status: 'fail',
        nodeId: element.nodeId,
        message: `第 ${element.page} 页元素（${element.nodeId}）文本 ${element.textLength} 字，超出单元素上限 ${maxChars} 字`,
      });
    }
  }
  if (outcomes.length === 0) return pass();
  return outcomes;
};

const checkReadability: RuleChecker = (rule, facts) => {
  const minPt = num(rule.constraint, 'minPt');
  if (minPt === undefined) return skip('约束缺少 minPt 参数');
  const elements = facts.elements;
  if (elements === undefined) return skip('缺少 elements 事实');
  const offending = elements.filter(
    (element) => element.fontPt !== undefined && element.fontPt < minPt,
  );
  if (offending.length === 0) return pass();
  return offending.map((element) => ({
    status: 'fail' as const,
    nodeId: element.nodeId,
    message: `第 ${element.page} 页元素（${element.nodeId}）字号 ${element.fontPt}pt，低于可读性下限 ${minPt}pt`,
    fixDescription: `将该元素字号提升至 ${minPt}pt`,
    fixPatch: { set: { fontPt: minPt }, nodeId: element.nodeId },
  }));
};

const checkToc: RuleChecker = (rule, facts) => {
  if (bool(rule.constraint, 'required') !== true) return skip('约束缺少 required:true 参数');
  if (facts.hasToc === undefined) return skip('缺少 hasToc 事实');
  if (facts.hasToc) return pass();
  return [
    {
      status: 'fail',
      message: '文档缺少目录，规则要求必须包含目录',
      fixDescription: '在正文前插入自动目录',
      fixPatch: { set: { hasToc: true } },
    },
  ];
};

// DocumentFacts does not yet carry header/footer or line-spacing facts, so
// these targets honestly report "cannot check" instead of pretending to pass.
const checkHeaderFooter: RuleChecker = () => skip('当前 DocumentFacts 未提供页眉/页脚事实，无法检查');
const checkSpacing: RuleChecker = () => skip('当前 DocumentFacts 未提供行距/段距事实，无法检查');

/** Checker registry: add a new RuleTarget = add one entry here. */
const CHECKERS: Record<RuleTarget, RuleChecker> = {
  page: checkPage,
  margin: checkMargin,
  font: checkFont,
  heading: checkHeading,
  numbering: checkNumbering,
  header_footer: checkHeaderFooter,
  cover: checkCover,
  caption: checkCaption,
  reference: checkReference,
  slide: checkSlide,
  text_overflow: checkTextOverflow,
  readability: checkReadability,
  spacing: checkSpacing,
  toc: checkToc,
};

function toFinding(rule: StandardRule, outcome: CheckOutcome): PreflightFinding {
  const basisCitation = formatBasisCitation(rule);
  if (outcome.status === 'pass') {
    return {
      ruleId: rule.id,
      ok: true,
      severity: rule.severity,
      message: `符合：${rule.title}${outcome.detail !== undefined ? `（${outcome.detail}）` : ''}`,
      basisCitation,
      autoFixable: rule.autoFixable,
    };
  }
  if (outcome.status === 'skip') {
    return {
      ruleId: rule.id,
      ok: true,
      severity: 'info',
      message: `无法检查（${outcome.missing}）：${rule.title}`,
      basisCitation,
      autoFixable: rule.autoFixable,
      skipped: true,
    };
  }
  return {
    ruleId: rule.id,
    ok: false,
    severity: rule.severity,
    message: `${outcome.message}。${rule.explanation}`,
    basisCitation,
    ...(outcome.nodeId !== undefined ? { nodeId: outcome.nodeId } : {}),
    autoFixable: rule.autoFixable,
    ...(rule.autoFixable
      ? {
          suggestedFix: {
            description: outcome.fixDescription ?? `按「${rule.title}」的期望值自动修复`,
            ...(outcome.fixPatch !== undefined ? { patch: outcome.fixPatch } : {}),
          },
        }
      : {}),
  };
}

export function runPreflight(
  ruleSet: ResolvedRuleSet,
  facts: DocumentFacts,
  clock?: () => string,
): PreflightReport {
  const findings: PreflightFinding[] = [];
  for (const rule of ruleSet.rules) {
    for (const outcome of CHECKERS[rule.target](rule, facts)) {
      findings.push(toFinding(rule, outcome));
    }
  }
  const errors = findings.filter((f) => !f.ok && f.severity === 'error').length;
  const warnings = findings.filter((f) => !f.ok && f.severity === 'warning').length;
  const infos = findings.filter((f) => (!f.ok && f.severity === 'info') || f.skipped === true).length;
  const passed = findings.filter((f) => f.ok && f.skipped !== true).length;
  return {
    profileIds: ruleSet.profileIds,
    findings,
    errors,
    warnings,
    infos,
    passed,
    ok: errors === 0,
    ranAt: clock !== undefined ? clock() : new Date().toISOString(),
  };
}

/** Thin re-export: Reviewer text-layout audit (measured boxes). */
export { auditTextLayout } from './text-layout-audit.js';

/** Measure box → DocumentElementFact, including overflow signals from Playwright. */
export type MeasuredOverflowBox = {
  nodeId: string;
  page: number;
  parentId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  contentBoxNorm?: { x: number; y: number; w: number; h: number };
  scrollOverflow?: boolean;
};

export function elementFactFromMeasuredBox(box: MeasuredOverflowBox): DocumentElementFact {
  return {
    nodeId: box.nodeId,
    type: 'element',
    page: box.page,
    ...(box.parentId !== undefined ? { parentId: box.parentId } : {}),
    boxNorm: { x: box.x, y: box.y, w: box.w, h: box.h },
    ...(box.contentBoxNorm !== undefined ? { contentBoxNorm: { ...box.contentBoxNorm } } : {}),
    ...(box.scrollOverflow !== undefined ? { scrollOverflow: box.scrollOverflow } : {}),
  };
}

export interface TextLayoutPreflightResult {
  ok: boolean;
  facts: DocumentFacts;
  audit: TextLayoutAuditResult;
}

function finalizeTextLayoutPreflight(facts: DocumentFacts): TextLayoutPreflightResult {
  const audit = auditTextLayout(facts);
  return { ok: audit.ok, facts, audit };
}

async function runTextLayoutPreflightFromHtml(html: string): Promise<TextLayoutPreflightResult> {
  const boxes = await measureDeckBoxes(html);
  const facts: DocumentFacts = {
    kind: 'presentation',
    slideCount: html.match(/class="ao-slide"/g)?.length ?? 0,
    aspectRatio: '16:9',
    elements: boxes.map(elementFactFromMeasuredBox),
  };
  return finalizeTextLayoutPreflight(facts);
}

/**
 * Deck text-layout preflight. Facts path is sync; HTML path measures then audits.
 * `ok` is false iff auditTextLayout reports any hard finding (fail-closed).
 */
export function runTextLayoutPreflight(input: DocumentFacts): TextLayoutPreflightResult;
export function runTextLayoutPreflight(input: string): Promise<TextLayoutPreflightResult>;
export function runTextLayoutPreflight(
  input: DocumentFacts | string,
): TextLayoutPreflightResult | Promise<TextLayoutPreflightResult> {
  if (typeof input === 'string') return runTextLayoutPreflightFromHtml(input);
  return finalizeTextLayoutPreflight(input);
}
