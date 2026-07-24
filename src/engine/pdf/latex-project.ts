/**
 * LaTeX project emitter with stable semantic anchors (`% ao:id=…` markers).
 * Source-of-truth for PDF documents in the IDE engine.
 */
import type { Brief, SemanticNode, SourceFile, SourceMap } from '../types.js';
import { randomIdFactory, type IdFactory } from '../ids.js';

export interface LatexSectionSpec {
  id: string;
  heading: string;
  level?: 1 | 2 | 3;
  body: string;
  /** When set, emit a table block (non-text structure target for E2E). */
  table?: { headers: string[]; rows: string[][] };
}

export interface LatexProjectSpec {
  title: string;
  author?: string;
  sections: LatexSectionSpec[];
}

const AO_MARKER = /^% ao:id=([a-zA-Z0-9_-]+)\s*$/m;

export function emitLatexProject(spec: LatexProjectSpec): SourceFile[] {
  const lines: string[] = [
    '\\documentclass[12pt,a4paper]{article}',
    '\\usepackage[UTF8]{ctex}',
    '\\usepackage{geometry}',
    '\\geometry{a4paper,left=30mm,right=20mm,top=25mm,bottom=25mm}',
    '\\usepackage{hyperref}',
    '\\usepackage{booktabs}',
    '',
    `% ao:id=doc-root`,
    `\\title{${texEscape(spec.title)}}`,
    spec.author ? `\\author{${texEscape(spec.author)}}` : '',
    '\\date{\\today}',
    '\\begin{document}',
    '\\maketitle',
    '',
  ].filter(Boolean);

  for (const sec of spec.sections) {
    lines.push(`% ao:id=${sec.id}`);
    const cmd = sec.level === 2 ? 'subsection' : sec.level === 3 ? 'subsubsection' : 'section';
    lines.push(`\\${cmd}{${texEscape(sec.heading)}}`);
    lines.push(sec.body);
    if (sec.table) {
      lines.push(`% ao:id=${sec.id}-table`);
      lines.push('\\begin{table}[h]');
      lines.push('\\centering');
      lines.push('\\begin{tabular}{' + 'l'.repeat(sec.table.headers.length) + '}');
      lines.push('\\toprule');
      lines.push(sec.table.headers.map(texEscape).join(' & ') + ' \\\\');
      lines.push('\\midrule');
      for (const row of sec.table.rows) {
        lines.push(row.map(texEscape).join(' & ') + ' \\\\');
      }
      lines.push('\\bottomrule');
      lines.push('\\end{tabular}');
      lines.push(`\\caption{${texEscape(sec.heading)} 数据表}`);
      lines.push('\\end{table}');
    }
    lines.push('');
  }

  lines.push('\\end{document}', '');
  const content = lines.join('\n');
  return [{ path: 'main.tex', language: 'latex', content }];
}

export function parseLatexNodes(tex: string, file = 'main.tex'): SemanticNode[] {
  const nodes: SemanticNode[] = [];
  const re = /% ao:id=([a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  const ids: Array<{ id: string; index: number }> = [];
  while ((m = re.exec(tex))) {
    ids.push({ id: m[1]!, index: m.index });
  }
  for (let i = 0; i < ids.length; i++) {
    const cur = ids[i]!;
    const next = ids[i + 1];
    const start = cur.index;
    const end = next ? next.index : tex.length;
    const slice = tex.slice(start, end);
    const type = slice.includes('\\begin{table}') ? 'table' : slice.includes('\\section') ? 'section' : 'paragraph';
    nodes.push({
      id: cur.id,
      type,
      range: { file, start, end },
      excerpt: slice.replace(/% ao:id=\S+\s*/g, '').trim().slice(0, 120),
    });
  }
  return nodes;
}

export function buildSourceMap(revisionId: string, tex: string, file = 'main.tex'): SourceMap {
  return {
    id: `map_${revisionId}`,
    revisionId,
    nodes: parseLatexNodes(tex, file),
  };
}

export function briefToLatexSpec(brief: Brief, titleFallback: string): LatexProjectSpec {
  return {
    title: titleFallback,
    sections: [
      {
        id: 'cover-title',
        heading: '概述',
        body: '本文档由 AutoOffice 引擎根据结构化 Brief 生成，可在 IDE 中框选局部修改。',
      },
      {
        id: 'sec-metrics',
        heading: '关键指标',
        body: '以下为核心业务指标摘要。',
        table: {
          headers: ['指标', '本季度', '上季度'],
          rows: [
            ['营收', '1200 万', '980 万'],
            ['毛利率', '42%', '39%'],
          ],
        },
      },
    ],
  };
}

export function applyLatexTextPatch(
  tex: string,
  nodeId: string,
  newText: string,
): { tex: string; changed: boolean } {
  const marker = `% ao:id=${nodeId}`;
  const idx = tex.indexOf(marker);
  if (idx === -1) return { tex, changed: false };
  const after = tex.slice(idx);
  const secMatch = /\\(?:sub)*section\{([^}]*)\}/.exec(after);
  if (secMatch) {
    const full = secMatch[0]!;
    const replaced = full.replace(secMatch[1]!, texEscape(newText));
    const out = tex.slice(0, idx) + after.replace(full, replaced);
    return { tex: out, changed: true };
  }
  return { tex, changed: false };
}

export function texEscape(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (c) => `\\${c}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

export function defaultLatexSpec(title: string): LatexProjectSpec {
  return briefToLatexSpec(
    {
      id: 'b',
      projectId: 'p',
      docType: 'report',
      audience: '',
      scenario: '',
      contentGoals: [],
      materials: [],
      deliveryFormats: ['pdf'],
      standards: [],
      preferences: [],
      prohibitions: [],
      uncertainties: [],
      assumptions: [],
      createdAt: '',
    },
    title,
  );
}

export function newRevisionSourceFromBrief(title: string, idFactory: IdFactory = randomIdFactory): SourceFile[] {
  void idFactory;
  return emitLatexProject(defaultLatexSpec(title));
}
