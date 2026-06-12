import type { LookupAddress, LookupAllOptions, LookupOneOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import type { IncomingHttpHeaders, RequestOptions } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { basename, extname } from 'node:path';
import JSZip from 'jszip';
import type { RawInput, ParsedContent } from './types.js';

const ARCHIVE_EXTENSIONS = new Set(['zip']);
const TEXTUAL_FORMATS = new Set(['', 'html', 'htm', 'md', 'markdown', 'txt', 'text', 'json', 'csv', 'xml', 'svg']);
const TEXTUAL_CONTENT_TYPES = [
  'text/',
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/xhtml+xml',
  'application/javascript',
  'application/csv',
  'image/svg+xml',
];
const SKIPPED_ARCHIVE_ENTRY_PATTERNS = [/^__MACOSX\//, /(^|\/)\.DS_Store$/];
const UTF8_DECODER = new TextDecoder('utf-8');
const FETCH_REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_FETCH_REDIRECTS = 5;
const SUMMARIZE_URL_FETCH_TIMEOUT_MS = 10_000;
const MAX_SUMMARIZE_URL_RESPONSE_BYTES = 5 * 1024 * 1024;
type ValidatedRemoteUrl = {
  url: URL;
  hostname: string;
  resolvedAddresses: LookupAddress[];
};

type RemoteFetchResponse = {
  status: number;
  statusText: string;
  headers: Headers;
  url: string;
  body: string;
};

type PinnedLookupOptions = number | LookupOneOptions | LookupAllOptions;
type PinnedRequestOptions = RequestOptions & { servername?: string };
type PinnedLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function countWords(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const latinWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  return cjkChars + latinWords;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim().length > 0).length;
}

function detectLang(text: string): 'zh' | 'en' | 'mixed' {
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const total = text.length;
  if (total === 0) return 'en';
  const ratio = cjk / total;
  if (ratio > 0.3) return ratio > 0.7 ? 'zh' : 'mixed';
  return 'en';
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getFormat(value: string, formatHint?: string): string {
  return (formatHint || extname(value).slice(1)).toLowerCase();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripInlineHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s{2,}/g, ' ').trim();
}

function htmlToMarkdown(html: string): string {
  const withStructure = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<title[^>]*>([\s\S]*?)<\/title>/gi, (_m, text: string) => `\n# ${stripInlineHtml(text)}\n\n`)
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_m, text: string) => `\n# ${stripInlineHtml(text)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_m, text: string) => `\n## ${stripInlineHtml(text)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_m, text: string) => `\n### ${stripInlineHtml(text)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, text: string) => `\n- ${stripInlineHtml(text)}\n`)
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, text: string) => {
      const code = decodeHtmlEntities(text).replace(/\r\n/g, '\n').trim();
      return code ? `\n\`\`\`\n${code}\n\`\`\`\n\n` : '\n';
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, text: string) => {
      const quote = stripInlineHtml(text);
      return quote ? `\n> ${quote}\n\n` : '\n';
    })
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_m, text: string) => {
      const paragraph = stripInlineHtml(text);
      return paragraph ? `\n${paragraph}\n\n` : '\n';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(article|section|div|main|header|footer|aside|nav)[^>]*>/gi, '\n');

  return normalizeMarkdown(
    decodeHtmlEntities(withStructure)
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]{2,}/g, ' '),
  );
}

function renderRawAsMarkdown(raw: string, ext: string): string {
  const normalizedRaw = raw.replace(/\r\n/g, '\n').trim();

  switch (ext) {
    case 'html':
    case 'htm':
      return htmlToMarkdown(raw);
    case 'md':
    case 'markdown':
    case 'txt':
    case 'text':
      return normalizedRaw;
    case 'json':
      return normalizedRaw ? `\`\`\`json\n${normalizedRaw}\n\`\`\`` : '';
    case 'csv':
      return csvToMarkdownTable(normalizedRaw);
    default:
      return normalizedRaw;
  }
}

