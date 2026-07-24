/**
 * Standards Engine — demo fixtures.
 *
 * Honesty discipline (the most important property of this file):
 * - every fixture rule is `verification: 'demo'` with issuer
 *   "AutoOffice Demo Fixture" and a clause that says it is NOT a real
 *   standard clause; explanations may reference common conventions but no
 *   fabricated national standard code is presented as a real citation;
 * - exactly one rule demonstrates the `not_verified` path: it nominally
 *   mentions GB/T 7714 but explicitly marks version/clause as unverified and
 *   keeps its citation empty, so the UI/report renders the 未核实 badge.
 */
import type { StandardProfile, StandardRule } from './types.js';

const DEMO_ISSUER = 'AutoOffice Demo Fixture';
const DEMO_CLAUSE = '演示规则，非真实标准条文';
const DEMO_EFFECTIVE_FROM = '2026-01-01';

interface DemoRuleSeed {
  id: string;
  sourceType: StandardRule['sourceType'];
  standardCode: string;
  level: StandardRule['level'];
  severity: StandardRule['severity'];
  title: string;
  explanation: string;
  target: StandardRule['target'];
  constraint: Record<string, unknown>;
  autoFixable: boolean;
  docTypes: string[];
  overrideOf?: string;
  overrideReason?: string;
}

function demoRule(seed: DemoRuleSeed): StandardRule {
  return {
    id: seed.id,
    sourceType: seed.sourceType,
    standardCode: seed.standardCode,
    issuer: DEMO_ISSUER,
    version: '1.0.0',
    effectiveFrom: DEMO_EFFECTIVE_FROM,
    scope: { docTypes: seed.docTypes },
    level: seed.level,
    severity: seed.severity,
    title: seed.title,
    explanation: seed.explanation,
    target: seed.target,
    constraint: seed.constraint,
    autoFixable: seed.autoFixable,
    citation: { clause: DEMO_CLAUSE },
    verification: 'demo',
    ...(seed.overrideOf !== undefined ? { overrideOf: seed.overrideOf } : {}),
    ...(seed.overrideReason !== undefined ? { overrideReason: seed.overrideReason } : {}),
  };
}

