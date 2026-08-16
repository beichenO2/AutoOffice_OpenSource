import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDrawioXml } from '../../src/engine/figure/audit.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, '../fixtures/scientific-figure');

const RASTER_HARD_CATEGORIES = new Set([
  'whole-sketch-raster',
  'possible-composite-raster',
  'large-raster-surface',
]);

function loadFixture(name: string): string {
  return readFileSync(resolve(fixtureDir, name), 'utf-8');
}

function countImageCells(xml: string): number {
  const cells = xml.match(/<mxCell\b[^>]*>/g) ?? [];
  return cells.filter((cell) => /shape=image/i.test(cell) || /image=data/i.test(cell)).length;
}

function hardFindings(result: ReturnType<typeof auditDrawioXml>) {
  return result.findings.filter((finding) => finding.severity === 'hard');
}

function figureXml(cells: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="AutoOffice">
  <diagram id="pin" name="Page-1">
    <mxGraphModel pageWidth="1600" pageHeight="900">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
}

function imageCell(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parent = '1',
  extra: { style?: string; value?: string } = {},
): string {
  const style = extra.style ?? 'shape=image;html=1;image=data:image/png,AAA';
  const value = extra.value ?? '';
  return `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parent}">
          <mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/>
        </mxCell>`;
}

describe('auditDrawioXml', () => {
  it('flags a whole-sketch image cell as a hard raster finding', () => {
    const xml = loadFixture('whole-sketch.drawio');
    const result = auditDrawioXml(xml);
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(result.hardCount).toBe(hardFindings(result).length);
    expect(
      result.findings.some(
        (finding) => finding.severity === 'hard' && finding.category === 'whole-sketch-raster',
      ),
    ).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' && RASTER_HARD_CATEGORIES.has(String(finding.category)),
      ),
    ).toBe(true);
  });

  it('flags a large non-full-page image cell as a hard raster finding', () => {
    const xml = loadFixture('composite-raster.drawio');
    expect(xml).not.toContain('id="sketch-bg"');
    expect(countImageCells(xml)).toBe(1);
    const result = auditDrawioXml(xml);
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(result.hardCount).toBe(hardFindings(result).length);
    expect(
      result.findings.some(
        (finding) => finding.severity === 'hard' && finding.category === 'possible-composite-raster',
      ),
    ).toBe(true);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' && RASTER_HARD_CATEGORIES.has(String(finding.category)),
      ),
    ).toBe(true);
  });

  it('rejects illegal XML', () => {
    const result = auditDrawioXml('<<<not-xml');
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(result.hardCount).toBe(hardFindings(result).length);
    expect(
      result.findings.some(
        (finding) => finding.severity === 'hard' && finding.category === 'invalid-xml',
      ),
    ).toBe(true);
  });

  it('rejects well-formed XML that is not an mxfile', () => {
    const result = auditDrawioXml('<root><diagram/></root>');
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some(
        (finding) => finding.severity === 'hard' && finding.category === 'invalid-xml',
      ),
    ).toBe(true);
  });

  it('flags a full-page image cell even when the id is not sketch-bg', () => {
    const result = auditDrawioXml(figureXml(imageCell('pasted-photo', 0, 0, 1600, 900)));
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' &&
          finding.category === 'whole-sketch-raster' &&
          finding.objectIds?.includes('pasted-photo'),
      ),
    ).toBe(true);
  });

  it('accepts a native mxfile with no image cells', () => {
    const result = auditDrawioXml(
      figureXml(`<mxCell id="shape-input" value="输入层" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="80" y="320" width="280" height="160" as="geometry"/>
        </mxCell>`),
    );
    expect(result.ok).toBe(true);
    expect(result.hardCount).toBe(0);
    expect(hardFindings(result)).toEqual([]);
  });

  it('accepts a small image cell below the large-raster threshold', () => {
    const result = auditDrawioXml(figureXml(imageCell('icon-photo', 40, 40, 120, 80)));
    expect(result.ok).toBe(true);
    expect(result.hardCount).toBe(0);
    expect(hardFindings(result)).toEqual([]);
  });

  it('classifies a composite-hinting large image as possible-composite-raster', () => {
    const result = auditDrawioXml(figureXml(imageCell('composite-field', 80, 80, 500, 400)));
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBe(hardFindings(result).length);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' &&
          finding.category === 'possible-composite-raster' &&
          finding.objectIds?.includes('composite-field'),
      ),
    ).toBe(true);
    expect(result.findings.some((finding) => finding.category === 'large-raster-surface')).toBe(
      false,
    );
  });

  it('classifies a neutral-id large image as large-raster-surface', () => {
    const result = auditDrawioXml(figureXml(imageCell('photo-field', 80, 80, 500, 400)));
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBe(hardFindings(result).length);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' &&
          finding.category === 'large-raster-surface' &&
          finding.objectIds?.includes('photo-field'),
      ),
    ).toBe(true);
    expect(result.findings.some((finding) => finding.category === 'possible-composite-raster')).toBe(
      false,
    );
  });

  it('hard-fails a large image after accumulating a translated parent box', () => {
    const xml = figureXml(`<mxCell id="group-shift" value="" style="group" vertex="1" parent="1">
          <mxGeometry x="200" y="50" width="1200" height="800" as="geometry"/>
        </mxCell>
        ${imageCell('nested-photo', 0, 0, 1200, 800, 'group-shift')}`);
    const result = auditDrawioXml(xml);
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    const finding = result.findings.find(
      (item) => item.severity === 'hard' && item.objectIds?.includes('nested-photo'),
    );
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('[200, 50, 1200×800]');
    expect(finding?.category).toBe('large-raster-surface');
  });

  it('flags a large html value image even without shape=image style', () => {
    const result = auditDrawioXml(
      figureXml(
        imageCell('html-photo', 80, 80, 500, 400, '1', {
          style: 'text;html=1;whiteSpace=wrap;',
          value: '&lt;img src=&quot;data:image/png,AAA&quot;/&gt;',
        }),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.hardCount).toBeGreaterThanOrEqual(1);
    expect(
      result.findings.some(
        (finding) =>
          finding.severity === 'hard' &&
          finding.category === 'large-raster-surface' &&
          finding.objectIds?.includes('html-photo'),
      ),
    ).toBe(true);
  });
});
