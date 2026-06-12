/**
 * VLM OCR — PDF/image formula recognition with fallback chain.
 *
 * Backend priority: PolarPrivate (capability V1000) > Ollama local VLM.
 * PDF workflow: pdftoppm → page images → VLM batch/single OCR → merge.
 *
 * Adapted from KnowLever's vlm-formula-ocr.js for AutoOffice ESM/TS.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const POLARPRIVATE_URL = process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790/v1';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const VLM_MODEL = process.env.VLM_MODEL || 'qwen3-vl:8b';
const PDF_DPI = parseInt(process.env.PDF_DPI || '300', 10);

const BATCH_TARGET_TOKENS = 32000;
const TOKENS_PER_A4_300DPI = 8500;
const PAGES_PER_BATCH = Math.max(1, Math.floor(BATCH_TARGET_TOKENS / TOKENS_PER_A4_300DPI));

export interface VlmBackend {
  available: boolean;
  backend?: 'polarprivate' | 'ollama';
  model?: string;
  reason?: string;
}

export interface OcrResult {
  text: string;
  pages?: number;
  backend: string;
  chars: number;
}

const FORMULA_OCR_PROMPT = `你是数学公式 OCR 引擎。发给你的图片中应该有数学公式，请你识别并还原图片中的有效信息。

输出规则：
1. 数学公式用 LaTeX 格式：inline 用 $...$，独立公式用 $$...$$
2. 化学式也用 LaTeX：$H_2O$, $CH_3COOH$
3. 普通文字直接输出（保持原文语言）
4. 保持原文结构（段落、列表等）
5. 如果图片中有多行公式，每行一个 $$...$$
6. 上下标：$x^2$, $a_n$, $C_A^{n-1}$
7. 分数：$\\frac{a}{b}$
8. 根号：$\\sqrt{x}$
9. 希腊字母：$\\alpha$, $\\beta$, $\\Delta$
10. 如果无法识别某部分，用 [?] 标记

只输出识别结果，不要解释。`;

async function checkPolarPrivate(): Promise<VlmBackend> {
  try {
    const res = await fetch(`${POLARPRIVATE_URL}/models`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Authorization': 'Bearer sk-placeholder' },
    });
    if (!res.ok) return { available: false, reason: `PolarPrivate returned ${res.status}` };
    const data = await res.json() as { data?: { id: string }[] };
    const models = (data.data || []).map(m => m.id);
    if (!models.some(m => m === 'V1000')) {
      return { available: false, reason: 'V1000 capability not in models list' };
    }
    return { available: true, backend: 'polarprivate' };
  } catch (e: any) {
    return { available: false, reason: `PolarPrivate not reachable: ${e.message}` };
  }
}

async function checkOllama(): Promise<VlmBackend> {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { available: false, reason: `Ollama returned ${res.status}` };
    const data = await res.json() as { models?: { name: string }[] };
    const models = (data.models || []).map(m => m.name);
    const prefix = VLM_MODEL.split(':')[0] ?? VLM_MODEL;
    if (!models.some(m => m.startsWith(prefix))) {
      return { available: false, reason: `Model ${VLM_MODEL} not found. Available: ${models.join(', ')}` };
    }
    return { available: true, backend: 'ollama', model: VLM_MODEL };
  } catch (e: any) {
    return { available: false, reason: `Ollama not reachable: ${e.message}` };
  }
}

export async function detectBackend(): Promise<VlmBackend> {
  const pp = await checkPolarPrivate();
  if (pp.available) return pp;
  const ol = await checkOllama();
  if (ol.available) return ol;
  return { available: false, reason: `No VLM backend: PP=${pp.reason}; Ollama=${ol.reason}` };
}

async function ocrViaPolarPrivate(base64Image: string, mimeType: string): Promise<string> {
  const response = await fetch(`${POLARPRIVATE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-placeholder',
    },
    body: JSON.stringify({
      model: 'V1000',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: FORMULA_OCR_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      }],
      temperature: 0.1,
      max_tokens: 65536,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PolarPrivate ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function ocrViaOllama(base64Image: string): Promise<string> {
  const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VLM_MODEL,
      messages: [{
        role: 'user',
        content: '/no_think\n\n' + FORMULA_OCR_PROMPT,
        images: [base64Image],
      }],
      stream: false,
      options: { temperature: 0.1, num_predict: 65536 },
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  return (data.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function ocrImage(imagePath: string, backend: VlmBackend, maxRetries = 5): Promise<string> {
  const imageBuffer = readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = extname(imagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext] || 'image/png';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let content = '';
    try {
      if (backend.backend === 'polarprivate') {
        content = await ocrViaPolarPrivate(base64Image, mimeType);
      } else {
        content = await ocrViaOllama(base64Image);
      }
    } catch (e: any) {
      if (attempt === maxRetries) throw e;
      console.warn(`[vlm-ocr] attempt ${attempt} failed: ${e.message}`);
    }

    if (content.length > 0) return content;
    if (attempt < maxRetries) {
      const delay = 3000 * attempt;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return '';
}

async function ocrBatchViaPolarPrivate(imagePaths: string[]): Promise<string> {
  const contentParts: any[] = [
    { type: 'text', text: FORMULA_OCR_PROMPT + `\n\n以下共 ${imagePaths.length} 页，请按顺序识别每页内容，页与页之间用 "---" 分隔。` },
  ];

  for (const imgPath of imagePaths) {
    const buf = readFileSync(imgPath);
    const ext = extname(imgPath).toLowerCase();
    const mimeMap: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
    const mime = mimeMap[ext] || 'image/png';
    contentParts.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${buf.toString('base64')}` },
    });
  }

  const response = await fetch(`${POLARPRIVATE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer sk-placeholder',
    },
    body: JSON.stringify({
      model: 'V0010',
      messages: [{ role: 'user', content: contentParts }],
      temperature: 0.1,
      max_tokens: 65536,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`PolarPrivate batch ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return (data.choices?.[0]?.message?.content || '').trim();
}

export interface PdfOcrOptions {
  dpi?: number;
  outputDir?: string;
}

/**
 * OCR a PDF via VLM: pdftoppm → page images → VLM recognition.
 * Batch-processes pages when PolarPrivate is available; single-page for Ollama.
 * Falls back per-page if batch fails.
 */
