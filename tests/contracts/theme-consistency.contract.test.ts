import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDF_THEME_IDS } from '../../src/pdf/types.js';
import { PPTX_THEME_IDS } from '../../src/ppt/types.js';
import { DOCX_THEME_IDS } from '../../src/docx/types.js';
import { LATEX_THEME_IDS } from '../../src/latex/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '../../contracts');

function loadSchemaEnum(file: string, key: string): string[] {
  const schema = JSON.parse(readFileSync(resolve(contractsDir, file), 'utf-8'));
  return schema.properties[key].properties.theme.enum;
}

describe('theme consistency: schema ↔ code', () => {
  it('PDF', () => { expect([...loadSchemaEnum('pdf.schema.json', 'pdf')].sort()).toEqual([...PDF_THEME_IDS].sort()); });
  it('PPTX', () => { expect([...loadSchemaEnum('pptx.schema.json', 'pptx')].sort()).toEqual([...PPTX_THEME_IDS].sort()); });
  it('DOCX', () => { expect([...loadSchemaEnum('docx.schema.json', 'docx')].sort()).toEqual([...DOCX_THEME_IDS].sort()); });
  it('LaTeX', () => { expect([...loadSchemaEnum('latex.schema.json', 'latex')].sort()).toEqual([...LATEX_THEME_IDS].sort()); });
});

describe('contracts directory completeness', () => {
  const schemas = ['pdf.schema.json', 'pptx.schema.json', 'docx.schema.json', 'latex.schema.json', 'html.schema.json'];
  const examples = ['pdf.example.json', 'pdf-study-review.example.json', 'pptx.example.json', 'docx.example.json', 'latex.example.json', 'html.example.json'];

  for (const f of schemas) it(`schema: ${f}`, () => { expect(existsSync(resolve(contractsDir, f))).toBe(true); });
  for (const f of examples) it(`example: ${f}`, () => { expect(existsSync(resolve(contractsDir, 'examples', f))).toBe(true); });
  it('README.md', () => { expect(existsSync(resolve(contractsDir, 'README.md'))).toBe(true); });
});
