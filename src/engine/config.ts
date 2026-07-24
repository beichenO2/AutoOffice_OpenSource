import { homedir } from 'node:os';
import { join } from 'node:path';
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
