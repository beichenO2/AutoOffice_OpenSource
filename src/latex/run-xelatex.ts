import { spawn, spawnSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { LatexReportPayload } from './types.js';
import { assertValidLatexPayload } from './validate.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function projectRoot(): string {
  return join(__dirname, '..', '..');
}

function scriptPath(): string {
  return join(projectRoot(), 'tools', 'latexgen', 'build_latex.py');
}

function supportAssetPath(name: string): string {
  return join(projectRoot(), 'tools', 'latexgen', name);
}

function findPython(): string {
  const candidates = ['/opt/homebrew/bin/python3', 'python3'];
  for (const p of candidates) {
    try {
      const { status } = spawnSync(p, ['--version'], { stdio: 'pipe' });
      if (status === 0) return p;
    } catch {
      /* try next */
    }
  }
  return 'python3';
}

function needsShellEscape(payload: LatexReportPayload): boolean {
  return payload.sections.some((section) => Boolean(section.chartPngBase64?.trim()));
}

const LATEX_SUPPORT_ASSETS = ['inline-images.sty'] as const;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function stageLatexSupportAssets(workDir: string): Promise<string[]> {
  const staged: string[] = [];
  for (const name of LATEX_SUPPORT_ASSETS) {
    const source = supportAssetPath(name);
    const destination = join(workDir, name);
    await copyFile(source, destination);
    staged.push(destination);
  }
  return staged;
}

function runProcess(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf-8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf-8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.write(stdin, 'utf-8');
    child.stdin.end();
  });
}

/**
 * 通过 Python Jinja2 生成 .tex 源文件，返回 LaTeX 源码字符串。
 * 如果系统安装了 xelatex，可进一步编译为 PDF。
 * math 字段会原样写入模板，因此在进入生成器前再次执行安全校验。
 */
export async function renderLatexSource(payload: LatexReportPayload): Promise<string> {
  assertValidLatexPayload(payload);
  const py = scriptPath();
  const json = JSON.stringify(payload);
  const python = findPython();
  const { code, stdout, stderr } = await runProcess(python, [py], json);
  if (code !== 0) {
    throw new Error(stderr || `latex generator exited ${code}`);
  }
  return stdout;
}

/**
 * 生成 .tex 并用 xelatex 编译为 PDF（如果可用）。
 * 如果 xelatex 不可用，返回 .tex 源码的 Buffer。
 */
export async function renderLatexToPdf(payload: LatexReportPayload): Promise<Buffer> {
  const texSource = await renderLatexSource(payload);

  const hasXelatex = (() => {
    try {
      const { status } = spawnSync('xelatex', ['--version'], { stdio: 'pipe' });
      return status === 0;
    } catch {
      return false;
    }
  })();

  if (!hasXelatex) {
    return Buffer.from(texSource, 'utf-8');
  }

  const workDir = await mkdtemp(join(tmpdir(), 'autooffice-latex-'));
  const texPath = join(workDir, 'output.tex');
  const pdfPath = join(workDir, 'output.pdf');

  await writeFile(texPath, texSource, 'utf-8');
  if (needsShellEscape(payload)) {
    await stageLatexSupportAssets(workDir);
  }
  const args = ['-interaction=nonstopmode'];
  if (needsShellEscape(payload)) {
    args.push('-shell-escape');
  }
  args.push('-output-directory', workDir, texPath);
  try {
    const { code, stderr } = await runProcess(
      'xelatex',
      args,
      '',
    );
    if (code !== 0) {
      throw new Error(`xelatex compilation failed: ${stderr.slice(0, 500)}`);
    }
    return await readFile(pdfPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
