import { describe, it, expect } from 'vitest';
import { describeNode, describeSelection, shortExcerpt, typeLabel } from '../../src/engine/labels.js';
import { parseRewriteInstruction } from '../../src/engine/orchestrator.js';
import type { SemanticNode } from '../../src/engine/types.js';

const node = (over: Partial<SemanticNode> = {}): SemanticNode => ({
  id: 'n1',
  type: 'paragraph',
  file: 'main.tex',
  range: { start: 0, end: 10 },
  ...over,
});

describe('labels — typeLabel', () => {
  it('names every semantic type in Chinese', () => {
    expect(typeLabel('heading')).toBe('标题');
    expect(typeLabel('table')).toBe('表格');
    expect(typeLabel('section')).toBe('章节标题');
    expect(typeLabel('slide')).toBe('整页幻灯片');
  });

  it('falls back to 元素 for an unknown type', () => {
    expect(typeLabel('nonsense' as never)).toBe('元素');
  });
});

describe('labels — shortExcerpt', () => {
  it('collapses whitespace and newlines', () => {
    expect(shortExcerpt('  第一行\n\n  第二行  ')).toBe('第一行 第二行');
  });

  it('elides past the length cap', () => {
    const long = '一二三四五六七八九十一二三四五六七八九十';
    const out = shortExcerpt(long);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(19);
  });

  it('is empty for undefined rather than printing "undefined"', () => {
    expect(shortExcerpt(undefined)).toBe('');
  });

  it('reads LaTeX table source as prose, not as markup', () => {
    const tex = '\\begin{tabular}{|l|r|}\n\\hline\n项目 & 数值 \\\\\n\\hline\n\\end{tabular}';
    const out = shortExcerpt(tex);
    expect(out).toContain('项目');
    expect(out).toContain('数值');
    expect(out).not.toContain('\\');
    expect(out).not.toContain('tabular');
  });

  it('unwraps a single-argument macro to its content', () => {
    expect(shortExcerpt('\\textbf{重点结论}')).toBe('重点结论');
  });
});

describe('labels — describeNode', () => {
  it('renders page, type and excerpt for a PDF node', () => {
    const label = describeNode(node({ type: 'paragraph', page: 2, excerpt: '本报告根据您的需求生成' }), {
      kind: 'pdf',
    });
    expect(label).toBe('第 2 页 · 正文段落「本报告根据您的需求生成」');
  });

  it('says 幻灯片 for a deck node', () => {
    const label = describeNode(node({ type: 'heading', page: 3, excerpt: '市场概览' }), {
      kind: 'presentation',
    });
    expect(label).toBe('第 3 页幻灯片 · 标题「市场概览」');
  });

  it('drops the page prefix when the page is unknown', () => {
    expect(describeNode(node({ type: 'table' }))).toBe('表格');
  });

  it('drops the page prefix when asked to', () => {
    const label = describeNode(node({ type: 'table', page: 4, excerpt: '季度数据' }), { omitPage: true });
    expect(label).toBe('表格「季度数据」');
  });

  it('omits the quotes entirely when there is no text', () => {
    expect(describeNode(node({ type: 'image', page: 1 }), { kind: 'pdf' })).toBe('第 1 页 · 图片');
  });

  it('phrases a selection the way the UI speaks', () => {
    const label = describeSelection(node({ type: 'heading', page: 2, excerpt: '二级标题' }), { kind: 'pdf' });
    expect(label).toBe('你框住的是 第 2 页 · 标题「二级标题」');
  });
});

describe('orchestrator — parseRewriteInstruction gate', () => {
  it('extracts the replacement after 改成', () => {
    expect(parseRewriteInstruction('把标题改成「季度业绩回顾」')).toEqual({
      text: '季度业绩回顾',
      literal: true,
    });
  });

  it.each([
    ['改为', '标题改为新的标题'],
    ['换成', '这里换成更短的说法'],
    ['修改为', '正文修改为一句话总结'],
    ['替换为', '表头替换为中文'],
    ['写成', '把这段写成三条要点'],
  ])('recognizes %s as a literal rewrite', (_verb, instruction) => {
    expect(parseRewriteInstruction(instruction).literal).toBe(true);
  });

  it('recognizes the English forms', () => {
    expect(parseRewriteInstruction('change to Quarterly Review')).toEqual({
      text: 'Quarterly Review',
      literal: true,
    });
    expect(parseRewriteInstruction('replace with "Summary"').literal).toBe(true);
  });

  it('strips a trailing full stop from the captured text', () => {
    expect(parseRewriteInstruction('标题改成季度回顾。').text).toBe('季度回顾');
  });

  /**
   * The regression this gate exists for: the old code fell back to "use the
   * whole instruction as the replacement", which literally wrote the complaint
   * into the document.
   */
  it.each([
    '这里字太小了',
    '这段太挤了',
    '把这里改好看一点',
    '标题不够醒目',
    'make this nicer',
  ])('refuses to treat the complaint %s as replacement text', (instruction) => {
    expect(parseRewriteInstruction(instruction).literal).toBe(false);
  });

  it('reports non-literal for an empty instruction', () => {
    expect(parseRewriteInstruction('   ').literal).toBe(false);
  });

  it('never claims literal with empty replacement text', () => {
    const r = parseRewriteInstruction('把标题改成');
    expect(r.literal && r.text.length > 0).toBe(r.literal);
  });
});
