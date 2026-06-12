import { afterEach, describe, expect, it } from 'vitest';
import {
  API_WIKI_ROOT_ENV,
  getApiWikiRoot,
  resolveApiWikiOutputDir,
  resolveCliWikiOutputDir,
} from '../src/wiki-output.js';

afterEach(() => {
  delete process.env[API_WIKI_ROOT_ENV];
});

describe('wiki-output', () => {
  describe('getApiWikiRoot', () => {
    it('returns default when env not set', () => {
      delete process.env[API_WIKI_ROOT_ENV];
      const root = getApiWikiRoot();
      expect(root).toContain('.autooffice');
      expect(root).toContain('wiki-projects');
    });

    it('uses env variable when set', () => {
      process.env[API_WIKI_ROOT_ENV] = '/tmp/custom-wiki';
      expect(getApiWikiRoot()).toBe('/tmp/custom-wiki');
    });

    it('ignores whitespace-only env value', () => {
      process.env[API_WIKI_ROOT_ENV] = '   ';
      const root = getApiWikiRoot();
      expect(root).toContain('wiki-projects');
    });
  });

  describe('resolveApiWikiOutputDir', () => {
    it('resolves a simple relative path', () => {
      process.env[API_WIKI_ROOT_ENV] = '/tmp/wiki-root';
      const result = resolveApiWikiOutputDir('team-a/project-1');
      expect(result).toBe('/tmp/wiki-root/team-a/project-1');
    });

    it('rejects empty outputDir', () => {
      expect(() => resolveApiWikiOutputDir('')).toThrow('non-empty relative path');
    });

    it('rejects dot path', () => {
      expect(() => resolveApiWikiOutputDir('.')).toThrow('project directory');
    });

    it('rejects double-dot path', () => {
      expect(() => resolveApiWikiOutputDir('..')).toThrow('project directory');
    });

    it('rejects absolute path', () => {
      expect(() => resolveApiWikiOutputDir('/etc/passwd')).toThrow('relative path');
    });

    it('rejects path traversal', () => {
      process.env[API_WIKI_ROOT_ENV] = '/tmp/wiki-root';
      expect(() => resolveApiWikiOutputDir('../escape')).toThrow('within the API wiki root');
    });
  });

  describe('resolveCliWikiOutputDir', () => {
    it('resolves relative path to absolute', () => {
      const result = resolveCliWikiOutputDir('output/wiki');
      expect(result).toContain('output/wiki');
      expect(result.startsWith('/')).toBe(true);
    });
  });
});
