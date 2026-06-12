import { isAbsolute, relative, resolve } from 'node:path';

export const API_WIKI_ROOT_ENV = 'AUTOOFFICE_API_WIKI_ROOT';
export const DEFAULT_API_WIKI_ROOT = resolve(process.cwd(), '.autooffice', 'wiki-projects');

function normalizeRequestedOutputDir(outputDir: string): string {
  const trimmed = outputDir.trim();
  if (!trimmed) {
    throw new Error('outputDir must be a non-empty relative path');
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error('outputDir must point to a project directory inside the API wiki root');
  }
  if (isAbsolute(trimmed)) {
    throw new Error('outputDir must be a relative path inside the API wiki root');
  }
  return trimmed;
}

export function getApiWikiRoot(): string {
  const configured = process.env[API_WIKI_ROOT_ENV];
  return resolve(configured && configured.trim() ? configured : DEFAULT_API_WIKI_ROOT);
}

export function resolveApiWikiOutputDir(outputDir: string): string {
  const requested = normalizeRequestedOutputDir(outputDir);
  const baseDir = getApiWikiRoot();
  const candidate = resolve(baseDir, requested);
  const relativePath = relative(baseDir, candidate);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('outputDir must stay within the API wiki root');
  }
  return candidate;
}

export function resolveCliWikiOutputDir(outputDir: string): string {
  return resolve(outputDir);
}
