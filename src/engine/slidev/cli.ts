/**
 * Slidev CLI wrapper — spawns `slidev` via argv arrays (never shell concat).
 * Runs in isolated revision work dirs with timeout + cleanup.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import type { SourceFile } from '../types.js';
import { projectRoot } from '../config.js';
import { SLIDES_MD } from './generate.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export interface SlidevRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SlidevBuildResult {
  workDir: string;
  html: string;
  distDir: string;
}

let slidevBinCache: string | null | undefined;

/** Resolve @slidev/cli binary; null when package not installed. */
export function resolveSlidevBin(): string | null {
  if (slidevBinCache !== undefined) return slidevBinCache;
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve('@slidev/cli/package.json');
    const bin = join(dirname(pkgJson), 'bin', 'slidev.mjs');
    slidevBinCache = bin;
    return bin;
  } catch {
    slidevBinCache = null;
    return null;
  }
}

/** True when @slidev/cli is resolvable from node_modules. */
export function hasSlidevCli(): boolean {
  return resolveSlidevBin() !== null;
}

/**
 * Env for Slidev export — reuse existing Playwright Chromium when possible.
 * Set PLAYWRIGHT_BROWSERS_PATH to your Playwright cache (e.g. ~/Library/Caches/ms-playwright)
 * if export cannot find a browser. We do not re-download when browsers already exist.
 */
export function slidevPlaywrightEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!env.PLAYWRIGHT_BROWSERS_PATH) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (home) {
      env.PLAYWRIGHT_BROWSERS_PATH = join(home, 'Library', 'Caches', 'ms-playwright');
    }
  }
  env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD ?? '1';
  return env;
}

export async function runSlidev(
  args: string[],
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SlidevRunResult> {
  const bin = resolveSlidevBin();
  if (!bin) throw new Error('@slidev/cli not installed');

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      env: slidevPlaywrightEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`slidev ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

/** Write revision source into an isolated work dir for Slidev CLI. */
export async function writeSlidevWorkDir(source: SourceFile[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'aoide-slidev-'));
  for (const file of source) {
    const dest = join(dir, file.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, file.content, 'utf-8');
  }
  return dir;
}

async function readBuiltHtml(distDir: string): Promise<string> {
  const indexPath = join(distDir, 'index.html');
  try {
    await access(indexPath, constants.R_OK);
    return readFile(indexPath, 'utf-8');
  } catch {
    return '';
  }
}

/** `slidev build` in work dir; returns built HTML when available. */
export async function slidevBuild(source: SourceFile[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<SlidevBuildResult> {
  const workDir = await writeSlidevWorkDir(source);
  try {
    const result = await runSlidev(['build', SLIDES_MD, '--out', 'dist', '--base', './'], workDir, timeoutMs);
    if (result.exitCode !== 0) {
      throw new Error(`slidev build failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    const distDir = join(workDir, 'dist');
    const html = await readBuiltHtml(distDir);
    return { workDir, html, distDir };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** `slidev export` — PDF or PNG depending on args. Caller cleans workDir. */
export async function slidevExport(
  source: SourceFile[],
  extraArgs: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ workDir: string; outputPath: string }> {
  const workDir = await writeSlidevWorkDir(source);
  const outName = extraArgs.includes('--format') ? 'export-out' : 'slides-export.pdf';
  const args = ['export', SLIDES_MD, ...extraArgs, '--output', outName];
  const result = await runSlidev(args, workDir, timeoutMs);
  if (result.exitCode !== 0) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`slidev export failed (${result.exitCode}): ${result.stderr || result.stdout}`);
  }
  const formatIdx = extraArgs.indexOf('--format');
  const format = formatIdx >= 0 ? extraArgs[formatIdx + 1] : 'pdf';
  const outputPath =
    format === 'pptx'
      ? join(workDir, 'slides-export.pptx')
      : format === 'png'
        ? join(workDir, 'slides-export.png')
        : join(workDir, outName.endsWith('.pdf') ? outName : 'slides-export.pdf');
  return { workDir, outputPath };
}

/**
 * `slidev export --format pptx` — image-based PPTX (text not selectable).
 * See https://sli.dev/guide/exporting
 */
export async function slidevExportPptx(source: SourceFile[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
  const { workDir, outputPath } = await slidevExport(
    source,
    ['--format', 'pptx'],
    timeoutMs,
  );
  try {
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function cleanupSlidevWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}

/** Copy built dist into project render storage path (optional persistence). */
export async function copyDistTo(destDir: string, distDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await cp(distDir, destDir, { recursive: true, force: true });
}

/** Path hint for docs — where Slidev CLI lives when installed locally. */
export function slidevInstallHint(): string {
  return join(projectRoot(), 'node_modules', '.bin', 'slidev');
}
