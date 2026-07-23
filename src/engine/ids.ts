import { createHash, randomUUID } from 'node:crypto';

/** Factory for ids. Injectable so tests can be deterministic. */
export type IdFactory = (prefix: string) => string;

/** Default id factory: `${prefix}_<uuid-no-dashes>`. */
export const randomIdFactory: IdFactory = (prefix: string): string =>
  `${prefix}_${randomUUID().replace(/-/g, '')}`;

/**
 * Deterministic id factory for tests. Produces `${prefix}_<seed><n>` where n
 * increments per prefix, so runs are reproducible and idempotency is testable.
 */
export function createDeterministicIdFactory(seed = 't'): IdFactory {
  const counters = new Map<string, number>();
  return (prefix: string): string => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${seed}${n}`;
  };
}

/** SHA-256 hex digest of a string. */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Stable hash over a source tree (path+content), order-independent. */
export function hashSourceTree(files: Array<{ path: string; content: string }>): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const joined = sorted.map((f) => `${f.path}\u0000${f.content}`).join('\u0001');
  return sha256(joined);
}
