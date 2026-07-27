import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export function projectRoot(): string {
  return join(__dirname, '..', '..');
}

/** Persistent engine store root (projects, revisions, events). */
export function engineStoreRoot(): string {
  const fromEnv = process.env.AUTOOFFICE_ENGINE_HOME?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), '.autooffice', 'engine');
}

export type PptSourceOfTruth = 'slidev' | 'html';

/** Which engine owns presentation source: Slidev (default when installed) or legacy HTML. */
export function pptSourceOfTruth(): PptSourceOfTruth {
  const fromEnv = process.env.AUTOOFFICE_PPT_SOT?.trim().toLowerCase();
  if (fromEnv === 'html' || fromEnv === 'slidev') return fromEnv;
  return hasSlidevInstalled() ? 'slidev' : 'html';
}

let slidevInstalledCache: boolean | undefined;

/** Lazy check — @slidev/cli resolvable from node_modules. */
export function hasSlidevInstalled(): boolean {
  if (slidevInstalledCache !== undefined) return slidevInstalledCache;
  try {
    const require = createRequire(import.meta.url);
    require.resolve('@slidev/cli/package.json');
    slidevInstalledCache = true;
  } catch {
    slidevInstalledCache = false;
  }
  return slidevInstalledCache;
}
