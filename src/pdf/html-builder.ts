import type { PdfReportPayload, PdfSectionInput } from './types.js';

const THEMES: Record<string, Record<string, string>> = {
  academic: {
    primary: '#1A365D', secondary: '#2C5A8F', text: '#2D3741', muted: '#64748B',
    bg: '#FFFFFF', cover_bg: '#F8FAFC', accent_border: '#2C5A8F',
    heading_font: "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
    body_font: "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', sans-serif",
    mono_font: "'JetBrains Mono', 'Fira Code', monospace",
  },
  business: {
    primary: '#0F172A', secondary: '#30588C', text: '#1E293B', muted: '#64748B',
    bg: '#FFFFFF', cover_bg: '#F1F5F9', accent_border: '#30588C',
    heading_font: "'Helvetica Neue', 'PingFang SC', sans-serif",
    body_font: "'PingFang SC', 'Noto Sans SC', sans-serif",
    mono_font: "'SF Mono', 'Menlo', monospace",
  },
  minimal: {
    primary: '#18181B', secondary: '#3F3F46', text: '#27272A', muted: '#71717A',
    bg: '#FFFFFF', cover_bg: '#FAFAFA', accent_border: '#D4D4D8',
    heading_font: "'Inter', 'PingFang SC', sans-serif",
    body_font: "'Inter', 'PingFang SC', sans-serif",
    mono_font: "'JetBrains Mono', monospace",
  },
  elegant: {
    primary: '#44403C', secondary: '#78716C', text: '#292524', muted: '#A8A29E',
    bg: '#FFFBF5', cover_bg: '#FEF7ED', accent_border: '#C4956A',
    heading_font: "'Noto Serif SC', 'Songti SC', serif",
    body_font: "'Noto Sans SC', 'PingFang SC', sans-serif",
    mono_font: "'Fira Code', monospace",
  },
  'technical-report': {
    primary: '#0B1F3A', secondary: '#155E9F', text: '#172033', muted: '#64748B',
    bg: '#FFFFFF', cover_bg: '#F4F8FC', accent_border: '#155E9F',
    heading_font: "'Noto Serif SC', 'Songti SC', 'Times New Roman', serif",
    body_font: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono_font: "'SF Mono', 'Menlo', 'PingFang SC', monospace",
  },
  'news-digest': {
    primary: '#111827', secondary: '#B45309', text: '#1F2937', muted: '#6B7280',
    bg: '#FFFFFF', cover_bg: '#FFF7ED', accent_border: '#F59E0B',
    heading_font: "'Noto Serif SC', 'Songti SC', Georgia, serif",
    body_font: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono_font: "'SF Mono', 'Menlo', monospace",
  },
  'study-notes': {
    primary: '#1E3A8A', secondary: '#2563EB', text: '#1E293B', muted: '#64748B',
    bg: '#FFFFFF', cover_bg: '#EFF6FF', accent_border: '#60A5FA',
    heading_font: "'Noto Sans SC', 'PingFang SC', sans-serif",
    body_font: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono_font: "'SF Mono', 'Menlo', 'PingFang SC', monospace",
  },
  'study-review': {
    primary: '#065F46', secondary: '#047857', text: '#1E293B', muted: '#6B7280',
    bg: '#FFFFFF', cover_bg: '#ECFDF5', accent_border: '#34D399',
    heading_font: "'Noto Serif SC', 'Songti SC', 'Times New Roman', serif",
    body_font: "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    mono_font: "'SF Mono', 'Menlo', 'PingFang SC', monospace",
  },
};

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderMarkdownTable(block: string): string | null {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || !lines[0]?.includes('|') || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1] ?? '')) {
    return null;
  }
  const parseRow = (line: string) => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => esc(cell.trim()));
  const head = parseRow(lines[0]!);
  const rows = lines.slice(2).map(parseRow);
  return `<table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function renderList(block: string): string | null {
  const lines = block.split('\n').filter((line) => line.trim());
  const unordered = lines.every((line) => /^\s*[-*]\s+/.test(line));
  const ordered = lines.every((line) => /^\s*\d+\.\s+/.test(line));
  if (!unordered && !ordered) return null;
  const tag = ordered ? 'ol' : 'ul';
  const items = lines.map((line) => `<li>${esc(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ''))}</li>`);
  return `<${tag}>${items.join('')}</${tag}>`;
}

function renderMarkdownBlock(block: string): string {
  const trimmed = block.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('```')) {
    let code = trimmed.split('\n').slice(1).join('\n');
    if (code.endsWith('```')) code = code.slice(0, -3);
    return `<pre><code>${esc(code.trim())}</code></pre>`;
  }
  const table = renderMarkdownTable(trimmed);
  if (table) return table;
  const list = renderList(trimmed);
  if (list) return list;
  if (/^#{3}\s+/.test(trimmed)) return `<h4>${esc(trimmed.replace(/^#{3}\s+/, ''))}</h4>`;
  if (/^>\s+/.test(trimmed)) {
    return `<blockquote>${trimmed.split('\n').map((line) => esc(line.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`;
  }
  return `<p>${esc(trimmed)}</p>`;
}