export async function ocrPdf(pdfPath: string, backend: VlmBackend, opts: PdfOcrOptions = {}): Promise<OcrResult> {
  const dpi = opts.dpi || PDF_DPI;
  const outputDir = opts.outputDir || dirname(pdfPath);
  const imagesDir = join(outputDir, '_pdf_pages');
  mkdirSync(imagesDir, { recursive: true });

  const pdfBase = basename(pdfPath, '.pdf');
  const result = spawnSync('pdftoppm', ['-png', '-r', String(dpi), pdfPath, join(imagesDir, pdfBase)], {
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || '';
    throw new Error(`pdftoppm failed: ${stderr.slice(0, 200)}. Install poppler: brew install poppler`);
  }

  const pages = readdirSync(imagesDir).filter(f => f.endsWith('.png')).sort();
  const allText: string[] = [];

  if (backend.backend === 'polarprivate' && pages.length > 1) {
    for (let i = 0; i < pages.length; i += PAGES_PER_BATCH) {
      const batch = pages.slice(i, i + PAGES_PER_BATCH);
      const batchPaths = batch.map(p => join(imagesDir, p));
      try {
        const text = await ocrBatchViaPolarPrivate(batchPaths);
        allText.push(text);
      } catch (e: any) {
        for (const page of batch) {
          try {
            const text = await ocrImage(join(imagesDir, page), backend);
            allText.push(text);
          } catch (e2: any) {
            allText.push(`[OCR failed: ${e2.message}]`);
          }
        }
      }
    }
  } else {
    for (const page of pages) {
      try {
        const text = await ocrImage(join(imagesDir, page), backend);
        allText.push(text);
      } catch (e: any) {
        allText.push(`[OCR failed: ${e.message}]`);
      }
    }
  }

  const combined = allText.join('\n\n---\n\n');
  return { text: combined, pages: pages.length, backend: backend.backend || 'unknown', chars: combined.length };
}

/**
 * Detect if pdftotext output likely contains garbled formulas.
 * Heuristic: lots of isolated variables, broken subscripts, or math symbols without LaTeX wrapping.
 */
export function looksLikeGarbledFormulas(text: string): boolean {
  const lines = text.split('\n');
  let suspiciousCount = 0;

  const patterns = [
    /[A-Z]\s{2,}\d/,           // Variable separated from number by spaces
    /\n\s{3,}\d\b/,            // Indented lone number (broken fraction/subscript)
    /[αβγδεζηθλμξπρστφχψωΔΣ]/, // Greek letters without $ wrapping
    /[∫∂∞≥≤≠≈∈∉⊂⊃∪∩±×÷√∝∀∃⇒⇔→←↑↓]/, // Math operators without wrapping
    /\b[A-Z][a-z]?\d+\b/,     // Chemical formula-like pattern without wrapping
  ];

  for (const line of lines) {
    if (line.startsWith('```') || /\$[^$]+\$/.test(line)) continue;
    if (patterns.some(p => p.test(line))) suspiciousCount++;
  }

  return suspiciousCount > Math.max(3, lines.length * 0.05);
}

export { checkPolarPrivate as checkPolarPrivateVlm, checkOllama as checkOllamaVlm };
