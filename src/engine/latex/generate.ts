/**
 * LaTeX document generator with stable semantic node markers (`\aoNode{id}{…}`).
 * Pure TypeScript — no Python on the engine path.
 */
import type { SourceFile } from '../types.js';

export interface PdfSectionSpec {
  id: string;
  heading: string;
  body: string;
  kind?: 'text' | 'table' | 'formula';
}

export interface PdfDocSpec {
  title: string;
  author?: string;
  sections: PdfSectionSpec[];
}

export function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, (c) => `\\${c}`)
    .replace(/\[/g, '{[}')
    .replace(/\]/g, '{]}');
}

function renderSection(section: PdfSectionSpec): string {
  const head = `\\section{${escapeLatex(section.heading)}}\n`;
  switch (section.kind) {
    case 'table':
      return `${head}\\aoNode{${section.id}}{\n\\begin{tabular}{|l|r|}\n\\hline\n项目 & 数值 \\\\\\hline\n${escapeLatex(section.body)} & 42 \\\\\\hline\n\\end{tabular}\n}\n`;
    case 'formula':
      return `${head}\\aoNode{${section.id}}{\n\\begin{equation}\nE = mc^2\n\\end{equation}\n}\n`;
    default:
      return `${head}\\aoNode{${section.id}}{${escapeLatex(section.body)}}\n`;
  }
}

export function renderLatexDocument(spec: PdfDocSpec): string {
  const body = spec.sections.map(renderSection).join('\n');
  return [
    '\\documentclass[UTF8,a4paper]{ctexart}',
    '\\usepackage[margin=2.5cm]{geometry}',
    '\\usepackage{hyperref}',
    '\\newcommand{\\aoNode}[2]{\\label{ao:#1}#2}',
    '\\begin{document}',
    `\\title{${escapeLatex(spec.title)}}`,
    spec.author ? `\\author{${escapeLatex(spec.author)}}` : '',
    '\\maketitle',
    body,
    '\\end{document}',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function pdfSpecFromBrief(title: string, goals: string[]): PdfDocSpec {
  return {
    title,
    sections: [
      { id: 'sec-intro', heading: '概述', body: goals.join('；') || '本报告根据您的需求自动生成。' },
      { id: 'para-detail', heading: '要点', body: '此处为正文段落，可通过框选修改措辞或版式。', kind: 'text' },
      { id: 'table-1', heading: '数据表', body: '示例行', kind: 'table' },
    ],
  };
}

export function latexSourceFiles(tex: string): SourceFile[] {
  return [{ path: 'main.tex', language: 'latex', content: tex }];
}
