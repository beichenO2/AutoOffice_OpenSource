import { describe, it, expect } from 'vitest';
import { containsPathEscape } from '../../src/engine/latex/compile.js';
import { findPathTraversalInLatex } from '../../src/engine/pdf/compile-sandbox.js';

describe('engine security — LaTeX sandbox guards', () => {
  it('containsPathEscape blocks parent-directory \\input', () => {
    expect(containsPathEscape('\\input{../etc/passwd}')).toBe(true);
    expect(containsPathEscape('\\include{../../secret.tex}')).toBe(true);
    expect(containsPathEscape('\\input{figures/chart.tex}')).toBe(false);
  });

  it('findPathTraversalInLatex flags absolute and parent paths', () => {
    expect(findPathTraversalInLatex('\\input{/etc/passwd}')).toEqual(['/etc/passwd']);
    expect(findPathTraversalInLatex('\\include{..\\windows\\system32}')).toEqual(['..\\windows\\system32']);
    expect(findPathTraversalInLatex('\\input{C:\\Users\\secret.tex}')).toEqual(['C:\\Users\\secret.tex']);
    expect(findPathTraversalInLatex('\\input{chapters/intro.tex}')).toEqual([]);
  });

  it('compileLatexSandbox produces PDF with default sandbox options when xelatex is available', async () => {
    const { spawnSync } = await import('node:child_process');
    const hasXelatex = spawnSync('xelatex', ['--version'], { stdio: 'pipe' }).status === 0;
    if (!hasXelatex) return;

    const minimal = [
      '\\documentclass{article}',
      '\\begin{document}',
      'Hello security test.',
      '\\end{document}',
    ].join('\n');

    const { compileLatexSandbox, cleanupCompileDir } = await import('../../src/engine/latex/compile.js');
    const result = await compileLatexSandbox(minimal);
    expect(result.ok).toBe(true);
    expect(result.pdf?.subarray(0, 4).toString()).toBe('%PDF');
    await cleanupCompileDir(result.workDir);
  });
});
