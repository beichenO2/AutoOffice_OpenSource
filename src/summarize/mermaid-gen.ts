import type { ParsedContent, MermaidOutput } from './types.js';

function extractHeadings(markdown: string): string[] {
  const headingRe = /^#{1,3}\s+(.+)$/gm;
  const headings: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(markdown)) !== null) {
    const captured = match[1];
    if (captured) headings.push(captured.trim());
  }
  return headings;
}

function extractBoldTerms(markdown: string): string[] {
  const boldRe = /\*\*([^*]+)\*\*/g;
  const terms: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = boldRe.exec(markdown)) !== null) {
    const captured = match[1];
    if (!captured) continue;
    const term = captured.trim();
    if (term.length > 1 && term.length < 40) {
      terms.push(term);
    }
  }
  return terms;
}

function extractListItems(markdown: string): string[] {
  const listRe = /^[-*]\s+(.+)$/gm;
  const items: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = listRe.exec(markdown)) !== null) {
    const captured = match[1];
    if (!captured) continue;
    const item = captured.trim();
    if (item.length > 2 && item.length < 60) {
      items.push(item);
    }
  }
  return items;
}

function sanitizeForMermaid(text: string): string {
  const cleaned = text
    .replace(/-->/g, ' ')
    .replace(/["\[\](){}|<>`;%\\]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
  return cleaned || 'Concept';
}

function dedup(arr: string[]): string[] {
  return [...new Set(arr)];
}

export function generateMermaid(contents: ParsedContent[]): MermaidOutput {
  const combined = contents.map((c) => c.markdown).join('\n\n');
  const headings = dedup(extractHeadings(combined));
  const boldTerms = dedup(extractBoldTerms(combined));
  const listItems = dedup(extractListItems(combined));

  const concepts = dedup([...headings.slice(0, 8), ...boldTerms.slice(0, 6), ...listItems.slice(0, 4)]).slice(0, 12);

  if (concepts.length === 0) {
    return {
      code: 'graph TD\n  A["内容"] --> B["待分析"]',
      diagramType: 'graph',
      concepts: [],
    };
  }

  const rootLabel = sanitizeForMermaid(headings[0] ?? '主题概览');
  const lines: string[] = [`graph TD`, `  ROOT["${rootLabel}"]`];

  const topLevel = concepts.slice(0, Math.min(6, concepts.length));

  for (let i = 0; i < topLevel.length; i++) {
    const nodeId = `N${i}`;
    const label = sanitizeForMermaid(topLevel[i] ?? '');
    lines.push(`  ROOT --> ${nodeId}["${label}"]`);

    const children = concepts.slice(6).filter((_, j) => j % topLevel.length === i);
    for (let j = 0; j < children.length && j < 3; j++) {
      const childId = `${nodeId}_${j}`;
      const childLabel = sanitizeForMermaid(children[j] ?? '');
      lines.push(`  ${nodeId} --> ${childId}["${childLabel}"]`);
    }
  }

  return {
    code: lines.join('\n'),
    diagramType: 'graph',
    concepts,
  };
}
