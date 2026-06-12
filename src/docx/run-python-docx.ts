import { spawn, spawnSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { DocxReportPayload } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function projectRoot(): string {
  return join(__dirname, '..', '..');
}

function scriptPath(): string {
  return join(projectRoot(), 'tools', 'docxgen', 'build_docx.py');
}

function findPython(): string {
  const candidates = ['/opt/homebrew/bin/python3', 'python3'];
  for (const p of candidates) {
    try {
      const { status } = spawnSync(p, ['-c', 'import docx'], { stdio: 'pipe' });
      if (status === 0) return p;
    } catch {
      /* try next */
    }
  }
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

const DEFAULT_TIMEOUT_MS = 60_000;

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
        reject(new Error(`python-docx timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
    child.stdin.write(stdin, 'utf-8');
    child.stdin.end();
  });
}

export async function renderDocxWithPythonDocx(payload: DocxReportPayload): Promise<Buffer> {
  const outPath = join(
    tmpdir(),
    `autooffice-docx-${Date.now()}-${Math.random().toString(36).slice(2)}.docx`,
  );
  const py = scriptPath();
  const json = JSON.stringify(payload);
  const python = findPython();
  try {
    const { code, stderr } = await runProcess(python, [py, outPath], json);
    if (code !== 0) {
      throw new Error(stderr || `python-docx exited ${code}`);
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