function sectionsHtml(sections: PdfSectionInput[]): string {
  return sections.map((sec, i) => {
    const level = Math.min(Math.max(sec.level ?? 1, 1), 3) + 1;
    const tag = `h${level}`;
    const heading = esc(sec.heading);
    const parts: string[] = [`<section id="sec-${i}">`];

    if (heading) parts.push(`<${tag}>${heading}</${tag}>`);

    for (const para of (sec.body ?? '').split(/\n{2,}/)) {
      const rendered = renderMarkdownBlock(para);
      if (rendered) parts.push(rendered);
    }

    if (sec.chart) {
      if (sec.chart.kind === 'svg' && sec.chart.data) {
        parts.push(`<figure class="mermaid-chart">${sec.chart.data}</figure>`);
      } else if (sec.chart.kind === 'png' && sec.chart.data) {
        parts.push(`<figure class="mermaid-chart"><img src="data:image/png;base64,${sec.chart.data}" alt="chart" /></figure>`);
      }
    }

    parts.push('<p class="back-to-toc"><a href="#toc">↥ 返回总述</a></p>');
    parts.push('</section>');
    return parts.join('\n');
  }).join('\n');
}

function tocHtml(sections: PdfSectionInput[]): string {
  const items = sections.map((sec, i) => {
    const heading = esc(sec.heading || `Section ${i + 1}`);
    const indent = ((sec.level ?? 1) - 1) * 24;
    return `<li style="margin-left:${indent}px"><a href="#sec-${i}">${heading}</a></li>`;
  });
  return `<nav id="toc" class="toc"><h2>总述 / 目录</h2><ol>${items.join('')}</ol></nav>`;
}

