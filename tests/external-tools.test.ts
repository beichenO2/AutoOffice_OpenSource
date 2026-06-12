import { describe, it, expect } from 'vitest';
import {
  detectExternalTools,
  buildExternalToolsSummary,
  convertWithPandoc,
} from '../src/integrations/external-tools.js';

describe('external tools', () => {
  it('detects available tools without crashing', async () => {
    const report = await detectExternalTools();
    expect(report.tools).toBeDefined();
    expect(report.tools.length).toBeGreaterThanOrEqual(3);
    expect(report.recommendedPptEngine).toBeDefined();
    expect(report.recommendedDocxEngine).toBeDefined();
    expect(['built-in', 'officecli', 'ppt-master', 'presenton']).toContain(report.recommendedPptEngine);
  }, 15000);

  it('reports pandoc availability correctly', async () => {
    const report = await detectExternalTools();
    const pandoc = report.tools.find((t) => t.name === 'Pandoc');
    expect(pandoc).toBeDefined();
    expect(typeof pandoc?.available).toBe('boolean');
  }, 15000);

  it('builds a format-level summary for CLI and API surfaces', async () => {
    const summary = await buildExternalToolsSummary();
    expect(Array.isArray(summary.tools)).toBe(true);
    expect(summary.formatSupport.map((item) => item.format)).toEqual(
      expect.arrayContaining(['pptx', 'docx', 'pdf']),
    );
    expect(summary.conversionPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ input: 'html', output: 'docx', engine: 'pandoc' }),
        expect.objectContaining({ input: 'docx', output: 'pdf', engine: 'libreoffice' }),
      ]),
    );
  }, 15000);

  it('convertWithPandoc fails gracefully for non-existent file', async () => {
    const result = await convertWithPandoc('/nonexistent/file.md', '/tmp/out.docx');
    expect(typeof result).toBe('boolean');
  }, 15000);
});
