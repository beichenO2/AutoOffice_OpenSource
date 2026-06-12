/**
 * LLMWiki integration.
 * Generates Wiki project scaffolds for small-topic knowledge organization.
 * Creates the file structure that LLMWiki's build system expects.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SummarizeResult } from '../summarize/types.js';

export interface WikiScaffoldResult {
  projectDir: string;
  filesCreated: string[];
  buildCommand: string;
  success: boolean;
  error?: string;
}

function generateGraphJson(result: SummarizeResult): string {
  const headings = result.combinedMarkdown.match(/^#\s+(.+)$/m);
  const rootLabel = headings?.[1]?.trim() || '知识概览';

  const tree = {
    label: rootLabel,
    children: result.mermaid.concepts.slice(0, 8).map((c) => ({ label: c })),
  };

  const glossary: Record<string, string> = {};
  const boldRe = /\*\*([^*]+)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = boldRe.exec(result.combinedMarkdown)) !== null) {
    const term = match[1]?.trim();
    if (term && term.length > 1 && term.length < 30 && !glossary[term]) {
      glossary[term] = `参见文档中关于"${term}"的详细描述`;
    }
  }

  return JSON.stringify({ tree, glossary }, null, 2);
}

function yamlDoubleQuoted(value: string): string {
  return JSON.stringify(value);
}

function generateOverviewMd(result: SummarizeResult): string {
  const headings = result.combinedMarkdown.match(/^#\s+(.+)$/m);
  const title = headings?.[1]?.trim() || '知识概览';

  let md = `---\ntitle: ${yamlDoubleQuoted(title)}\norder: 1\n---\n\n# ${title}\n\n`;
  md += result.combinedMarkdown.slice(0, 3000);
  return md;
}

function generateMermaidMd(result: SummarizeResult): string {
  return `---\ntitle: ${yamlDoubleQuoted('架构图')}\norder: 2\n---\n\n# 架构图\n\n\`\`\`mermaid\n${result.mermaid.code}\n\`\`\`\n`;
}

/**
 * Create a LLMWiki project scaffold from summarize results.
 * Generates the directory structure that LLMWiki's build.js expects.
 */
export async function createWikiScaffold(
  result: SummarizeResult,
  outputDir: string,
): Promise<WikiScaffoldResult> {
  const filesCreated: string[] = [];

  try {
    const wikiDir = join(outputDir, 'wiki');
    const assetsDir = join(outputDir, 'output', 'assets', 'data');
    await mkdir(wikiDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });

    const overviewPath = join(wikiDir, 'overview.md');
    await writeFile(overviewPath, generateOverviewMd(result));
    filesCreated.push(overviewPath);

    for (let i = 0; i < result.parsed.length; i++) {
      const sourcePath = join(wikiDir, `source-${i + 1}.md`);
      const parsed = result.parsed[i];
      if (!parsed) continue;
      const content = `---\ntitle: ${yamlDoubleQuoted(`来源 ${i + 1}`)}\norder: ${i + 3}\n---\n\n${parsed.markdown}`;
      await writeFile(sourcePath, content);
      filesCreated.push(sourcePath);
    }

    const mermaidPath = join(wikiDir, 'architecture.md');
    await writeFile(mermaidPath, generateMermaidMd(result));
    filesCreated.push(mermaidPath);

    const graphPath = join(assetsDir, 'graph.json');
    await writeFile(graphPath, generateGraphJson(result));
    filesCreated.push(graphPath);

    return {
      projectDir: outputDir,
      filesCreated,
      buildCommand: 'node scripts/build.js',
      success: true,
    };
  } catch (err: unknown) {
    return {
      projectDir: outputDir,
      filesCreated,
      buildCommand: 'node scripts/build.js',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
