import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_GENERATE_FORMATS,
  isSupportedGenerateFormat,
  normalizeGenerateFormat,
  autoConvertPayload,
} from '../src/format/generic-report-data.js';

describe('generic-report-data', () => {
  describe('isSupportedGenerateFormat', () => {
    it('accepts all supported formats', () => {
      for (const fmt of SUPPORTED_GENERATE_FORMATS) {
        expect(isSupportedGenerateFormat(fmt)).toBe(true);
      }
    });

    it('rejects unknown format', () => {
      expect(isSupportedGenerateFormat('png')).toBe(false);
      expect(isSupportedGenerateFormat('')).toBe(false);
    });
  });

  describe('normalizeGenerateFormat', () => {
    it('maps ppt to pptx', () => {
      expect(normalizeGenerateFormat('ppt')).toBe('pptx');
      expect(normalizeGenerateFormat('PPT')).toBe('pptx');
    });

    it('lowercases valid formats', () => {
      expect(normalizeGenerateFormat('PDF')).toBe('pdf');
      expect(normalizeGenerateFormat('DOCX')).toBe('docx');
      expect(normalizeGenerateFormat('HTML')).toBe('html');
      expect(normalizeGenerateFormat('LATEX')).toBe('latex');
    });

    it('returns null for unsupported format', () => {
      expect(normalizeGenerateFormat('xlsx')).toBeNull();
    });
  });

  describe('autoConvertPayload', () => {
    const genericData = {
      title: 'My Report',
      subtitle: 'Subtitle',
      sections: [
        { title: 'Intro', content: 'Hello world', bullets: ['point 1', 'point 2'] },
        { heading: 'Details', body: 'Body text' },
      ],
    };

    it('returns data unchanged for html format', () => {
      const result = autoConvertPayload(genericData, 'html', 'zh-CN');
      expect(result).toBe(genericData);
    });

    it('returns data unchanged if format-specific payload already exists', () => {
      const withPdf = { ...genericData, pdf: { theme: 'custom' } };
      const result = autoConvertPayload(withPdf, 'pdf', 'zh-CN');
      expect(result).toBe(withPdf);
    });

    it('converts generic sections to pptx payload', () => {
      const result = autoConvertPayload(genericData, 'pptx', 'zh-CN');
      expect(result.pptx).toBeDefined();
      const pptx = result.pptx as Record<string, unknown>;
      expect(pptx.theme).toBe('business');
      expect(pptx.title).toBe('My Report');
      expect(pptx.subtitle).toBe('Subtitle');
      const slides = pptx.slides as Array<{ title: string; bullets: string[] }>;
      expect(slides).toHaveLength(2);
      expect(slides[0].bullets).toEqual(['point 1', 'point 2']);
      expect(slides[1].bullets).toEqual(['Body text']);
    });

    it('converts generic sections to pdf payload', () => {
      const result = autoConvertPayload(genericData, 'pdf', 'en-US');
      expect(result.pdf).toBeDefined();
      const pdf = result.pdf as Record<string, unknown>;
      expect(pdf.theme).toBe('business');
      expect(pdf.locale).toBe('en-US');
      expect(pdf.toc).toBe(true);
    });

    it('converts generic sections to docx payload', () => {
      const result = autoConvertPayload(genericData, 'docx', 'zh-CN');
      expect(result.docx).toBeDefined();
      const docx = result.docx as Record<string, unknown>;
      expect(docx.theme).toBe('business');
      expect(docx.toc).toBe(true);
    });

    it('converts generic sections to latex payload', () => {
      const result = autoConvertPayload(genericData, 'latex', 'en-US');
      expect(result.latex).toBeDefined();
      const latex = result.latex as Record<string, unknown>;
      expect(latex.theme).toBe('article');
    });

    it('returns data unchanged when no sections exist', () => {
      const noSections = { title: 'Empty' };
      const result = autoConvertPayload(noSections, 'pdf', 'zh-CN');
      expect(result.pdf).toBeUndefined();
    });

    it('uses first section title when no title provided', () => {
      const noTitle = { sections: [{ title: 'Section Title', content: 'x' }] };
      const result = autoConvertPayload(noTitle, 'pptx', 'zh-CN');
      const pptx = result.pptx as Record<string, unknown>;
      expect(pptx.title).toBe('Section Title');
    });

    it('falls back to Report when no title anywhere', () => {
      const noTitle = { sections: [{ content: 'x' }] };
      const result = autoConvertPayload(noTitle, 'pptx', 'zh-CN');
      const pptx = result.pptx as Record<string, unknown>;
      expect(pptx.title).toBe('Report');
    });
  });
});
