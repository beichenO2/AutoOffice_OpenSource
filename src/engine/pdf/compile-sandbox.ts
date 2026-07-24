/**
 * Sandboxed LaTeX → PDF compile with SyncTeX, timeouts, and no shell-escape by default.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { dirname, join, resolve, normalize } from 'node:path';
import { tmpdir } from 'node:os';

export interface CompileOptions {
  /** Working directory must stay inside allowedRoot when set. */
  allowedRoot?: string;
  timeoutMs?: number;
  /** Default false — shell-escape is a security surface. */
  shellEscape?: boolean;
  synctex?: boolean;
}

export interface CompileResult {
  ok: boolean;
  pdf?: Buffer;
  log: string;
  workDir: string;
  texPath: string;
  pdfPath?: string;
  synctexPath?: string;
}

export class CompileSandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompileSandboxError';
  }
}

function assertInsideRoot(target: string, root: string): void {
  const abs = normalize(resolve(target));
  const base = normalize(resolve(root));
  if (!abs.startsWith(base + join('', '')) && abs !== base && !abs.startsWith(base + '/')) {
    throw new CompileSandboxError(`Path escapes sandbox: ${target}`);
  }
}

export async function compileLatexToPdf(
  sourceFiles: Array<{ path: string; content: string }>,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const workDir = await mkdtemp(join(tmpdir(), 'aoide-latex-'));
  if (opts.allowedRoot) assertInsideRoot(workDir, opts.allowedRoot);

  try {
    for (const f of sourceFiles) {
      if (f.path.includes('..') || f.path.startsWith('/')) {
        throw new CompileSandboxError(`Unsafe source path: ${f.path}`);
      }
      const dest = join(workDir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content, 'utf-8');
    }

    const main = sourceFiles.find((f) => f.path.endsWith('.tex'))?.path ?? 'main.tex';
    const texPath = join(workDir, main);
    const pdfPath = join(workDir, main.replace(/\.tex$/, '.pdf'));

    const hasXelatex = spawnSync('xelatex', ['--version'], { stdio: 'pipe' }).status === 0;
    if (!hasXelatex) {
      return { ok: false, log: 'xelatex not available', workDir, texPath };
    }

    const args = [
      '-interaction=nonstopmode',
      '-halt-on-error',
      ...(opts.synctex !== false ? ['-synctex=1'] : []),
      ...(opts.shellEscape ? ['-shell-escape'] : []),
      '-output-directory',
      workDir,
      texPath,
    ];

    let log = '';
    for (let pass = 0; pass < 2; pass++) {
      const { code, stderr, stdout } = await run('xelatex', args, timeoutMs);
      log += stdout + stderr;
      if (code !== 0) {
        return { ok: false, log, workDir, texPath, pdfPath: undefined };
      }
    }

    const pdf = await readFile(pdfPath);
    const synctexPath = join(workDir, main.replace(/\.tex$/, '.synctex.gz'));
    return {
      ok: true,
      pdf,
      log,
      workDir,
      texPath,
      pdfPath,
      synctexPath,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, log: message, workDir, texPath: join(workDir, 'main.tex') };
  }
}

export async function cleanupWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) reject(new CompileSandboxError(`${cmd} timed out after ${timeoutMs}ms`));
      else resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Detect `\input{` / `\include{` attempts to read outside the project. */
export function findPathTraversalInLatex(tex: string): string[] {
  const hits: string[] = [];
  const re = /\\(?:input|include)\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tex))) {
    const p = m[1]!;
    if (p.includes('..') || p.startsWith('/') || /^[A-Za-z]:/.test(p)) hits.push(p);
  }
  return hits;
}