function buildParsedContent(source: RawInput, markdown: string): ParsedContent {
  const normalizedMarkdown = normalizeMarkdown(markdown);
  return {
    source,
    markdown: normalizedMarkdown,
    byteLength: Buffer.byteLength(normalizedMarkdown, 'utf-8'),
    wordCount: countWords(normalizedMarkdown),
    paragraphCount: countParagraphs(normalizedMarkdown),
    lang: detectLang(normalizedMarkdown),
  };
}

function shouldTreatAsArchive(input: RawInput): boolean {
  return input.kind === 'file' && ARCHIVE_EXTENSIONS.has(getFormat(input.value, input.formatHint));
}

export function normalizeRawInput(input: RawInput): RawInput {
  if (!shouldTreatAsArchive(input)) return input;
  return {
    ...input,
    kind: 'archive',
    formatHint: input.formatHint ?? getFormat(input.value, input.formatHint),
  };
}

export function normalizeRawInputs(inputs: RawInput[]): RawInput[] {
  return inputs.map(normalizeRawInput);
}

async function parseText(input: RawInput): Promise<ParsedContent> {
  return buildParsedContent(input, input.value);
}

async function parseFile(input: RawInput): Promise<ParsedContent> {
  const normalizedInput = normalizeRawInput(input);
  if (normalizedInput.kind === 'archive') {
    return parseArchive(normalizedInput);
  }

  const raw = await readFile(normalizedInput.value, 'utf-8');
  const ext = getFormat(normalizedInput.value, normalizedInput.formatHint);
  return buildParsedContent(normalizedInput, renderRawAsMarkdown(raw, ext));
}

function csvToMarkdownTable(csv: string): string {
  const rows = parseCsvRows(csv);
  const width = Math.max(1, ...rows.map((row) => row.length));
  const header = normalizeMarkdownTableRow(rows[0], width);
  if (header.every((cell) => cell.length === 0)) return '';
  const sep = Array.from({ length: width }, () => '---');
  return [
    '| ' + header.join(' | ') + ' |',
    '| ' + sep.join(' | ') + ' |',
    ...rows.slice(1).map((row) => '| ' + normalizeMarkdownTableRow(row, width).join(' | ') + ' |'),
  ].join('\n');
}

function parseCsvRows(csv: string): string[][] {
  const normalized = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = '';
  };

  const pushRow = () => {
    if (row.some((value) => value.length > 0)) {
      rows.push(row);
    }
    row = [];
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];

    if (inQuotes) {
      if (char === '"') {
        if (normalized[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.trim().length === 0) {
        cell = '';
        inQuotes = true;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === ',') {
      pushCell();
      continue;
    }

    if (char === '\n') {
      pushCell();
      pushRow();
      continue;
    }

    cell += char;
  }

  pushCell();
  pushRow();
  return rows;
}

function normalizeMarkdownTableRow(row: string[] | undefined, width: number): string[] {
  return Array.from({ length: width }, (_value, index) => formatMarkdownTableCell(row?.[index] ?? ''));
}

function formatMarkdownTableCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
    .trim();
}

function normalizeUrlHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').trim().toLowerCase();
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return false;
  }

  const first = octets[0];
  const second = octets[1];
  if (first === undefined || second === undefined) {
    return false;
  }
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = normalizeUrlHostname(address);
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    return isPrivateIpv4(normalized.slice('::ffff:'.length));
  }

  const prefix = normalized.slice(0, 3);
  return (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    prefix === 'fe8' ||
    prefix === 'fe9' ||
    prefix === 'fea' ||
    prefix === 'feb'
  );
}

function isPrivateNetworkAddress(address: string): boolean {
  const normalized = normalizeUrlHostname(address);
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version === 6) return isPrivateIpv6(normalized);
  return false;
}

