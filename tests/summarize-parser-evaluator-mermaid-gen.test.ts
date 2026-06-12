import { describe, it, expect } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import JSZip from 'jszip';
import { parseInput } from '../src/summarize/parser.js';
import { evaluate, LLMWIKI_THRESHOLD } from '../src/summarize/evaluator.js';
import { generateMermaid } from '../src/summarize/mermaid-gen.js';
import type { ParsedContent } from '../src/summarize/types.js';

function makeParsed(wordCount: number, markdown: string, lang: 'zh' | 'en' | 'mixed' = 'en'): ParsedContent {
  return {
    source: { kind: 'text', value: markdown },
    markdown,
    byteLength: Buffer.byteLength(markdown, 'utf-8'),
    wordCount,
    paragraphCount: Math.max(1, markdown.split(/\n{2,}/).filter((part) => part.trim().length > 0).length),
    lang,
  };
}

describe('summarize parser/evaluator/mermaid focused coverage', () => {
  it('parser skips macOS archive metadata and reports binary entries', async () => {
    const dir = join(tmpdir(), 'autooffice-summarize-quality-' + Date.now());
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, 'bundle.zip');
    const zip = new JSZip();
    zip.file('__MACOSX/ignored.txt', 'ignore me');
    zip.file('.DS_Store', 'ignore me too');
    zip.file('docs/notes.md', '# Kept note\n\nArchive body');
    zip.file('binary/image.bin', Buffer.from([0, 1, 2, 3, 4]));

    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const result = await parseInput({ kind: 'archive', value: zipPath });
      expect(result.markdown).toContain('# Archive: bundle.zip');
      expect(result.markdown).toContain('Kept note');
      expect(result.markdown).toContain('binary/image.bin (binary)');
      expect(result.markdown).not.toContain('__MACOSX');
      expect(result.markdown).not.toContain('.DS_Store');
      expect(result.markdown).not.toContain('ignore me');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('parser preserves quoted csv cells when csv files are unpacked from archives', async () => {
    const dir = join(tmpdir(), 'autooffice-summarize-csv-archive-' + Date.now());
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, 'quoted-csv.zip');
    const zip = new JSZip();
    zip.file(
      'tables/people.csv',
      [
        'Name,Notes,Quote',
        '"Alice, A.","Line 1',
        'Line 2","She said ""hello"""',
      ].join('\n'),
    );

    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const result = await parseInput({ kind: 'archive', value: zipPath });
      expect(result.markdown).toContain('| Name | Notes | Quote |');
      expect(result.markdown).toContain('| Alice, A. | Line 1<br>Line 2 | She said "hello" |');
      expect(result.markdown).not.toContain('| Alice |  A. |');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('evaluator keeps llmwiki at the threshold and switches above it', () => {
    const atThreshold = evaluate([makeParsed(LLMWIKI_THRESHOLD, '# Topic\n\nBody text')]);
    const aboveThreshold = evaluate([makeParsed(LLMWIKI_THRESHOLD + 1, '# Topic\n\nBody text')]);

    expect(atThreshold.route).toBe('llmwiki');
    expect(aboveThreshold.route).toBe('knowleverage');
    expect(aboveThreshold.reason).toContain(String(LLMWIKI_THRESHOLD + 1));
  });

  it('mermaid generator deduplicates repeated concepts and sanitizes labels', () => {
    const repeatedHeading = 'Repeated Section';
    const contents: ParsedContent[] = [
      makeParsed(
        120,
        '# Very long label with --> brackets [x] & punctuation %%%% 1234567890\n\n'
          + `## ${repeatedHeading}\n\n`
          + '**Shared Concept**\n\n'
          + '- Shared list item\n'
          + '- Another list item',
        'en',
      ),
      makeParsed(
        110,
        '# Very long label with --> brackets [x] & punctuation %%%% 1234567890\n\n'
          + `## ${repeatedHeading}\n\n`
          + '**Shared Concept**\n\n'
          + '- Shared list item\n'
          + '- Extra list item',
        'en',
      ),
    ];

    const result = generateMermaid(contents);
    const labels = [...result.code.matchAll(/\["([^"]+)"\]/g)].map((match) => match[1] ?? '');

    expect(result.concepts.filter((concept) => concept === repeatedHeading)).toHaveLength(1);
    expect(result.concepts.filter((concept) => concept === 'Shared Concept')).toHaveLength(1);
    expect(new Set(result.concepts).size).toBe(result.concepts.length);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.length <= 30)).toBe(true);
    expect(labels.every((label) => !label.includes('-->'))).toBe(true);
    expect(labels.every((label) => !label.includes('&'))).toBe(true);
    expect(labels.every((label) => !/[`\[\]{}|<>;%\\]/.test(label))).toBe(true);
  });
});
