import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { access, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import JSZip from 'jszip';

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, '..', 'dist', 'cli.js');
const CAPABILITY_PATH = join(import.meta.dirname, '..', 'coordination', 'capabilities', 'autooffice.report_gen.json');

async function readPublishedCapabilityVersion(): Promise<string> {
  const raw = await readFile(CAPABILITY_PATH, 'utf-8');
  const capability = JSON.parse(raw) as { version: string };
  return capability.version;
}

describe('cli — autooffice', () => {
  it('shows help', async () => {
    const { stdout } = await exec('node', [CLI, '--help']);
    expect(stdout).toContain('autooffice');
    expect(stdout).toContain('generate');
    expect(stdout).toContain('summarize');
    expect(stdout).toContain('serve');
  });

  it('summarize help exposes archive input option', async () => {
    const { stdout } = await exec('node', [CLI, 'summarize', '--help']);
    expect(stdout).toContain('--archive');
    expect(stdout).toContain('ZIP archives');
  });

  it('shows version', async () => {
    const expectedVersion = await readPublishedCapabilityVersion();
    const { stdout } = await exec('node', [CLI, '--version']);
    expect(stdout.trim()).toBe(expectedVersion);
  });

  it('tools command exposes external tool summary as JSON', async () => {
    const { stdout } = await exec('node', [CLI, 'tools', '--json']);
    const result = JSON.parse(stdout);
    expect(Array.isArray(result.tools)).toBe(true);
    expect(Array.isArray(result.formatSupport)).toBe(true);
    expect(Array.isArray(result.conversionPaths)).toBe(true);
    expect(result.formatSupport.some((item: { format: string }) => item.format === 'pptx')).toBe(true);
  });

  it('generate command creates html report', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-test-' + Date.now());
    await mkdir(dir, { recursive: true });
    const inputPath = join(dir, 'data.json');
    const outputPath = join(dir, 'report.html');

    await writeFile(inputPath, JSON.stringify({
      sections: [
        { title: 'Introduction', content: 'This is the intro.' },
        { title: 'Results', content: 'Here are the results.' },
      ],
    }));

    try {
      const { stdout } = await exec('node', [CLI, 'generate', '-f', 'html', '-i', inputPath, '-o', outputPath]);
      expect(stdout).toContain('Generated html report');
      const content = await readFile(outputPath, 'utf-8');
      expect(content).toContain('Introduction');
      expect(content).toContain('Results');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('generate accepts ppt alias and auto-converts generic data to pptx', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-ppt-alias-' + Date.now());
    await mkdir(dir, { recursive: true });
    const inputPath = join(dir, 'data.json');
    const outputPath = join(dir, 'report.pptx');

    await writeFile(inputPath, JSON.stringify({
      sections: [{ title: 'Slide 1', content: 'Auto-converted from generic data.' }],
    }));

    try {
      const { stdout } = await exec('node', [CLI, 'generate', '--format', 'ppt', '--input', inputPath, '--output', outputPath]);
      expect(stdout).toContain('Generated pptx report');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('batch rejects unsupported formats before writing misleading output files', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-batch-invalid-' + Date.now());
    const outputDir = join(dir, 'out');
    const inputPath = join(dir, 'data.json');
    await mkdir(dir, { recursive: true });
    await writeFile(inputPath, JSON.stringify({
      sections: [{ title: 'Summary', content: 'Batch payload.' }],
    }));

    try {
      await exec('node', [CLI, 'batch', '--input', inputPath, '--formats', 'pdf,invalid', '--dir', outputDir]);
      expect.unreachable('batch should reject unsupported formats');
    } catch (err: unknown) {
      const stderr = typeof err === 'object' && err !== null && 'stderr' in err
        ? String((err as { stderr?: string }).stderr ?? '')
        : '';
      expect(stderr).toContain('Unsupported format(s): invalid');
      expect(stderr).toContain('Supported: pptx, pdf, docx, latex,');
      await expect(access(join(outputDir, 'report.invalid'))).rejects.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('batch exits non-zero when any requested format fails after partial success', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-batch-partial-failure-' + Date.now());
    const outputDir = join(dir, 'out');
    const inputPath = join(dir, 'data.json');
    await mkdir(dir, { recursive: true });
    await writeFile(inputPath, JSON.stringify({
      sections: [{ title: 'Summary', content: 'Batch payload.' }],
      latex: {
        theme: 'article',
        locale: 'zh-CN',
        title: '',
        sections: [{ heading: 'Broken Latex', body: 'This payload should fail validation.' }],
      },
    }));

    try {
      await exec('node', [CLI, 'batch', '--input', inputPath, '--formats', 'html,latex', '--dir', outputDir]);
      expect.unreachable('batch should exit non-zero on partial failure');
    } catch (err: unknown) {
      const stdout = typeof err === 'object' && err !== null && 'stdout' in err
        ? String((err as { stdout?: string }).stdout ?? '')
        : '';
      const stderr = typeof err === 'object' && err !== null && 'stderr' in err
        ? String((err as { stderr?: string }).stderr ?? '')
        : '';
      const code = typeof err === 'object' && err !== null && 'code' in err
        ? Number((err as { code?: number }).code)
        : NaN;
      expect(code).toBe(1);
      expect(stdout).toContain('Generating 2 formats: html, latex');
      expect(stdout).toContain(join(outputDir, 'report.html'));
      expect(stderr).toContain('latex: ERROR — 标题不能为空。');
      const html = await readFile(join(outputDir, 'report.html'), 'utf-8');
      expect(html).toContain('Summary');
      await expect(access(join(outputDir, 'report.latex'))).rejects.toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarize command processes text', async () => {
    const { stdout } = await exec('node', [CLI, 'summarize', '-t', '# Test Title\n\n## Section A\n\nSome content here.\n\n## Section B\n\n- Point 1\n- Point 2']);
    const result = JSON.parse(stdout);
    expect(result.route).toBe('llmwiki');
    expect(result.totalWords).toBeGreaterThan(0);
    expect(result.mermaid).toContain('graph TD');
    expect(result.handoff.target).toBe('llmwiki');
    expect(result.handoff.capability).toBe('llmwiki.wiki_generator');
  });

  it('summarize --mermaid-only outputs diagram code', async () => {
    const { stdout } = await exec('node', [CLI, 'summarize', '-t', '# Topic\n\n## Part A\n\nContent', '--mermaid-only']);
    expect(stdout.trim()).toMatch(/^graph TD/);
  });

  it('summarize command parses zip inputs as archive content', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-zip-' + Date.now());
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, 'notes.zip');
    const zip = new JSZip();
    zip.file('summary.md', '# Zip Title\n\n## Section A\n\nBundled content.');
    await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

    try {
      const { stdout } = await exec('node', [CLI, 'summarize', '--archive', zipPath]);
      const result = JSON.parse(stdout);
      expect(result.sources).toBe(1);
      expect(result.mermaid).toContain('Zip Title');
      expect(result.concepts).toContain('Zip Title');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('summarize command creates parent directories for --output', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-summary-out-' + Date.now());
    const outputPath = join(dir, 'nested', 'summary.json');

    try {
      const { stdout } = await exec('node', [
        CLI,
        'summarize',
        '--text',
        '# Output Title\n\n## Section\n\nPersist me.',
        '--output',
        outputPath,
      ]);
      expect(stdout).toContain(`Summary written to ${outputPath}`);
      const written = JSON.parse(await readFile(outputPath, 'utf-8')) as { route: string; totalWords: number };
      expect(written.route).toBe('llmwiki');
      expect(written.totalWords).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('enrich command preserves crafted headings without Python syntax failures', async () => {
    const markdown = ['# bad\\', '', 'Body content.'].join('\n');
    const { stdout } = await exec('node', [CLI, 'enrich', '--text', markdown, '--max-queries', '1', '--top-k', '1']);
    expect(stdout).toContain('Querying KnowLeverage RAG engine...');
    expect(stdout).toContain('"bad\\":');
    expect(stdout).not.toMatch(/SyntaxError|EOL while scanning string literal/);
  }, 20000);

  it('quality command creates parent directories for --output', async () => {
    const dir = join(tmpdir(), 'autooffice-cli-quality-out-' + Date.now());
    const outputPath = join(dir, 'nested', 'quality.json');

    try {
      const { stdout } = await exec('node', [
        CLI,
        'quality',
        '--text',
        'A concise report paragraph with varied phrasing.',
        '--output',
        outputPath,
      ]);
      expect(stdout).toContain(`Quality report written to ${outputPath}`);
      const written = JSON.parse(await readFile(outputPath, 'utf-8')) as { grade: string; score: number };
      expect(typeof written.grade).toBe('string');
      expect(typeof written.score).toBe('number');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
