import type {
  PdfReportPayload,
  PdfValidationResult,
  PdfValidationIssue,
} from './types.js';
import { isPdfThemeId } from './types.js';

export const MAX_TITLE_CHARS = 120;
export const MAX_HEADING_CHARS = 100;
export const MAX_BODY_CHARS = 50_000;

const PDF_LOCALES = ['zh-CN', 'en-US'] as const;

function push(
  issues: PdfValidationIssue[],
  sectionIndex: number,
  severity: PdfValidationIssue['severity'],
  code: string,
  message: string,
): void {
  issues.push({ severity, sectionIndex, code, message });
}

function validateSection(
  sec: { heading: string; body: string; level?: number },
  index: number,
  issues: PdfValidationIssue[],
): void {
  const heading = sec.heading?.trim() ?? '';
  if (!heading) {
    push(issues, index, 'warning', 'heading.missing', `第 ${index + 1} 节缺少标题。`);
  }
  if (heading.length > MAX_HEADING_CHARS) {
    push(
      issues,
      index,
      'warning',
      'heading.too_long',
      `第 ${index + 1} 节标题过长（>${MAX_HEADING_CHARS} 字），建议缩短。`,
    );
  }

  const body = sec.body?.trim() ?? '';
  if (!body) {
    push(issues, index, 'warning', 'body.empty', `第 ${index + 1} 节正文为空。`);
  }
  if (body.length > MAX_BODY_CHARS) {
    push(
      issues,
      index,
      'warning',
      'body.too_long',
      `第 ${index + 1} 节正文过长（>${MAX_BODY_CHARS} 字），可能影响排版。`,
    );
  }
}

export function validatePdfPayload(report: PdfReportPayload): PdfValidationResult {
  const issues: PdfValidationIssue[] = [];

  if (!isPdfThemeId(report.theme)) {
    push(
      issues,
      -1,
      'error',
      'meta.theme.invalid',
      `theme 须为 PDF_THEME_IDS 中之一，当前为 ${String(report.theme)}。`,
    );
  }

  if (!PDF_LOCALES.includes(report.locale as (typeof PDF_LOCALES)[number])) {
    push(issues, -1, 'error', 'meta.locale.invalid', `locale 须为 zh-CN 或 en-US。`);
  }

  const titleStr = typeof report.title === 'string' ? report.title : '';
  if (!titleStr.trim()) {
    push(issues, -1, 'error', 'meta.title.missing', '报告标题不能为空。');
  }
  if (titleStr.length > MAX_TITLE_CHARS) {
    push(issues, -1, 'warning', 'meta.title.too_long', `标题过长（>${MAX_TITLE_CHARS} 字）。`);
  }

  if (!report.sections?.length) {
    push(issues, -1, 'error', 'sections.empty', '至少需要一个章节。');
    return { ok: false, issues };
  }

  report.sections.forEach((sec, i) => {
    validateSection(sec, i, issues);
  });

  const hasError = issues.some((x) => x.severity === 'error');
  return { ok: !hasError, issues };
}
