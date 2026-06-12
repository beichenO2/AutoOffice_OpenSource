import { spawn, spawnSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { PdfReportPayload } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function projectRoot(): string {
  return join(__dirname, '..', '..');
}

function scriptPath(): string {
  return join(projectRoot(), 'tools', 'pdfgen', 'build_pdf.py');
}

const PYTHON_CANDIDATES = ['/opt/homebrew/bin/python3', 'python3'];
const DEFAULT_TIMEOUT_MS = 60_000;

function canRunPython(candidate: string, args: string[]): boolean {
  try {
    const { status } = spawnSync(candidate, args, { stdio: 'pipe' });
    return status === 0;
  } catch {
    return false;
  }
}

function findPython(): string {
  // Prefer an interpreter that can actually import WeasyPrint.
  for (const candidate of PYTHON_CANDIDATES) {
    if (canRunPython(candidate, ['-c', 'import weasyprint'])) {
      return candidate;
    }
  }

  for (const candidate of PYTHON_CANDIDATES) {
    if (canRunPython(candidate, ['--version'])) {
      return candidate;
    }
  }

  return 'python3';
}

function runProcess(
  cmd: string,
  args: string[],
  stdin: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeoutMs);

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
        reject(new Error(`weasyprint timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
    child.stdin.write(stdin, 'utf-8');
    child.stdin.end();
  });
}

/**
 * 调用 Python WeasyPrint 生成 .pdf 二进制。
 */
export async function renderPdfWithWeasyPrint(payload: PdfReportPayload): Promise<Buffer> {
  const outPath = join(
    tmpdir(),
    `autooffice-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`,
  );
  const py = scriptPath();
  const json = JSON.stringify(payload);
  const python = findPython();
  try {
    const { code, stderr } = await runProcess(python, [py, outPath], json);
    if (code !== 0) {
      throw new Error(stderr || `weasyprint exited ${code}`);
    }
    return await readFile(outPath);
  } finally {
    try {
      await unlink(outPath);
    } catch {
      /* ignore */
    }
  }
}