async function validateRemoteUrl(urlValue: string): Promise<ValidatedRemoteUrl> {
  let parsed: URL;
  try {
    parsed = new URL(urlValue);
  } catch {
    throw new Error(`Invalid URL for summarize: ${urlValue}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol for summarize: ${parsed.protocol}`);
  }

  const hostname = normalizeUrlHostname(parsed.hostname);
  if (!hostname) {
    throw new Error(`Invalid URL host for summarize: ${urlValue}`);
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error(`Refusing to fetch private-network URL: ${urlValue}`);
  }
  if (isPrivateNetworkAddress(hostname)) {
    throw new Error(`Refusing to fetch private-network URL: ${urlValue}`);
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error(`Unable to resolve summarize URL host: ${urlValue}`);
  }
  if (resolved.some((entry) => isPrivateNetworkAddress(entry.address))) {
    throw new Error(`Refusing to fetch private-network URL: ${urlValue}`);
  }

  return {
    url: parsed,
    hostname,
    resolvedAddresses: resolved,
  };
}

function isRedirectStatus(status: number): boolean {
  return FETCH_REDIRECT_STATUS_CODES.has(status);
}

function throwIfUrlFetchTimedOut(input: RawInput, error: unknown): never {
  if (
    error instanceof Error
    && (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    throw new Error(`Timed out fetching summarize URL after ${SUMMARIZE_URL_FETCH_TIMEOUT_MS}ms: ${input.value}`);
  }
  throw error;
}

function createPinnedLookupError(hostname: string, family?: number): NodeJS.ErrnoException {
  const familySuffix = family && family > 0 ? ` (family ${family})` : '';
  const error = new Error(`No pinned address available for summarize URL host: ${hostname}${familySuffix}`) as NodeJS.ErrnoException;
  error.code = 'ENOTFOUND';
  return error;
}

function createUrlFetchTimeoutError(urlValue: string): Error {
  const error = new Error(`Timed out fetching summarize URL after ${SUMMARIZE_URL_FETCH_TIMEOUT_MS}ms: ${urlValue}`);
  error.name = 'TimeoutError';
  return error;
}

function createUrlFetchTooLargeError(urlValue: string, byteLength: number): Error {
  return new Error(
    `Summarize URL response exceeds ${MAX_SUMMARIZE_URL_RESPONSE_BYTES} bytes (${byteLength} bytes): ${urlValue}`,
  );
}

function parseContentLengthHeader(headerValue: string | string[] | undefined): number | null {
  const normalized = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!normalized) return null;

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function normalizeLookupFamily(family: number | 'IPv4' | 'IPv6' | undefined): number {
  if (family === 'IPv4') return 4;
  if (family === 'IPv6') return 6;
  return family ?? 0;
}

function createPinnedLookup(hostname: string, resolvedAddresses: LookupAddress[]) {
  const normalizedHostname = normalizeUrlHostname(hostname);

  return (requestedHostname: string, options: PinnedLookupOptions, callback: PinnedLookupCallback): void => {
    if (normalizeUrlHostname(requestedHostname) !== normalizedHostname) {
      callback(createPinnedLookupError(requestedHostname), '', 0);
      return;
    }

    const wantsAll = typeof options === 'object' && options !== null && 'all' in options && options.all === true;
    const requestedFamily = normalizeLookupFamily(typeof options === 'number' ? options : options.family);
    const matchingAddresses = resolvedAddresses.filter((entry) => requestedFamily === 0 || entry.family === requestedFamily);
    if (matchingAddresses.length === 0) {
      callback(createPinnedLookupError(requestedHostname, requestedFamily), '', requestedFamily);
      return;
    }

    if (wantsAll) {
      callback(null, matchingAddresses);
      return;
    }

    const selectedAddress = matchingAddresses[0];
    if (!selectedAddress) {
      callback(createPinnedLookupError(requestedHostname, requestedFamily), '', requestedFamily);
      return;
    }

    callback(null, selectedAddress.address, selectedAddress.family);
  };
}

function toFetchHeaders(headers: IncomingHttpHeaders): Headers {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        normalized.append(key, entry);
      }
      continue;
    }
    normalized.set(key, value);
  }
  return normalized;
}

