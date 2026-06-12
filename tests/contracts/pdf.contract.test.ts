import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validatePdfPayload } from '../../src/pdf/validate.js';
import { isPdfThemeId, PDF_THEME_IDS } from '../../src/pdf/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
function loadJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf-8')); }

const schema = loadJson(resolve(contractsDir, 'pdf.schema.json'));
const example = loadJson(resolve(contractsDir, 'examples/pdf.example.json'));
const studyReviewExample = loadJson(resolve(contractsDir, 'examples/pdf-study-review.example.json'));

describe('PDF contract', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema as object);

  it('standard example passes schema validation', () => { expect(validate(example)).toBe(true); });
  it('study-review example passes schema validation', () => { expect(validate(studyReviewExample)).toBe(true); });
  it('standard example passes runtime validator', () => {
    const data = example as { pdf: Parameters<typeof validatePdfPayload>[0] };
    expect(validatePdfPayload(data.pdf).ok).toBe(true);
  });
  it('study-review example passes runtime validator', () => {
    const data = studyReviewExample as { pdf: Parameters<typeof validatePdfPayload>[0] };
    expect(validatePdfPayload(data.pdf).ok).toBe(true);
  });
  it('study-review is a valid PDF theme', () => { expect(isPdfThemeId('study-review')).toBe(true); });
  it('schema rejects invalid theme', () => {
    expect(validate({ pdf: { theme: 'nope', locale: 'zh-CN', title: 'T', sections: [{ heading: 'H', body: 'B' }] } })).toBe(false);
  });
  it('schema rejects missing fields', () => {
    expect(validate({})).toBe(false);
    expect(validate({ pdf: {} })).toBe(false);
  });
  it('all PDF_THEME_IDS match schema enum', () => {
    const s = schema as { properties: { pdf: { properties: { theme: { enum: string[] } } } } };
    expect(s.properties.pdf.properties.theme.enum.length).toBe(PDF_THEME_IDS.length);
    for (const id of PDF_THEME_IDS) expect(s.properties.pdf.properties.theme.enum).toContain(id);
  });
});
