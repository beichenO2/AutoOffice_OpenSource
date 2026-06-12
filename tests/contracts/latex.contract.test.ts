import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { validateLatexPayload } from '../../src/latex/validate.js';
import { LATEX_THEME_IDS } from '../../src/latex/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
function loadJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf-8')); }

const schema = loadJson(resolve(contractsDir, 'latex.schema.json'));
const example = loadJson(resolve(contractsDir, 'examples/latex.example.json'));

describe('LaTeX contract', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema as object);

  it('example passes schema', () => { expect(validate(example)).toBe(true); });
  it('example passes runtime validator', () => {
    const data = example as { latex: Parameters<typeof validateLatexPayload>[0] };
    expect(validateLatexPayload(data.latex).ok).toBe(true);
  });
  it('schema rejects invalid theme', () => {
    expect(validate({ latex: { theme: 'x', locale: 'en-US', title: 'T', sections: [{ heading: 'H', body: 'B' }] } })).toBe(false);
  });
  it('themes match', () => {
    const s = schema as { properties: { latex: { properties: { theme: { enum: string[] } } } } };
    expect(s.properties.latex.properties.theme.enum.length).toBe(LATEX_THEME_IDS.length);
  });
});
