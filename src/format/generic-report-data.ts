import type { ReportFormat } from './types.js';

export const SUPPORTED_GENERATE_FORMATS = ['pptx', 'pdf', 'docx', 'latex', 'latex-pdf', 'html'] as const;

export function isSupportedGenerateFormat(value: string): value is ReportFormat {
  return SUPPORTED_GENERATE_FORMATS.includes(value as (typeof SUPPORTED_GENERATE_FORMATS)[number]);
}

export function normalizeGenerateFormat(value: string): ReportFormat | null {
  let normalized = value.toLowerCase();
  if (normalized === 'ppt') normalized = 'pptx';
  if (normalized === 'tex') normalized = 'latex';
  return isSupportedGenerateFormat(normalized) ? normalized : null;
}

interface GenericSection {
  title?: string;
  heading?: string;
  content?: string;
  body?: string;
  bullets?: string[];
}

function hasFormatPayload(data: Record<string, unknown>, format: string): boolean {
  const key = format === 'pptx' ? 'pptx' : format === 'latex-pdf' ? 'latex' : format;
  return data[key] != null && typeof data[key] === 'object';
}

export function autoConvertPayload(
  data: Record<string, unknown>,
  format: ReportFormat,
  locale: string,
): Record<string, unknown> {
  if (format === 'html' || hasFormatPayload(data, format)) return data;

  const sections = (data['sections'] as GenericSection[] | undefined) ?? [];
  if (sections.length === 0) return data;

  const title = (data['title'] as string) ?? sections[0]?.title ?? 'Report';

  if (format === 'pptx') {
    return {
      ...data,
      pptx: {
        theme: 'business',
        locale,
        title,
        subtitle: (data['subtitle'] as string) ?? '',
        slides: sections.map((section) => ({
          title: section.title ?? section.heading ?? '',
          bullets: section.bullets ?? [section.content ?? section.body ?? ''],
        })),
      },
    };
  }

  const mappedSections = sections.map((section) => ({
    heading: section.heading ?? section.title ?? '',
    level: 1,
    body: section.body ?? section.content ?? '',
  }));

  if (format === 'pdf') {
    return { ...data, pdf: { theme: 'business', locale, title, toc: true, sections: mappedSections } };
  }
  if (format === 'docx') {
    return { ...data, docx: { theme: 'business', locale, title, toc: true, sections: mappedSections } };
  }
  if (format === 'latex' || format === 'latex-pdf') {
    return { ...data, latex: { theme: 'article', locale, title, toc: true, sections: mappedSections } };
  }
  return data;
}