function buildCss(th: Record<string, string>): string {
  const f = th.body_font!;
  return `
@font-face { font-family: "AutoOfficeCJK"; src: url("file:///System/Library/Fonts/Supplemental/Arial%20Unicode.ttf") format("truetype"); font-weight: 400; font-style: normal; }
*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
@page { size: A4; margin: 28mm 24mm 30mm 24mm; }
html { font-size: 11pt; line-height: 1.72; color: ${th.text}; font-family: "AutoOfficeCJK", ${f}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { page-break-after: always; display: flex; flex-direction: column; justify-content: center; align-items: center; min-height: 100vh; background: ${th.cover_bg}; padding: 60px 48px; text-align: center; }
.cover h1 { font-family: ${th.heading_font}; font-size: 28pt; font-weight: 700; color: ${th.primary}; margin-bottom: 12px; letter-spacing: 0.02em; line-height: 1.3; }
.cover .subtitle { font-size: 14pt; color: ${th.secondary}; margin-bottom: 32px; }
.cover .meta { font-size: 10pt; color: ${th.muted}; margin-top: 8px; }
.cover .accent-line { width: 64px; height: 3px; background: ${th.accent_border}; margin: 28px auto; border-radius: 2px; }
.toc { page-break-after: always; padding: 20px 0; }
.toc h2 { font-family: ${th.heading_font}; font-size: 18pt; color: ${th.primary}; margin-bottom: 20px; padding-bottom: 6px; border-bottom: 2px solid ${th.accent_border}; }
.toc ol { list-style: none; padding: 0; }
.toc li { padding: 6px 0; border-bottom: 0.5pt dotted ${th.muted}; }
.toc a { color: ${th.text}; text-decoration: none; font-size: 11pt; }
section { margin-bottom: 18px; }
.back-to-toc { margin-top: 14px; text-align: right; font-size: 9pt; }
.back-to-toc a { display: inline-block; color: ${th.muted}; text-decoration: none; border: 1px solid #E2E8F0; border-radius: 999px; padding: 3px 9px; background: rgba(248,250,252,0.72); }
.back-to-toc a:hover { color: ${th.secondary}; border-color: ${th.accent_border}; }
h2 { font-family: ${th.heading_font}; font-size: 17pt; font-weight: 700; color: ${th.primary}; margin-top: 28px; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 1.5px solid ${th.accent_border}; page-break-after: avoid; }
h3 { font-family: ${th.heading_font}; font-size: 13pt; font-weight: 600; color: ${th.secondary}; margin-top: 20px; margin-bottom: 8px; page-break-after: avoid; }
h4 { font-family: ${th.heading_font}; font-size: 11.5pt; font-weight: 600; color: ${th.secondary}; margin-top: 14px; margin-bottom: 6px; page-break-after: avoid; }
p { margin-bottom: 10px; text-align: justify; orphans: 3; widows: 3; }
ul, ol { margin: 8px 0 12px 20px; padding-left: 6px; }
li { margin-bottom: 4px; }
pre { background: #F8F9FA; border: 1px solid #E2E8F0; border-radius: 4px; padding: 12px 16px; font-family: "AutoOfficeCJK", ${th.mono_font}; font-size: 9pt; line-height: 1.55; overflow-wrap: break-word; white-space: pre-wrap; margin: 10px 0 14px; page-break-inside: avoid; }
code { font-family: "AutoOfficeCJK", ${th.mono_font}; font-size: 9.5pt; background: #F1F5F9; padding: 1px 4px; border-radius: 3px; }
pre code { background: none; padding: 0; }
blockquote { margin: 10px 0 14px; padding: 10px 14px; border-left: 4px solid ${th.accent_border}; background: ${th.cover_bg}; color: ${th.secondary}; }
.mermaid-chart { margin: 12px 0 18px; page-break-inside: avoid; }
.mermaid-chart img, .mermaid-chart svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; page-break-inside: avoid; }
th, td { border: 1px solid #CBD5E1; padding: 6px 10px; text-align: left; }
th { background: ${th.cover_bg}; font-weight: 600; color: ${th.primary}; }`;
}

export function buildPdfHtml(payload: PdfReportPayload): string {
  const th = THEMES[payload.theme] ?? THEMES.minimal!;
  const locale = payload.locale ?? 'zh-CN';
  const title = esc(payload.title ?? '报告');
  const showToc = (payload.toc ?? true) && payload.sections.length > 1;
  const lang = locale.startsWith('zh') ? 'zh' : 'en';

  const bodyParts: string[] = [];

  bodyParts.push('<div class="cover">');
  bodyParts.push(`<h1>${title}</h1>`);
  if (payload.subtitle) bodyParts.push(`<div class="subtitle">${esc(payload.subtitle)}</div>`);
  bodyParts.push('<div class="accent-line"></div>');
  const meta = [payload.author, payload.date].filter(Boolean).map(s => esc(s!));
  if (meta.length) bodyParts.push(`<div class="meta">${meta.join(' · ')}</div>`);
  bodyParts.push('</div>');

  if (showToc) bodyParts.push(tocHtml(payload.sections));

  bodyParts.push('<main class="content">');
  bodyParts.push(sectionsHtml(payload.sections));
  bodyParts.push('</main>');

  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><title>${title}</title><style>${buildCss(th)}</style></head>
<body>${bodyParts.join('')}</body>
</html>`;
}
