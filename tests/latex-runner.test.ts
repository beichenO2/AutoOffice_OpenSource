import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderLatexSource, stageLatexSupportAssets } from '../src/latex/run-xelatex.js';
import type { LatexReportPayload } from '../src/latex/types.js';

const cleanupDirs: string[] = [];

function minimalPngBase64(): string {
  const buf = Buffer.alloc(32);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  return buf.toString('base64');
}

function latexPayload(): LatexReportPayload {
  return {
    theme: 'article',
    locale: 'en-US',
    title: 'Diagram Note',
    sections: [
      {
        heading: 'Mermaid Diagram',
        body: 'Mermaid 图如下。',
        chartPngBase64: minimalPngBase64(),
        mermaidCode: 'graph TD\n  A --> B',
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('latex runner support assets', () => {
  it('stages inline image helper assets for xelatex work dirs', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'autooffice-latex-test-'));
    cleanupDirs.push(workDir);

    const staged = await stageLatexSupportAssets(workDir);
    expect(staged).toHaveLength(1);

    const helper = await readFile(join(workDir, 'inline-images.sty'), 'utf-8');
    expect(helper).toContain('\\newcommand{\\inlineimg}');
    expect(helper).toContain('base64 -d');
  });

  it('renders tex that can load the vendored inline-images package', async () => {
    const source = await renderLatexSource(latexPayload());
    expect(source).toContain('\\IfFileExists{tools/latexgen/inline-images.sty}');
    expect(source).toContain('\\ifautoofficeinlineimages');
    expect(source).toContain('\\inlineimg{mermaid-diagram-1.png}{%');
  });

  it('rejects invalid inline PNG payloads before invoking the latex generator', async () => {
    const payload = latexPayload();
    payload.sections[0] = {
      ...payload.sections[0],
      chartPngBase64: Buffer.from('this is not a png').toString('base64'),
    };
    await expect(renderLatexSource(payload)).rejects.toThrow('无效 PNG 图表数据');
  });

  it('rejects dangerous file I/O primitives in math before invoking the latex generator', async () => {
    const payload = latexPayload();
    payload.sections[0] = {
      ...payload.sections[0],
      body: 'Safe body',
      math: '\\openout1=owned.txt\\write1{pwned}\\closeout1 x+y',
    };
    await expect(renderLatexSource(payload)).rejects.toThrow('潜在危险 LaTeX 命令');
  });
});
