/**
 * Office / PDF → Markdown for KnowLever / LLM ingest.
 * Uses Pandoc when available; falls back to LibreOffice → plain text.
 * For formula-heavy PDFs: detects garbled output and falls back to VLM OCR.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { convertWithLibreOffice, convertWithPandoc } from './external-tools.js';
import { detectBackend, ocrPdf, looksLikeGarbledFormulas } from './vlm-ocr.js';

const execFileAsync = promisify(execFile);

const TEXT_EXTS = new Set(['.md', '.markdown', '.txt']);
const PANDOC_EXTS = new Set(['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.odt', '.rtf', '.epub']);

function wrapAsMarkdown(title: string, body: string, sourcePath: string): string {
  const trimmed = body.replace(/\r\n/g, '\n').trim();
  return `# ${title}\n\n> 来源：\`${basename(sourcePath)}\`（AutoOffice to-markdown）\n\n${trimmed}\n`;
}

export async function convertFileToMarkdown(inputPath: string): Promise<string> {
  const ext = extname(inputPath).toLowerCase();
  const title = basename(inputPath, ext);

  if (TEXT_EXTS.has(ext)) {
    const raw = await readFile(inputPath, 'utf-8');
    return ext === '.md' || ext === '.markdown' ? raw : wrapAsMarkdown(title, raw, inputPath);
  }

  if (ext === '.pdf') {
    let plainText = '';
    for (const cmd of ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']) {
      try {
        const { stdout } = await execFileAsync(cmd, [inputPath, '-'], {
          encoding: 'utf-8',
          maxBuffer: 32 * 1024 * 1024,
        });
        if (stdout.trim()) { plainText = stdout; break; }
      } catch {
        /* try next */
      }
    }

    if (plainText && !looksLikeGarbledFormulas(plainText)) {
      return wrapAsMarkdown(title, plainText, inputPath);
    }

    const backend = await detectBackend();
    if (backend.available) {
      const tmp = await mkdtemp(join(tmpdir(), 'ao-vlmocr-'));
      const result = await ocrPdf(inputPath, backend, { outputDir: tmp });
      if (result.chars > 0) {
        return wrapAsMarkdown(title, result.text, inputPath);
      }
    }

    if (plainText) {
      return wrapAsMarkdown(title, plainText, inputPath);
    }
  }

  if (PANDOC_EXTS.has(ext)) {
    const tmp = await mkdtemp(join(tmpdir(), 'ao-tomd-'));
    const outMd = join(tmp, `${title}.md`);
    const from = ext === '.doc' ? 'doc' : ext.slice(1);
    const ok = await convertWithPandoc(inputPath, outMd, { from });
    if (ok) {
      return readFile(outMd, 'utf-8');
    }

    const outTxt = join(tmp, `${title}.txt`);
    const loOk = await convertWithLibreOffice(inputPath, tmp, 'txt');
    if (loOk) {
      try {
        const txt = await readFile(outTxt, 'utf-8');
        return wrapAsMarkdown(title, txt, inputPath);
      } catch {
        /* fall through */
      }
    }
  }

  throw new Error(
    `无法将 ${basename(inputPath)} 转为 Markdown。PDF 需 pdftotext（poppler）；Office 需 Pandoc/LibreOffice。运行: autooffice tools`,
  );
}

export async function convertInputsToMarkdown(
  inputPath: string,
  outputDir: string,
): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  const absIn = resolve(inputPath);
  const st = await stat(absIn);
  const files: string[] = [];

  if (st.isDirectory()) {
    for (const name of await readdir(absIn)) {
      const full = join(absIn, name);
      const s = await stat(full);
      if (s.isFile() && !name.startsWith('.')) files.push(full);
    }
  } else {
    files.push(absIn);
  }

  await mkdir(outputDir, { recursive: true });
  const written: string[] = [];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (!TEXT_EXTS.has(ext) && !PANDOC_EXTS.has(ext)) continue;

    const md = await convertFileToMarkdown(file);
    const base = basename(file, extname(file)).replace(/[^\w\u4e00-\u9fff-]+/g, '-');
    const outPath = join(outputDir, `${base}.md`);
    await writeFile(outPath, md.endsWith('\n') ? md : `${md}\n`, 'utf-8');
    written.push(outPath);
    console.log(`[to-markdown] ${basename(file)} → ${outPath}`);
  }

  return written;
}
