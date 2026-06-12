import type { PdfReportPayload } from './types.js';
import { buildPdfHtml } from './html-builder.js';

let _browser: Awaited<ReturnType<typeof import('playwright')['chromium']['launch']>> | null = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  const { chromium } = await import('playwright');
  _browser = await chromium.launch({ headless: true });
  return _browser;
}

export async function closePdfBrowser(): Promise<void> {
  if (_browser && _browser.isConnected()) {
    await _browser.close();
  }
  _browser = null;
}

export async function renderPdfWithPlaywright(payload: PdfReportPayload): Promise<Buffer> {
  const html = buildPdfHtml(payload);
  return renderHtmlToPdf(html);
}

export interface HtmlToPdfOptions {
  format?: 'A4' | 'Letter';
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  /** "screen" 用页面 @page 规则，"print" 也用 @page 规则，但媒体类型设为 print */
  emulateMedia?: 'screen' | 'print';
  printBackground?: boolean;
  /** 等待网络空闲（适合需要外部字体加载的页面），默认 'domcontentloaded' */
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
}

/**
 * 将任意 HTML 字符串渲染为 PDF（A4 默认）。
 *
 * 用例：消费方（KnowLever / PolarDesign / 其他）已自行生成 print-ready HTML，
 * 仅需调用浏览器引擎出 PDF 文件。本函数对 HTML 内容无任何主题假设。
 */
export async function renderHtmlToPdf(html: string, opts: HtmlToPdfOptions = {}): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: opts.waitUntil ?? 'domcontentloaded' });
    if (opts.emulateMedia) {
      await page.emulateMedia({ media: opts.emulateMedia });
    } else {
      await page.emulateMedia({ media: 'print' });
    }
    const pdfBuffer = await page.pdf({
      format: opts.format ?? 'A4',
      printBackground: opts.printBackground ?? true,
      margin: opts.margin ?? { top: '0', bottom: '0', left: '0', right: '0' },
      preferCSSPageSize: true,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await page.close();
  }
}
