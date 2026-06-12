/**
 * Phase 12: External tool integration layer.
 * Detects and uses external automation tools when available:
 * - OfficeCLI: Native Word/Excel/PPT manipulation for AI agents
 * - PPT Master: PDF/URL/Markdown → native PPTX conversion
 * - Presenton: Brand-aware AI presentation generation
 *
 * Falls back to built-in engines when external tools unavailable.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ToolStatus {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
}

export interface ExternalToolsReport {
  tools: ToolStatus[];
  recommendedPptEngine: 'built-in' | 'officecli' | 'ppt-master' | 'presenton';
  recommendedDocxEngine: 'built-in' | 'officecli';
}

export type ExternalEngineId =
  | 'built-in'
  | 'officecli'
  | 'ppt-master'
  | 'presenton'
  | 'pandoc'
  | 'libreoffice';

export interface FormatSupportRecommendation {
  format: 'pptx' | 'docx' | 'pdf';
  recommendedEngine: ExternalEngineId;
  availableExternalEngines: ExternalEngineId[];
  note: string;
}

export interface ConversionPath {
  input: 'markdown' | 'html' | 'docx' | 'pptx';
  output: 'docx' | 'pdf';
  engine: 'pandoc' | 'libreoffice';
  available: boolean;
}

export interface ExternalToolsSummary extends ExternalToolsReport {
  formatSupport: FormatSupportRecommendation[];
  conversionPaths: ConversionPath[];
}

async function checkTool(name: string, commands: string[], args: string[]): Promise<ToolStatus> {
  for (const cmd of commands) {
    try {
      const { stdout } = await execFileAsync(cmd, args, { timeout: 5000 });
      return { name, available: true, version: stdout.trim().split('\n')[0], path: cmd };
    } catch {
      // Continue through absolute-path fallbacks; services often run with a minimal PATH.
    }
  }
  return { name, available: false };
}

/**
 * Detect all available external office automation tools.
 */
export async function detectExternalTools(): Promise<ExternalToolsReport> {
  const checks = await Promise.allSettled([
    checkTool('OfficeCLI', ['officecli', '~/.local/bin/officecli'], ['--version']),
    checkTool('PPT Master', ['ppt-master', '~/.local/bin/ppt-master'], ['--version']),
    checkTool('Presenton', ['presenton', '~/.local/bin/presenton'], ['--version']),
    checkTool('LibreOffice', ['soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'], ['--version']),
    checkTool('Pandoc', ['pandoc', '/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc'], ['--version']),
  ]);

  const tools: ToolStatus[] = checks.map((r) =>
    r.status === 'fulfilled' ? r.value : { name: 'unknown', available: false },
  );

  const officecli = tools.find((t) => t.name === 'OfficeCLI' && t.available);
  const pptMaster = tools.find((t) => t.name === 'PPT Master' && t.available);
  const presenton = tools.find((t) => t.name === 'Presenton' && t.available);

  let recommendedPptEngine: ExternalToolsReport['recommendedPptEngine'] = 'built-in';
  if (presenton) recommendedPptEngine = 'presenton';
  else if (pptMaster) recommendedPptEngine = 'ppt-master';
  else if (officecli) recommendedPptEngine = 'officecli';

  let recommendedDocxEngine: ExternalToolsReport['recommendedDocxEngine'] = 'built-in';
  if (officecli) recommendedDocxEngine = 'officecli';

  return { tools, recommendedPptEngine, recommendedDocxEngine };
}

function hasTool(report: ExternalToolsReport, name: string): boolean {
  return report.tools.some((tool) => tool.name === name && tool.available);
}

/**
 * Build a higher-level summary that CLI/API surfaces can expose directly.
 */
export async function buildExternalToolsSummary(
  report?: ExternalToolsReport,
): Promise<ExternalToolsSummary> {
  const resolvedReport = report ?? await detectExternalTools();

  const officecli = hasTool(resolvedReport, 'OfficeCLI');
  const pptMaster = hasTool(resolvedReport, 'PPT Master');
  const presenton = hasTool(resolvedReport, 'Presenton');
  const libreOffice = hasTool(resolvedReport, 'LibreOffice');
  const pandoc = hasTool(resolvedReport, 'Pandoc');

  const formatSupport: FormatSupportRecommendation[] = [
    {
      format: 'pptx',
      recommendedEngine: resolvedReport.recommendedPptEngine,
      availableExternalEngines: [
        ...(presenton ? ['presenton' as const] : []),
        ...(pptMaster ? ['ppt-master' as const] : []),
        ...(officecli ? ['officecli' as const] : []),
      ],
      note: 'Built-in python-pptx remains the default; external deck generators are optional accelerators.',
    },
    {
      format: 'docx',
      recommendedEngine: resolvedReport.recommendedDocxEngine,
      availableExternalEngines: [
        ...(officecli ? ['officecli' as const] : []),
        ...(pandoc ? ['pandoc' as const] : []),
      ],
      note: 'OfficeCLI is the native editor path; Pandoc is useful for HTML/Markdown conversion workflows.',
    },
    {
      format: 'pdf',
      recommendedEngine: 'built-in',
      availableExternalEngines: [
        ...(libreOffice ? ['libreoffice' as const] : []),
        ...(pandoc ? ['pandoc' as const] : []),
      ],
      note: 'Built-in WeasyPrint is the primary PDF engine; LibreOffice/Pandoc are best treated as conversion helpers.',
    },
  ];

  const conversionPaths: ConversionPath[] = [
    { input: 'markdown', output: 'docx', engine: 'pandoc', available: pandoc },
    { input: 'html', output: 'docx', engine: 'pandoc', available: pandoc },
    { input: 'docx', output: 'pdf', engine: 'libreoffice', available: libreOffice },
    { input: 'pptx', output: 'pdf', engine: 'libreoffice', available: libreOffice },
  ];

  return {
    ...resolvedReport,
    formatSupport,
    conversionPaths,
  };
}

/**
 * Convert a file using Pandoc (widely available document converter).
 * Supports: md→docx, md→pdf, html→docx, etc.
 */
export async function convertWithPandoc(
  inputPath: string,
  outputPath: string,
  options: { from?: string; to?: string } = {},
): Promise<boolean> {
  try {
    const args = [inputPath, '-o', outputPath];
    if (options.from) args.push('-f', options.from);
    if (options.to) args.push('-t', options.to);

    await execFileAsync('pandoc', args, { timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a document using LibreOffice headless mode.
 * Useful for docx→pdf, pptx→pdf conversions.
 */
export async function convertWithLibreOffice(
  inputPath: string,
  outputDir: string,
  targetFormat: string = 'pdf',
): Promise<boolean> {
  try {
    await execFileAsync('soffice', [
      '--headless',
      '--convert-to', targetFormat,
      '--outdir', outputDir,
      inputPath,
    ], { timeout: 60000 });
    return true;
  } catch {
    return false;
  }
}
