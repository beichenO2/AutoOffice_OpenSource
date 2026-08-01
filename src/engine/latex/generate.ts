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
      // Publication-quality table: booktabs horizontal rules only (no vertical
      // lines), caption above, centered — per NeurIPS/CVPR formatting guidance.
      return (
        `${head}\\begin{center}\n` +
        `\\captionof{table}{示例数据表}\n` +
        `\\aoNode{${section.id}}{%\n` +
        `\\begin{tabular}{@{}lr@{}}\n\\toprule\n项目 & 数值 \\\\\n\\midrule\n` +
        `${escapeLatex(section.body)} & 42 \\\\\n\\bottomrule\n\\end{tabular}}\n` +
        `\\end{center}\n`
      );
    case 'formula':
      return `${head}\\aoNode{${section.id}}{%\n\\begin{equation}\nE = mc^2\n\\end{equation}\n}\n`;
    default:
      return `${head}\\aoNode{${section.id}}{${escapeLatex(section.body)}}\n`;
  }
}

/** Preamble tuned to a top-conference look, adapted for Chinese via ctex. */
const LATEX_PREAMBLE = [
  '\\documentclass[UTF8,a4paper,11pt]{ctexart}',
  '\\usepackage[a4paper,left=2.05cm,right=2.05cm,top=2.4cm,bottom=2.6cm]{geometry}',
  '\\usepackage{booktabs}',
  '\\usepackage{array}',
  '\\usepackage{amsmath,amssymb}',
  '\\usepackage{xcolor}',
  '\\usepackage{caption}',
  '\\usepackage{parskip}',
  '\\definecolor{aoink}{HTML}{16203A}',
  '\\definecolor{aoaccent}{HTML}{2F61E6}',
  '\\captionsetup{font=small,labelfont={bf,color=aoink},labelsep=period,skip=6pt}',
  // Numbered, bold section headings (ctexset avoids the titlesec/ctex conflict).
  // Colour lives in section/format (typeset-time) — NOT in section/number, which
  // \thesection captures into the .aux via \aoNode's \label and would break the
  // second xelatex pass with an "undefined color" on re-read.
  '\\ctexset{section/format={\\color{aoink}\\normalfont\\large\\bfseries},section/number={\\arabic{section}},section/beforeskip={1.5em},section/afterskip={0.5em}}',
  // Keep the label-based SyncTeX mapping contract for box-select.
  '\\newcommand{\\aoNode}[2]{\\label{ao:#1}#2}',
  // NeurIPS-style title block: bold title centered between a thick and a thin rule.
  '\\newcommand{\\aotitle}[2]{%',
  '  \\begin{center}',
  '    {\\color{aoink}\\rule{\\textwidth}{2.2pt}}\\\\[0.55em]',
  '    {\\LARGE\\bfseries\\color{aoink} #1\\par}\\vspace{0.5em}',
  '    {\\color{aoink}\\rule{\\textwidth}{0.7pt}}\\\\[0.7em]',
  '    {\\normalsize\\color{aoink!72} #2}',
  '  \\end{center}',
  '  \\vspace{1.3em}',
  '}',
].join('\n');

export function renderLatexDocument(spec: PdfDocSpec): string {
  const body = spec.sections.map(renderSection).join('\n');
  const meta = spec.author
    ? escapeLatex(spec.author)
    : 'AutoOffice 文档引擎 \\,\\textbullet\\, \\today';
  return [
    LATEX_PREAMBLE,
    '\\pagestyle{plain}',
    '\\begin{document}',
    `\\aotitle{${escapeLatex(spec.title)}}{${meta}}`,
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