async function requestPinnedRemoteUrl(target: ValidatedRemoteUrl): Promise<RemoteFetchResponse> {
  const requestImpl = target.url.protocol === 'https:' ? httpsRequest : httpRequest;
  const targetUrl = target.url.toString();

  return new Promise((resolve, reject) => {
    const requestOptions: PinnedRequestOptions = {
      headers: {
        Accept: 'text/html, text/plain, text/markdown, application/json, text/csv;q=0.9, */*;q=0.1',
        'Accept-Encoding': 'identity',
      },
      lookup: createPinnedLookup(target.hostname, target.resolvedAddresses),
      timeout: SUMMARIZE_URL_FETCH_TIMEOUT_MS,
    };

    if (target.url.protocol === 'https:') {
      requestOptions.servername = target.hostname;
    }

    const request = requestImpl(target.url, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      const declaredLength = parseContentLengthHeader(response.headers['content-length']);
      let totalBytes = 0;

      if (declaredLength !== null && declaredLength > MAX_SUMMARIZE_URL_RESPONSE_BYTES) {
        response.resume();
        reject(createUrlFetchTooLargeError(targetUrl, declaredLength));
        return;
      }

      response.on('data', (chunk: Buffer | string) => {
        const normalizedChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += normalizedChunk.length;
        if (totalBytes > MAX_SUMMARIZE_URL_RESPONSE_BYTES) {
          response.destroy(createUrlFetchTooLargeError(targetUrl, totalBytes));
          return;
        }
        chunks.push(normalizedChunk);
      });
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: toFetchHeaders(response.headers),
          url: targetUrl,
          body: Buffer.concat(chunks, totalBytes).toString('utf-8'),
        });
      });
      response.on('error', reject);
    });

    request.on('timeout', () => {
      request.destroy(createUrlFetchTimeoutError(target.url.toString()));
    });
    request.on('error', reject);
    request.end();
  });
}

async function fetchWithValidatedRedirects(
  input: RawInput,
  initialUrl: ValidatedRemoteUrl,
): Promise<RemoteFetchResponse> {
  let currentUrl = initialUrl;

  for (let redirectCount = 0; redirectCount <= MAX_FETCH_REDIRECTS; redirectCount++) {
    let response: RemoteFetchResponse;
    try {
      response = await requestPinnedRemoteUrl(currentUrl);
    } catch (error) {
      throwIfUrlFetchTimedOut(input, error);
    }

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    if (!location) {
      return response;
    }

    if (redirectCount === MAX_FETCH_REDIRECTS) {
      throw new Error(`Too many redirects for summarize URL: ${input.value}`);
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl.url);
    } catch {
      throw new Error(`Invalid redirect target for summarize URL: ${location}`);
    }

    currentUrl = await validateRemoteUrl(nextUrl.toString());
  }

  throw new Error(`Too many redirects for summarize URL: ${input.value}`);
}