export function demoRules(): StandardRule[] {
  const thesis: StandardRule[] = [
    demoRule({
      id: 'rule_demo_thesis_page',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'mandatory',
      severity: 'error',
      title: '论文页面为 A4',
      explanation: '参考常见高校学位论文格式惯例，正文页面采用 A4（210×297mm）。',
      target: 'page',
      constraint: { widthMm: 210, heightMm: 297, toleranceMm: 1 },
      autoFixable: true,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_margin',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'mandatory',
      severity: 'error',
      title: '页边距下限',
      explanation: '装订侧（左）不小于 30mm，上下不小于 25mm，右侧不小于 20mm，保证装订与批注空间。',
      target: 'margin',
      constraint: { minTopMm: 25, minRightMm: 20, minBottomMm: 25, minLeftMm: 30 },
      autoFixable: true,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_font_base',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'recommended',
      severity: 'warning',
      title: '正文字号不小于 12pt',
      explanation: '参考常见论文排版惯例，正文字号建议不小于小四（约 12pt），保证可读性。',
      target: 'font',
      constraint: { minPt: 12 },
      autoFixable: true,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_heading_levels',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'mandatory',
      severity: 'error',
      title: '标题层级规范',
      explanation: '标题最多使用 3 级，且不得跳级（如一级标题后直接出现三级标题）。',
      target: 'heading',
      constraint: { maxLevels: 3 },
      autoFixable: false,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_heading_numbering',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'recommended',
      severity: 'warning',
      title: '标题需编号',
      explanation: '前 3 级标题应采用连续编号（如 1、1.1、1.1.1），便于目录与交叉引用。',
      target: 'numbering',
      constraint: { required: true, maxLevel: 3 },
      autoFixable: false,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_cover_fields',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'mandatory',
      severity: 'error',
      title: '封面必填字段',
      explanation: '封面必须包含题目、作者、学号、指导教师与日期五项信息。',
      target: 'cover',
      constraint: { requiredFields: ['题目', '作者', '学号', '指导教师', '日期'] },
      autoFixable: false,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_toc_required',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'mandatory',
      severity: 'error',
      title: '必须包含目录',
      explanation: '学位论文正文前必须提供自动生成的目录。',
      target: 'toc',
      constraint: { required: true },
      autoFixable: true,
      docTypes: ['thesis'],
    }),
    demoRule({
      id: 'rule_demo_thesis_readability',
      sourceType: 'school',
      standardCode: 'AO-DEMO-THESIS',
      level: 'recommended',
      severity: 'warning',
      title: '图表文字可读性',
      explanation: '页面内元素文字不宜小于 10.5pt（五号），避免打印后不可读。',
      target: 'readability',
      constraint: { minPt: 10.5 },
      autoFixable: true,
      docTypes: ['thesis'],
    }),
    // The single not_verified demo: nominally references GB/T 7714 but the
    // version/clause was NOT checked against the real text — citation stays
    // empty and the report must show the 未核实 badge.
    {
      id: 'rule_demo_thesis_reference_min',
      sourceType: 'national',
      standardCode: 'GB/T 7714（版本与条文未核实）',
      issuer: '未核实来源（名义上为国家标准，未取得原文）',
      version: 'unknown',
      scope: { docTypes: ['thesis'] },
      level: 'recommended',
      severity: 'warning',
      title: '参考文献数量下限',
      explanation:
        '本条名义上参照 GB/T 7714 的参考文献著录惯例，但具体版本与条文未经核实，仅作演示用途：要求参考文献不少于 10 条。',
      target: 'reference',
      constraint: { min: 10 },
      autoFixable: false,
      citation: {},
      verification: 'not_verified',
    },
  ];

  const deck: StandardRule[] = [
    demoRule({
      id: 'rule_demo_deck_aspect_ratio',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'mandatory',
      severity: 'error',
      title: '画布比例 16:9',
      explanation: '企业模板统一使用 16:9 画布，投屏与录播不裁切。',
      target: 'slide',
      constraint: { aspectRatio: '16:9' },
      autoFixable: true,
      docTypes: ['presentation'],
    }),
    demoRule({
      id: 'rule_demo_deck_max_slides',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'recommended',
      severity: 'info',
      title: '页数上限',
      explanation: '常规汇报建议不超过 30 页，超出时应拆分附录。',
      target: 'slide',
      constraint: { maxSlideCount: 30 },
      autoFixable: false,
      docTypes: ['presentation'],
    }),
    demoRule({
      id: 'rule_demo_deck_min_font',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'recommended',
      severity: 'warning',
      title: '正文最小字号 24pt',
      explanation: '演示文稿元素文字不小于 24pt，保证最后一排观众可读。',
      target: 'readability',
      constraint: { minPt: 24 },
      autoFixable: true,
      docTypes: ['presentation'],
    }),
    demoRule({
      id: 'rule_demo_deck_text_overflow',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'mandatory',
      severity: 'error',
      title: '禁止溢出与超长文本',
      explanation: '元素必须完整落在画布内，单元素文本不超过 400 字，超出应拆页。',
      target: 'text_overflow',
      constraint: { maxChars: 400 },
      autoFixable: false,
      docTypes: ['presentation'],
    }),
    demoRule({
      id: 'rule_demo_deck_cover_title',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'recommended',
      severity: 'warning',
      title: '首页必填字段',
      explanation: '首页应包含标题与汇报人，便于归档检索。',
      target: 'cover',
      constraint: { requiredFields: ['标题', '汇报人'] },
      autoFixable: false,
      docTypes: ['presentation'],
    }),
    demoRule({
      id: 'rule_demo_deck_caption',
      sourceType: 'organization',
      standardCode: 'AO-DEMO-DECK',
      level: 'recommended',
      severity: 'info',
      title: '图表需题注',
      explanation: '图片与表格建议配题注，说明数据来源。',
      target: 'caption',
      constraint: { types: ['image', 'table'] },
      autoFixable: false,
      docTypes: ['presentation'],
    }),
  ];

  const project: StandardRule[] = [
    demoRule({
      id: 'rule_demo_project_font_override',
      sourceType: 'project',
      standardCode: 'AO-DEMO-PROJECT',
      level: 'recommended',
      severity: 'warning',
      title: '项目正文字号不小于 14pt',
      explanation: '本演示项目模板将论文正文基准字号定为 14pt，高于演示校标的 12pt 建议。',
      target: 'font',
      constraint: { minPt: 14 },
      autoFixable: true,
      docTypes: ['thesis'],
      overrideOf: 'rule_demo_thesis_font_base',
      overrideReason:
        '演示项目模板正文基准字号定为 14pt，覆盖演示校标 12pt 的同级建议（project priority 100 > school priority 40）',
    }),
  ];

  return [...thesis, ...deck, ...project];
}

export function demoProfiles(): StandardProfile[] {
  return [
    {
      id: 'profile_demo_thesis',
      name: '演示·高校学位论文（A4）',
      kind: 'school',
      docTypes: ['thesis'],
      institution: '演示大学',
      version: '1.0.0',
      description: '演示用高校学位论文格式包：页面、边距、字号、标题、封面、目录、参考文献。',
      ruleIds: [
        'rule_demo_thesis_page',
        'rule_demo_thesis_margin',
        'rule_demo_thesis_font_base',
        'rule_demo_thesis_heading_levels',
        'rule_demo_thesis_heading_numbering',
        'rule_demo_thesis_cover_fields',
        'rule_demo_thesis_toc_required',
        'rule_demo_thesis_readability',
        'rule_demo_thesis_reference_min',
      ],
      priority: 40,
    },
    {
      id: 'profile_demo_deck',
      name: '演示·企业演示文稿（16:9）',
      kind: 'organization',
      docTypes: ['presentation'],
      version: '1.0.0',
      description: '演示用企业 PPT 规范包：比例、页数、最小字号、溢出、首页字段、题注。',
      ruleIds: [
        'rule_demo_deck_aspect_ratio',
        'rule_demo_deck_max_slides',
        'rule_demo_deck_min_font',
        'rule_demo_deck_text_overflow',
        'rule_demo_deck_cover_title',
        'rule_demo_deck_caption',
      ],
      priority: 30,
    },
    {
      id: 'profile_demo_project_overlay',
      name: '演示·项目级覆盖',
      kind: 'project',
      docTypes: ['thesis'],
      version: '1.0.0',
      description: '演示项目级规则如何以可解释的方式覆盖校标同级规则。',
      ruleIds: ['rule_demo_project_font_override'],
      priority: 100,
    },
  ];
}
