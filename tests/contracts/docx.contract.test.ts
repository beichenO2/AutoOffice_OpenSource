import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validateDocxPayload } from '../../src/docx/validate.js';
import { DOCX_THEME_IDS } from '../../src/docx/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
function loadJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf-8')); }

const schema = loadJson(resolve(contractsDir, 'docx.schema.json'));
const example = loadJson(resolve(contractsDir, 'examples/docx.example.json'));

describe('DOCX contract', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema as object);

  it('example passes schema', () => { expect(validate(example)).toBe(true); });
  it('example passes runtime validator', () => {
    const data = example as { docx: Parameters<typeof validateDocxPayload>[0] };
    expect(validateDocxPayload(data.docx).ok).toBe(true);
  });
  it('schema rejects invalid theme', () => {
    expect(validate({ docx: { theme: 'x', locale: 'zh-CN', title: 'T', sections: [{ heading: 'H', body: 'B' }] } })).toBe(false);
  });
  it('themes match', () => {
    const s = schema as { properties: { docx: { properties: { theme: { enum: string[] } } } } };
    expect(s.properties.docx.properties.theme.enum.length).toBe(DOCX_THEME_IDS.length);
  });
});
