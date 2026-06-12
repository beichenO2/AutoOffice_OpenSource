import { spawn, spawnSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { PptxDeckPayload } from './types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function projectRoot(): string {
  return join(__dirname, '..', '..');
}

function scriptPath(): string {
  return join(projectRoot(), 'tools', 'pptgen', 'build_pptx.py');
}

const DEFAULT_TIMEOUT_MS = 60_000;
const PYTHON_CANDIDATES = ['/opt/homebrew/bin/python3', 'python3'];

function canRunPython(candidate: string, args: string[]): boolean {
  try {
    const { status } = spawnSync(candidate, args, { stdio: 'pipe' });
    return status === 0;
  } catch {
    return false;
  }
}

export function findPythonForPptx(): string {
  for (const candidate of PYTHON_CANDIDATES) {
    if (canRunPython(candidate, ['-c', 'import pptx'])) {
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
        reject(new Error(`python-pptx timed out after ${timeoutMs}ms`));
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
    child.stdin.write(stdin, 'utf-8');
    child.stdin.end();
  });
}

/**
 * 调用 Python python-pptx 生成 .pptx 二进制。
 */
export async function renderPptxWithPython(payload: PptxDeckPayload): Promise<Buffer> {
  const outPath = join(tmpdir(), `autooffice-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`);
  const py = scriptPath();
  const json = JSON.stringify(payload);
  const python = findPythonForPptx();
  try {
    const { code, stderr } = await runProcess(python, [py, outPath], json);
    if (code !== 0) {
      throw new Error(stderr || `python-pptx exited ${code}`);
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
