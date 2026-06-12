import { describe, expect, it } from 'vitest';
import { validatePdfPayload } from '../src/pdf/validate.js';
import { validatePptxPayload } from '../src/ppt/validate.js';
import { validateDocxPayload } from '../src/docx/validate.js';
import { validateLatexPayload } from '../src/latex/validate.js';
import { isPdfThemeId, PDF_THEME_IDS } from '../src/pdf/types.js';
import { isPptxThemeId, PPTX_THEME_IDS } from '../src/ppt/types.js';
import { isDocxThemeId, DOCX_THEME_IDS } from '../src/docx/types.js';
import { isLatexThemeId, LATEX_THEME_IDS } from '../src/latex/types.js';
import { stripAiFlavor } from '../src/text/deai.js';
import { analyzeQuality } from '../src/text/quality.js';
import { analyzeMonotony } from '../src/text/monotony.js';
import { analyzeDiversity } from '../src/text/diversity.js';
import { runReportPipeline, registerFormatAdapter } from '../src/format/pipeline.js';
import { registerFormatAdapters } from '../src/format/format-adapters.js';
import { autoConvertPayload, normalizeGenerateFormat, isSupportedGenerateFormat } from '../src/format/generic-report-data.js';
import { buildPdfHtml } from '../src/pdf/html-builder.js';
import type { PdfReportPayload } from '../src/pdf/types.js';
import type { PptxDeckPayload } from '../src/ppt/types.js';
import type { DocxReportPayload } from '../src/docx/types.js';
import type { LatexReportPayload } from '../src/latex/types.js';

registerFormatAdapters();

/* ============================================================ */
/*  1. FUNCTIONALITY TESTS — all formats, all themes            */
/* ============================================================ */