async function parseUrl(input: RawInput): Promise<ParsedContent> {
  const parsedUrl = await validateRemoteUrl(input.value);
  const response = await fetchWithValidatedRedirects(input, parsedUrl);

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch URL (${response.status} ${response.statusText}): ${input.value}`);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const responseUrl = response.url || parsedUrl.url.toString();
  const inferredFormat = inferRemoteFormat(responseUrl, input.formatHint, contentType);
  if (!TEXTUAL_FORMATS.has(inferredFormat)) {
    throw new Error(`Unsupported remote format for summarize: ${inferredFormat || 'unknown'}`);
  }
  if (contentType && !isTextualContentType(contentType) && !inferredFormat) {
    throw new Error(`Unsupported remote content type for summarize: ${contentType}`);
  }

  const raw = response.body;
  const markdown = [
    `[Source URL](${input.value})`,
    renderRawAsMarkdown(raw, inferredFormat || 'txt'),
  ].filter((section) => section.trim().length > 0).join('\n\n');

  return buildParsedContent(input, markdown);
}

async function parseArchive(input: RawInput): Promise<ParsedContent> {
  const format = getFormat(input.value, input.formatHint);
  if (!ARCHIVE_EXTENSIONS.has(format)) {
    throw new Error(`Unsupported archive format: ${format || 'unknown'}`);
  }

  const raw = await readFile(input.value);
  const archive = await JSZip.loadAsync(raw);
  const entries = Object.values(archive.files)
    .filter((entry) => !entry.dir && !shouldSkipArchiveEntry(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  const parsedSections: string[] = [];
  const skippedEntries: string[] = [];

  for (const entry of entries) {
    const buffer = await entry.async('nodebuffer');
    if (looksBinary(buffer)) {
      skippedEntries.push(`${entry.name} (binary)`);
      continue;
    }

    const ext = getFormat(entry.name);
    const markdown = renderRawAsMarkdown(UTF8_DECODER.decode(buffer).replace(/^\uFEFF/, ''), ext || 'txt');
    if (!markdown) continue;

    parsedSections.push(renderArchiveSection(entry.name, markdown));
  }

  const sections: string[] = [`# Archive: ${basename(input.value)}`];

  if (parsedSections.length > 0) {
    sections.push(...parsedSections);
  } else {
    sections.push('No text-like files were found in this archive.');
  }

  if (skippedEntries.length > 0) {
    sections.push(`## Skipped files\n\n${skippedEntries.map((entry) => `- ${entry}`).join('\n')}`);
  }

  return buildParsedContent(input, sections.join('\n\n'));
}

const PARSERS: Record<string, (input: RawInput) => Promise<ParsedContent>> = {
  text: parseText,
  file: parseFile,
  url: parseUrl,
  archive: parseArchive,
};

export async function parseInput(input: RawInput): Promise<ParsedContent> {
  const normalizedInput = normalizeRawInput(input);
  const parser = PARSERS[normalizedInput.kind];
  if (!parser) {
    throw new Error(`Unsupported input kind: ${normalizedInput.kind}`);
  }
  return parser(normalizedInput);
}

export async function parseInputs(inputs: RawInput[]): Promise<ParsedContent[]> {
  return Promise.all(inputs.map(parseInput));
}

function inferFormatFromContentType(contentType: string): string {
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) return 'html';
  if (contentType.includes('text/markdown')) return 'md';
  if (contentType.includes('text/csv') || contentType.includes('application/csv')) return 'csv';
  if (contentType.includes('application/json') || contentType.includes('application/ld+json')) return 'json';
  if (contentType.includes('text/plain')) return 'txt';
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) return 'txt';
  return '';
}

function inferRemoteFormat(url: string, formatHint: string | undefined, contentType: string): string {
  const contentTypeFormat = inferFormatFromContentType(contentType);
  if (contentTypeFormat) return contentTypeFormat;
  try {
    return getFormat(new URL(url).pathname, formatHint);
  } catch {
    return getFormat(url, formatHint);
  }
}

function isTextualContentType(contentType: string): boolean {
  return TEXTUAL_CONTENT_TYPES.some((allowed) => contentType.includes(allowed));
}

function shouldSkipArchiveEntry(entryName: string): boolean {
  return SKIPPED_ARCHIVE_ENTRY_PATTERNS.some((pattern) => pattern.test(entryName));
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 1024));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }

  return sample.length > 0 && suspicious / sample.length > 0.1;
}

function hasMarkdownHeadings(markdown: string): boolean {
  return /^#{1,3}\s+/m.test(markdown);
}

function renderArchiveSection(entryName: string, markdown: string): string {
  if (hasMarkdownHeadings(markdown)) {
    return `> File: \`${entryName}\`\n\n${markdown}`;
  }
  return `## ${entryName}\n\n${markdown}`;
}

export { MAX_SUMMARIZE_URL_RESPONSE_BYTES, countWords, countParagraphs, detectLang };
