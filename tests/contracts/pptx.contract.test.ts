import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validatePptxPayload } from '../../src/ppt/validate.js';
import { PPTX_THEME_IDS } from '../../src/ppt/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
function loadJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf-8')); }

const schema = loadJson(resolve(contractsDir, 'pptx.schema.json'));
const example = loadJson(resolve(contractsDir, 'examples/pptx.example.json'));

describe('PPTX contract', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema as object);

  it('example passes schema validation', () => { expect(validate(example)).toBe(true); });
  it('example passes runtime validator', () => {
    const data = example as { pptx: Parameters<typeof validatePptxPayload>[0] };
    expect(validatePptxPayload(data.pptx).ok).toBe(true);
  });
  it('schema rejects invalid theme', () => {
    expect(validate({ pptx: { theme: 'x', locale: 'zh-CN', title: 'T', slides: [{ title: 'S', bullets: ['b'] }] } })).toBe(false);
  });
  it('all PPTX_THEME_IDS match schema enum', () => {
    const s = schema as { properties: { pptx: { properties: { theme: { enum: string[] } } } } };
    expect(s.properties.pptx.properties.theme.enum.length).toBe(PPTX_THEME_IDS.length);
  });
});
