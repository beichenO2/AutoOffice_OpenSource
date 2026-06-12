import type {
  LatexReportPayload,
  LatexValidationResult,
  LatexValidationIssue,
} from './types.js';
import { isLatexThemeId } from './types.js';

export const MAX_TITLE_CHARS = 200;
export const MAX_HEADING_CHARS = 150;
export const MAX_BODY_CHARS = 100_000;

const LATEX_LOCALES = ['zh-CN', 'en-US'] as const;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_TYPE = Buffer.from('IHDR', 'ascii');
const MIN_PNG_BYTES = 24;

const DANGEROUS_COMMANDS = [
  /\\input\b/,
  /\\include\b/,
  /\\immediate\b/,
  /\\openout(?:\b|\d)/,
  /\\openin(?:\b|\d)/,
  /\\write(?:\b|\d)/,
  /\\read(?:\b|\d)/,
  /\\closeout(?:\b|\d)/,
  /\\closein(?:\b|\d)/,
];

function push(
  issues: LatexValidationIssue[],
  sectionIndex: number,
  severity: LatexValidationIssue['severity'],
  code: string,
  message: string,
): void {
  issues.push({ severity, sectionIndex, code, message });
}

export function validatePngBase64(data: string): string | null {
  const normalized = data.replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    return '不是有效的 base64 编码。';
  }
  const buf = Buffer.from(normalized, 'base64');
  if (buf.length < MIN_PNG_BYTES) {
    return '数据过短，不是有效的 PNG 图片。';
  }
  if (buf.compare(PNG_SIGNATURE, 0, 8, 0, 8) !== 0) {
    return '缺少 PNG 文件签名。';
  }
  if (buf.compare(IHDR_TYPE, 0, 4, 12, 16) !== 0) {
    return '缺少 IHDR 块，不是有效的 PNG 图片。';
  }
  return null;
}

function containsDangerousLatexCommand(value: string): boolean {
  return DANGEROUS_COMMANDS.some((pattern) => pattern.test(value));
}

function validateSection(
  sec: LatexReportPayload['sections'][number],
  index: number,
  issues: LatexValidationIssue[],
): void {
  const heading = sec.heading?.trim() ?? '';
  if (!heading) {
    push(issues, index, 'warning', 'heading.missing', `第 ${index + 1} 节缺少标题。`);
  }
  if (heading.length > MAX_HEADING_CHARS) {
    push(issues, index, 'warning', 'heading.too_long', `第 ${index + 1} 节标题过长。`);
  }
  const body = sec.body?.trim() ?? '';
  if (!body) {
    push(issues, index, 'warning', 'body.empty', `第 ${index + 1} 节正文为空。`);
  }
  if (body.length > MAX_BODY_CHARS) {
    push(issues, index, 'warning', 'body.too_long', `第 ${index + 1} 节正文过长。`);
  }
  const math = sec.math?.trim() ?? '';
  if ([heading, body, math].some(containsDangerousLatexCommand)) {
    push(issues, index, 'error', 'security.dangerous_cmd', `第 ${index + 1} 节包含潜在危险 LaTeX 命令。`);
  }
  const chartPngBase64 = sec.chartPngBase64?.trim() ?? '';
  if (chartPngBase64 && validatePngBase64(chartPngBase64)) {
    push(issues, index, 'error', 'chart.invalid_base64', `第 ${index + 1} 节包含无效 PNG 图表数据。`);
  }
}

export function validateLatexPayload(report: LatexReportPayload): LatexValidationResult {
  const issues: LatexValidationIssue[] = [];
  const title = report.title?.trim() ?? '';

  if (!isLatexThemeId(report.theme)) {
    push(issues, -1, 'error', 'meta.theme.invalid', `theme 须为 article/report/beamer，当前为 ${String(report.theme)}。`);
  }
  if (!LATEX_LOCALES.includes(report.locale as (typeof LATEX_LOCALES)[number])) {
    push(issues, -1, 'error', 'meta.locale.invalid', 'locale 须为 zh-CN 或 en-US。');
  }
  if (!title) {
    push(issues, -1, 'error', 'meta.title.missing', '标题不能为空。');
  } else if (title.length > MAX_TITLE_CHARS) {
    push(issues, -1, 'error', 'meta.title.too_long', `标题长度不能超过 ${MAX_TITLE_CHARS} 个字符。`);
  }
  if (!report.sections?.length) {
    push(issues, -1, 'error', 'sections.empty', '至少需要一个章节。');
    return { ok: false, issues };
  }

  report.sections.forEach((sec, i) => validateSection(sec, i, issues));

  const hasError = issues.some((x) => x.severity === 'error');
  return { ok: !hasError, issues };
}

export function assertValidLatexPayload(report: LatexReportPayload): LatexValidationResult {
  const result = validateLatexPayload(report);
  if (!result.ok) {
    const first = result.issues.find((issue) => issue.severity === 'error');
    throw new Error(first?.message ?? 'latex payload validation failed');
  }
  return result;
}
