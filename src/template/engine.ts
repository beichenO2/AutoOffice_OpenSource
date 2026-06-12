import Handlebars from 'handlebars';
import { readFile } from 'node:fs/promises';

/** 注册常用 helper，避免在业务模板里写冗长逻辑 */
export function registerDefaultHelpers(): void {
  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
}

let helpersRegistered = false;

function ensureHelpers(): void {
  if (!helpersRegistered) {
    registerDefaultHelpers();
    helpersRegistered = true;
  }
}

export function compileTemplate(source: string): HandlebarsTemplateDelegate {
  ensureHelpers();
  return Handlebars.compile(source, { strict: true, noEscape: false });
}

export async function renderTemplateString<T extends Record<string, unknown>>(
  source: string,
  data: T,
): Promise<string> {
  const tpl = compileTemplate(source);
  return tpl(data);
}

export async function renderTemplateFile<T extends Record<string, unknown>>(
  filePath: string,
  data: T,
): Promise<string> {
  const source = await readFile(filePath, 'utf-8');
  return renderTemplateString(source, data);
}
