import { describe, expect, it } from 'vitest';
import { listTemplates, getTemplate, getTemplateSource } from '../src/templates/gallery.js';

describe('template gallery', () => {
  it('lists all templates without source', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(6);
    for (const t of templates) {
      expect(t.source).toBe('');
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
    }
  });

  it('includes new templates', () => {
    const templates = listTemplates();
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('tech-brief');
    expect(ids).toContain('dashboard-report');
    expect(ids).toContain('minimal-letter');
  });

  it('getTemplate returns full template with source', () => {
    const tpl = getTemplate('business-report');
    expect(tpl).toBeDefined();
    expect(tpl!.source.length).toBeGreaterThan(100);
    expect(tpl!.source).toContain('<!DOCTYPE html>');
  });

  it('getTemplate returns undefined for unknown id', () => {
    expect(getTemplate('nonexistent')).toBeUndefined();
  });

  it('getTemplateSource returns source string', () => {
    const source = getTemplateSource('tech-brief');
    expect(source).toBeDefined();
    expect(source).toContain('<!DOCTYPE html>');
    expect(source).toContain('{{title}}');
  });

  it('getTemplateSource returns undefined for unknown id', () => {
    expect(getTemplateSource('nope')).toBeUndefined();
  });

  it('all templates have valid HTML source', () => {
    const templates = listTemplates();
    for (const t of templates) {
      const source = getTemplateSource(t.id);
      expect(source).toBeDefined();
      expect(source).toContain('<!DOCTYPE html>');
      expect(source).toContain('</html>');
    }
  });
});