describe('功能测试：全格式全主题验证', () => {
  const section = { heading: 'Test Section', body: 'This is a test body with some content for validation.' };

  describe('PDF — all themes produce valid HTML', () => {
    for (const theme of PDF_THEME_IDS) {
      it(`theme=${theme}`, () => {
        const payload: PdfReportPayload = {
          theme, locale: 'zh-CN', title: `Test ${theme}`, sections: [section],
        };
        const result = validatePdfPayload(payload);
        expect(result.ok).toBe(true);
        const html = buildPdfHtml(payload);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain(`Test ${theme}`);
      });
    }
  });

  describe('PPTX — all themes pass validation', () => {
    for (const theme of PPTX_THEME_IDS) {
      it(`theme=${theme}`, () => {
        const payload: PptxDeckPayload = {
          theme, locale: 'zh-CN', title: `Test ${theme}`,
          slides: [{ title: 'Slide 1', bullets: ['Point A', 'Point B'] }],
        };
        expect(validatePptxPayload(payload).ok).toBe(true);
      });
    }
  });

  describe('DOCX — all themes pass validation', () => {
    for (const theme of DOCX_THEME_IDS) {
      it(`theme=${theme}`, () => {
        const payload: DocxReportPayload = {
          theme, locale: 'zh-CN', title: `Test ${theme}`, sections: [section],
        };
        expect(validateDocxPayload(payload).ok).toBe(true);
      });
    }
  });

  describe('LaTeX — all themes pass validation', () => {
    for (const theme of LATEX_THEME_IDS) {
      it(`theme=${theme}`, () => {
        const payload: LatexReportPayload = {
          theme, locale: 'en-US', title: `Test ${theme}`, sections: [section],
        };
        expect(validateLatexPayload(payload).ok).toBe(true);
      });
    }
  });

  describe('HTML pipeline produces output', () => {
    it('renders basic HTML', async () => {
      const data = { sections: [{ title: 'Hello', content: 'World' }] };
      const artifact = await runReportPipeline({
        format: 'html',
        data,
        template: { kind: 'inline', source: '<html>{{#each sections}}<h1>{{title}}</h1><p>{{content}}</p>{{/each}}</html>' },
      });
      expect(artifact.mime).toBe('text/html');
      expect(artifact.body).toContain('Hello');
    });
  });

  describe('format normalization', () => {
    it('normalizes ppt→pptx', () => { expect(normalizeGenerateFormat('ppt')).toBe('pptx'); });
    it('normalizes tex→latex', () => { expect(normalizeGenerateFormat('tex')).toBe('latex'); });
    it('rejects unknown', () => { expect(normalizeGenerateFormat('xlsx')).toBeNull(); });
    it('all formats supported', () => {
      for (const f of ['pptx', 'pdf', 'docx', 'latex', 'latex-pdf', 'html']) {
        expect(isSupportedGenerateFormat(f)).toBe(true);
      }
    });
  });

  describe('auto payload conversion', () => {
    const generic = { title: 'Report', sections: [{ title: 'Sec1', content: 'Body1' }] };
    it('converts to pptx', () => {
      const converted = autoConvertPayload(generic, 'pptx', 'zh-CN');
      expect(converted).toHaveProperty('pptx');
    });
    it('converts to pdf', () => {
      const converted = autoConvertPayload(generic, 'pdf', 'zh-CN');
      expect(converted).toHaveProperty('pdf');
    });
    it('converts to docx', () => {
      const converted = autoConvertPayload(generic, 'docx', 'zh-CN');
      expect(converted).toHaveProperty('docx');
    });
    it('converts to latex', () => {
      const converted = autoConvertPayload(generic, 'latex', 'en-US');
      expect(converted).toHaveProperty('latex');
    });
    it('html passes through', () => {
      const converted = autoConvertPayload(generic, 'html', 'zh-CN');
      expect(converted).toBe(generic);
    });
  });

  describe('text quality pipeline', () => {
    it('de-AI strips common patterns', () => {
      const input = '综上所述，本文深入探讨了这一领域的多个维度。值得注意的是，不可否认的是，这是一个重要的课题。';
      const output = stripAiFlavor(input);
      expect(output.length).toBeLessThanOrEqual(input.length);
    });

    it('quality analysis returns valid grade', () => {
      const report = analyzeQuality('这是一段简单的测试文本，用于验证质量分析功能是否正常工作。');
      expect(['A', 'B', 'C', 'D', 'F']).toContain(report.grade);
      expect(report.overallScore).toBeGreaterThanOrEqual(0);
      expect(report.overallScore).toBeLessThanOrEqual(100);
    });

    it('monotony analysis returns valid score', () => {
      const report = analyzeMonotony('句子一。句子二。句子三。');
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('diversity analysis returns valid metrics', () => {
      const report = analyzeDiversity('这是一段文本。另一段文本。不同的文本。');
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });
  });
});

/* ============================================================ */
/*  2. STRESS TESTS — large payloads, many sections, edge cases */
/* ============================================================ */

describe('压力测试', () => {
  describe('large payload validation', () => {
    it('PDF: 50 sections, 2000 char bodies', () => {
      const longBody = '测试内容重复'.repeat(300);
      const sections = Array.from({ length: 50 }, (_, i) => ({
        heading: `Section ${i + 1}`,
        body: longBody,
      }));
      const payload: PdfReportPayload = {
        theme: 'academic', locale: 'zh-CN', title: 'Stress Test', sections,
      };
      const result = validatePdfPayload(payload);
      expect(result.ok).toBe(true);
    });

    it('PPTX: 30 slides, max bullets', () => {
      const slides = Array.from({ length: 30 }, (_, i) => ({
        title: `Slide ${i + 1}`,
        bullets: Array.from({ length: 6 }, (_, j) => `Bullet ${j + 1} content`),
      }));
      const payload: PptxDeckPayload = {
        theme: 'business', locale: 'zh-CN', title: 'Stress PPTX', slides,
      };
      expect(validatePptxPayload(payload).ok).toBe(true);
    });

    it('DOCX: section with large table (20 cols, 100 rows)', () => {
      const headers = Array.from({ length: 20 }, (_, i) => `Col ${i}`);
      const rows = Array.from({ length: 100 }, () => headers.map((_, i) => `Value ${i}`));
      const payload: DocxReportPayload = {
        theme: 'academic', locale: 'zh-CN', title: 'Table Stress',
        sections: [{ heading: 'Big Table', body: 'Data follows.', table: { headers, rows } }],
      };
      expect(validateDocxPayload(payload).ok).toBe(true);
    });

    it('LaTeX: section with bibliography (50 refs)', () => {
      const bib = Array.from({ length: 50 }, (_, i) => `Author ${i}. Title ${i}. Journal, ${2020 + (i % 6)}.`);
      const payload: LatexReportPayload = {
        theme: 'article', locale: 'en-US', title: 'Bibliography Stress',
        sections: [{ heading: 'Intro', body: 'Content.' }],
        bibliography: bib,
      };
      expect(validateLatexPayload(payload).ok).toBe(true);
    });
  });

  describe('PDF HTML builder stress', () => {
    it('renders 50-section PDF HTML without crash', () => {
      const sections = Array.from({ length: 50 }, (_, i) => ({
        heading: `Chapter ${i + 1}`,
        body: 'Content '.repeat(100),
      }));
      const html = buildPdfHtml({
        theme: 'study-review', locale: 'zh-CN', title: 'Mega Report',
        toc: true, sections,
      });
      expect(html.length).toBeGreaterThan(10000);
      expect(html).toContain('总述 / 目录');
      expect(html).toContain('Chapter 50');
    });
  });

  describe('concurrent validation (simulated)', () => {
    it('100 parallel PDF validations', async () => {
      const tasks = Array.from({ length: 100 }, (_, i) =>
        Promise.resolve(validatePdfPayload({
          theme: PDF_THEME_IDS[i % PDF_THEME_IDS.length]!,
          locale: i % 2 === 0 ? 'zh-CN' : 'en-US',
          title: `Report ${i}`,
          sections: [{ heading: `Section ${i}`, body: `Body ${i}` }],
        }))
      );
      const results = await Promise.all(tasks);
      expect(results.every(r => r.ok)).toBe(true);
    });
  });

  describe('boundary values', () => {
    it('PDF title at exactly 120 chars', () => {
      const title = 'x'.repeat(120);
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title,
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.ok).toBe(true);
    });

    it('PDF title at 121 chars warns', () => {
      const title = 'x'.repeat(121);
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title,
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.issues.some(i => i.code === 'meta.title.too_long')).toBe(true);
    });

    it('PPTX slide with 7 bullets errors', () => {
      const result = validatePptxPayload({
        theme: 'business', locale: 'zh-CN', title: 'T',
        slides: [{ title: 'S', bullets: Array(7).fill('b') }],
      });
      expect(result.issues.some(i => i.code === 'bullets.too_many')).toBe(true);
    });

    it('single-char title is valid', () => {
      const result = validatePdfPayload({
        theme: 'minimal', locale: 'en-US', title: 'X',
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.ok).toBe(true);
    });
  });
});

/* ============================================================ */
/*  3. ATTACK TESTS — XSS, injection, malformed inputs          */
/* ============================================================ */

describe('攻击测试', () => {
  describe('XSS resistance in PDF HTML builder', () => {
    const xssVectors = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert(1)>',
      '"><script>document.cookie</script>',
      "javascript:alert('xss')",
      '<svg onload=alert(1)>',
      '{{constructor.constructor("return this")()}}',
    ];

    for (const vector of xssVectors) {
      it(`escapes: ${vector.slice(0, 40)}...`, () => {
        const html = buildPdfHtml({
          theme: 'academic', locale: 'zh-CN', title: vector,
          sections: [{ heading: vector, body: vector }],
        });
        expect(html).not.toMatch(/<script[\s>]/i);
        expect(html).not.toMatch(/<img\s/i);
        expect(html).not.toMatch(/<svg\s/i);
        expect(html).not.toMatch(/href\s*=\s*["']?javascript:/i);
      });
    }
  });

  describe('LaTeX injection resistance', () => {
    const injections = [
      '\\input{/etc/passwd}',
      '\\include{malicious}',
      '\\immediate\\write18{rm -rf /}',
      '\\openout15=malfile',
    ];

    for (const injection of injections) {
      it(`detects dangerous command: ${injection.slice(0, 30)}`, () => {
        const result = validateLatexPayload({
          theme: 'article', locale: 'en-US', title: 'Safe Title',
          sections: [{ heading: 'Section', body: injection }],
        });
        expect(result.issues.some(i => i.code === 'security.dangerous_cmd')).toBe(true);
      });
    }
  });

  describe('malformed input handling', () => {
    it('null theme does not crash', () => {
      const result = validatePdfPayload({
        theme: null as never, locale: 'zh-CN', title: 'T',
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.ok).toBe(false);
    });

    it('undefined fields do not crash', () => {
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: 'T',
        sections: [{ heading: undefined as never, body: undefined as never }],
      });
      expect(result).toBeDefined();
    });

    it('number as title does not crash and is rejected', () => {
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: 12345 as never,
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result).toBeDefined();
      expect(result.ok).toBe(false);
    });

    it('empty string theme is rejected', () => {
      const result = validatePdfPayload({
        theme: '' as never, locale: 'zh-CN', title: 'T',
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.ok).toBe(false);
    });

    it('extremely long body is warned', () => {
      const longBody = 'x'.repeat(51000);
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: 'T',
        sections: [{ heading: 'H', body: longBody }],
      });
      expect(result.issues.some(i => i.code === 'body.too_long')).toBe(true);
    });

    it('DOCX table column mismatch is an error', () => {
      const result = validateDocxPayload({
        theme: 'academic', locale: 'zh-CN', title: 'T',
        sections: [{
          heading: 'H', body: 'B',
          table: { headers: ['A', 'B', 'C'], rows: [['1', '2']] },
        }],
      });
      expect(result.issues.some(i => i.code === 'table.col_mismatch')).toBe(true);
    });

    it('PPTX empty bullet is an error', () => {
      const result = validatePptxPayload({
        theme: 'business', locale: 'zh-CN', title: 'T',
        slides: [{ title: 'S', bullets: ['valid', '', 'also valid'] }],
      });
      expect(result.issues.some(i => i.code === 'bullet.empty')).toBe(true);
    });
  });

  describe('unicode edge cases', () => {
    it('emoji in title does not crash', () => {
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: '🎉 测试报告 🎊',
        sections: [{ heading: '📌 重点', body: '👍 内容很好' }],
      });
      expect(result.ok).toBe(true);
    });

    it('CJK mixed with RTL does not crash', () => {
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: '测试 مرحبا テスト',
        sections: [{ heading: '中文 العربية 日本語', body: 'Mixed content' }],
      });
      expect(result.ok).toBe(true);
    });

    it('zero-width characters in title', () => {
      const result = validatePdfPayload({
        theme: 'academic', locale: 'zh-CN', title: 'Test\u200B\u200CTitle\u200D',
        sections: [{ heading: 'H', body: 'B' }],
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('prototype pollution resistance', () => {
    it('__proto__ in payload does not affect validation', () => {
      const evil = JSON.parse('{"theme":"academic","locale":"zh-CN","title":"T","sections":[{"heading":"H","body":"B"}],"__proto__":{"polluted":true}}');
      const result = validatePdfPayload(evil);
      expect(result.ok).toBe(true);
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
  });
});
