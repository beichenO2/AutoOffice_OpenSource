import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');
function loadJson(path: string): unknown { return JSON.parse(readFileSync(path, 'utf-8')); }

const schema = loadJson(resolve(contractsDir, 'html.schema.json'));
const example = loadJson(resolve(contractsDir, 'examples/html.example.json'));

describe('HTML contract', () => {
  const ajv = new Ajv();
  const validate = ajv.compile(schema as object);

  it('example passes schema', () => { expect(validate(example)).toBe(true); });
  it('rejects empty sections', () => { expect(validate({ sections: [] })).toBe(false); });
  it('rejects missing sections', () => { expect(validate({ title: 'X' })).toBe(false); });
  it('accepts title field', () => { expect(validate({ sections: [{ title: 'T', content: 'C' }] })).toBe(true); });
  it('accepts heading field', () => { expect(validate({ sections: [{ heading: 'H', body: 'B' }] })).toBe(true); });
});
