/**
 * Presenton integration — AI-driven presentation generation via self-hosted Presenton API.
 *
 * Presenton runs as a Docker service (FastAPI + Next.js) with Ollama for LLM.
 * This adapter wraps Presenton's /api/v1/ppt endpoints for AutoOffice consumption.
 */

const DEFAULT_PRESENTON_URL = 'http://127.0.0.1:5000';

function baseUrl(): string {
  return process.env.PRESENTON_URL ?? DEFAULT_PRESENTON_URL;
}

export interface PresentonGenerateInput {
  prompt: string;
  numSlides?: number;
  tone?: 'professional' | 'casual' | 'academic' | 'creative';
  language?: 'en' | 'zh';
}

export interface PresentonExportResult {
  pptxPath: string;
  pdfPath?: string;
  presentationId: string;
}

export interface PresentonHealthStatus {
  available: boolean;
  version?: string;
  llmProvider?: string;
  error?: string;
}

async function fetchPresenton(path: string, options?: RequestInit): Promise<Response> {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  return res;
}

export async function checkPresentonHealth(): Promise<PresentonHealthStatus> {
  try {
    const res = await fetchPresenton('/api/v1/ppt/presentation/all', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { available: true };
    }
    return { available: false, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { available: false, error: msg };
  }
}

/**
 * Generate a presentation via Presenton's AI engine.
 * Returns the presentation ID for subsequent export.
 */
export async function generatePresentation(
  input: PresentonGenerateInput,
): Promise<{ presentationId: string }> {
  const res = await fetchPresenton('/api/v1/ppt/presentation/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: input.prompt,
      n_slides: input.numSlides ?? 8,
      language: input.language === 'zh' ? 'Chinese' : 'English',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Presenton generate failed: ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { presentation_path?: string; edit_path?: string };
  const idMatch = data.presentation_path?.match(/\/([^/]+)$/);
  const presentationId = idMatch?.[1] ?? '';
  if (!presentationId) {
    throw new Error('Presenton returned no presentation ID');
  }
  return { presentationId };
}

/**
 * Export a Presenton presentation to .pptx format.
 * Returns the binary buffer of the PPTX file.
 */
export async function exportPptx(presentationId: string): Promise<Buffer> {
  const res = await fetchPresenton('/api/v1/ppt/presentation/export/pptx', {
    method: 'POST',
    body: JSON.stringify({ presentation_id: presentationId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Presenton export failed: ${res.status} — ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as string;
  const pptxPath = data;

  const fileRes = await fetchPresenton(`/api/v1/ppt/files/exports/${presentationId}.pptx`, {
    method: 'GET',
  });

  if (!fileRes.ok) {
    throw new Error(`Failed to download PPTX: ${fileRes.status}`);
  }

  const arrayBuffer = await fileRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Full pipeline: generate + export to PPTX buffer.
 */
export async function generateAndExportPptx(
  input: PresentonGenerateInput,
): Promise<{ buffer: Buffer; presentationId: string }> {
  const { presentationId } = await generatePresentation(input);
  const buffer = await exportPptx(presentationId);
  return { buffer, presentationId };
}
