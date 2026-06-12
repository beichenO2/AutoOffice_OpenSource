import type {
  DocxReportPayload,
  DocxValidationResult,
  DocxValidationIssue,
} from './types.js';
import { isDocxThemeId } from './types.js';

export const MAX_TITLE_CHARS = 120;
export const MAX_HEADING_CHARS = 100;
export const MAX_BODY_CHARS = 80_000;
export const MAX_TABLE_COLS = 20;

const DOCX_LOCALES = ['zh-CN', 'en-US'] as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_TYPE = Buffer.from('IHDR', 'ascii');
const MIN_PNG_BYTES = 24;

/**
 * Decode the first bytes of a base64 string and verify the PNG signature
 * plus the mandatory IHDR chunk header. Returns an error message or null.
 */
export function validatePngBase64(b64: string): string | null {
  let buf: Buffer;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch {
    return '不是有效的 base64 编码。';
  }
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

function push(
  issues: DocxValidationIssue[],
  sectionIndex: number,
  severity: DocxValidationIssue['severity'],
  code: string,
  message: string,
): void {
  issues.push({ severity, sectionIndex, code, message });
}

function validateSection(
  sec: DocxReportPayload['sections'][number],
  index: number,
  issues: DocxValidationIssue[],
): void {
  const heading = sec.heading?.trim() ?? '';
  if (!heading) {
    push(issues, index, 'warning', 'heading.missing', `第 ${index + 1} 节缺少标题。`);
  }
  if (heading.length > MAX_HEADING_CHARS) {
    push(issues, index, 'warning', 'heading.too_long', `第 ${index + 1} 节标题过长（>${MAX_HEADING_CHARS} 字）。`);
  }
  const body = sec.body?.trim() ?? '';
  if (!body && !sec.table) {
    push(issues, index, 'warning', 'body.empty', `第 ${index + 1} 节正文和表格均为空。`);
  }
  if (body.length > MAX_BODY_CHARS) {
    push(issues, index, 'warning', 'body.too_long', `第 ${index + 1} 节正文过长（>${MAX_BODY_CHARS} 字）。`);
  }
  if (sec.table) {
    if (sec.table.headers.length > MAX_TABLE_COLS) {
      push(issues, index, 'warning', 'table.too_wide', `第 ${index + 1} 节表格超过 ${MAX_TABLE_COLS} 列。`);
    }
    if (sec.table.rows.some((r) => r.length !== sec.table!.headers.length)) {
      push(issues, index, 'error', 'table.col_mismatch', `第 ${index + 1} 节表格行列数不一致。`);
    }
  }
  if (sec.chartPngBase64 !== undefined && sec.chartPngBase64 !== null) {
    if (typeof sec.chartPngBase64 !== 'string' || sec.chartPngBase64.length === 0) {
      push(issues, index, 'error', 'chart.invalid', `第 ${index + 1} 节 chartPngBase64 必须为非空字符串。`);
    } else {
      const pngError = validatePngBase64(sec.chartPngBase64);
      if (pngError) {
        push(issues, index, 'error', 'chart.not_png', `第 ${index + 1} 节 chartPngBase64 ${pngError}`);
      }
    }
  }
}

export function validateDocxPayload(report: DocxReportPayload): DocxValidationResult {
  const issues: DocxValidationIssue[] = [];

  if (!isDocxThemeId(report.theme)) {
    push(issues, -1, 'error', 'meta.theme.invalid', `theme 须为 DOCX_THEME_IDS 中之一，当前为 ${String(report.theme)}。`);
  }
  if (!DOCX_LOCALES.includes(report.locale as (typeof DOCX_LOCALES)[number])) {
    push(issues, -1, 'error', 'meta.locale.invalid', 'locale 须为 zh-CN 或 en-US。');
  }
  if (!report.title?.trim()) {
    push(issues, -1, 'error', 'meta.title.missing', '报告标题不能为空。');
  }
  if ((report.title?.length ?? 0) > MAX_TITLE_CHARS) {
    push(issues, -1, 'warning', 'meta.title.too_long', `标题过长（>${MAX_TITLE_CHARS} 字）。`);
  }
  if (!report.sections?.length) {
    push(issues, -1, 'error', 'sections.empty', '至少需要一个章节。');
    return { ok: false, issues };
  }

  report.sections.forEach((sec, i) => validateSection(sec, i, issues));

  const hasError = issues.some((x) => x.severity === 'error');
  return { ok: !hasError, issues };
}
