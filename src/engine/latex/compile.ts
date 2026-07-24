/**
 * Sandboxed xelatex compile adapter. Shell escape disabled by default.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface CompileResult {
  ok: boolean;
  pdf?: Buffer;
  log: string;
  workDir: string;
  error?: string;
}

export interface CompileOptions {
  timeoutMs?: number;
  allowShellEscape?: boolean;
  maxPdfBytes?: number;
}

const DEFAULT_TIMEOUT = 45_000;
const DEFAULT_MAX_PDF = 20 * 1024 * 1024;

function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) {
        reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

export async function compileLatexSandbox(
  texSource: string,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const maxPdfBytes = opts.maxPdfBytes ?? DEFAULT_MAX_PDF;
  const workDir = await mkdtemp(join(tmpdir(), 'aoide-latex-'));
  const texPath = join(workDir, 'main.tex');
  await writeFile(texPath, texSource, 'utf-8');

  const args = [
    '-interaction=nonstopmode',
    '-halt-on-error',
    '-file-line-error',
    '-synctex=-1',
    '-output-directory',
    workDir,
  ];
  if (!opts.allowShellEscape) {
    args.push('-no-shell-escape');
  } else {
    args.push('-shell-escape');
  }
  args.push('main.tex');

  let log = '';
  try {
    for (let pass = 0; pass < 2; pass++) {
      const { code, stdout, stderr } = await run('xelatex', args, workDir, timeoutMs);
      log += `\n--- pass ${pass + 1} ---\n${stdout}\n${stderr}`;
      if (code !== 0 && pass === 0) {
        return { ok: false, log, workDir, error: summarizeLatexError(log) };
      }
    }
    const pdfPath = join(workDir, 'main.pdf');
    const pdf = await readFile(pdfPath);
    if (pdf.length > maxPdfBytes) {
      return { ok: false, log, workDir, error: `PDF exceeds size limit (${pdf.length} bytes)` };
    }
    return { ok: true, pdf, log, workDir };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, log: log + message, workDir, error: message };
  }
}

export async function cleanupCompileDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

/** Block reads outside workDir via \\input{../}. */
export function containsPathEscape(tex: string): boolean {
  return /\\(?:input|include)\s*\{[^}]*\.\./.test(tex);
}

function summarizeLatexError(log: string): string {
  const line = log.split('\n').find((l) => l.startsWith('! ') || l.includes('Error'));
  return line?.slice(0, 400) ?? 'LaTeX compilation failed';
}

export async function listWorkDirFiles(workDir: string): Promise<string[]> {
  return readdir(workDir);
}
