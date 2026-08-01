/**
 * Express routes for the AutoOffice document IDE engine (`/api/engine/*`)
 * and static hosting of the three-pane AOIDE UI (`/aoide/*`).
 */
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  EngineNotFoundError,
  EngineValidationError,
  getEngineService,
} from './service.js';
import { StaleBaseError } from './revisions.js';

const publicRoot = fileURLToPath(new URL('../../public/aoide', import.meta.url));

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

function jsonError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, error: { code, message } });
}

function paramId(value: string | string[] | undefined): string {
  if (value === undefined) return '';
  return Array.isArray(value) ? value[0]! : value;
}

function handleEngineError(err: unknown, res: Response): boolean {
  if (err instanceof EngineNotFoundError) {
    jsonError(res, 404, err.code, err.message);
    return true;
  }
  if (err instanceof EngineValidationError) {
    jsonError(res, 400, err.code, err.message);
    return true;
  }
  if (err instanceof StaleBaseError) {
    jsonError(res, 409, 'stale_base', err.message);
    return true;
  }
  return false;
}

export function mountEngineRoutes(app: Express): void {
  const base = '/api/engine';

  app.get(`${base}/projects`, asyncHandler(async (_req, res) => {
    const svc = getEngineService();
    const projects = await svc.listProjects();
    res.json({ ok: true, projects });
  }));

  app.post(`${base}/projects`, asyncHandler(async (req, res) => {
    const { name, kind } = req.body as { name?: string; kind?: 'pdf' | 'presentation' };
    if (!name?.trim()) {
      jsonError(res, 400, 'invalid_name', 'name is required');
      return;
    }
    const svc = getEngineService();
    res.status(201).json({ ok: true, ...(await svc.createProject(name.trim(), kind === 'presentation' ? 'presentation' : 'pdf')) });
  }));

  // App entry: one-click "topic → full editable deck" (#1 button). Optionally
  // grounded by an outline + authoritative guidance + pre-chosen images, and may
  // allow LaTeX formulas (rendered as MathML). Returns the deck + a data-rigor
  // grounding report so the UI can flag numbers with no source.
  app.post(`${base}/decks`, asyncHandler(async (req, res) => {
    const body = req.body as {
      topic?: string;
      name?: string;
      research?: string;
      outline?: string;
      guidance?: string;
      formulas?: boolean;
      animate?: boolean;
      slides?: number;
      images?: { slide?: number; src: string; alt?: string }[];
    };
    if (!body?.topic?.trim()) {
      jsonError(res, 400, 'invalid_topic', 'topic is required');
      return;
    }
    const svc = getEngineService();
    const images = Array.isArray(body.images)
      ? body.images.filter((i) => i && typeof i.src === 'string' && i.src.trim()).slice(0, 12)
      : undefined;
    const slides = Number.isFinite(body.slides) ? Math.min(12, Math.max(4, Number(body.slides))) : undefined;
    res.status(201).json({
      ok: true,
      ...(await svc.createDeckFromTopic(
        String(body.name ?? body.topic).trim().slice(0, 60),
        body.topic.trim(),
        typeof body.research === 'string' ? body.research : '',
        {
          outline: typeof body.outline === 'string' ? body.outline : undefined,
          guidance: typeof body.guidance === 'string' ? body.guidance : undefined,
          allowFormulas: !!body.formulas,
          animate: !!body.animate,
          slides,
          images,
        },
      )),
    });
  }));

  app.get(`${base}/projects/:id/overview`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.getOverview(paramId(req.params.id))) });
  }));

  app.post(`${base}/projects/:id/requirements`, asyncHandler(async (req, res) => {
    const text = String((req.body as { text?: string }).text ?? '');
    if (!text.trim()) {
      jsonError(res, 400, 'invalid_text', 'text is required');
      return;
    }
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.postRequirement(paramId(req.params.id), text)) });
  }));

  app.get(`${base}/projects/:id/events`, asyncHandler(async (req, res) => {
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    const svc = getEngineService();
    const events = await svc.getEvents(paramId(req.params.id), since);
    res.json({ ok: true, events });
  }));

  app.post(`${base}/projects/:id/annotations`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.status(201).json({ ok: true, ...(await svc.createAnnotation(paramId(req.params.id), req.body)) });
  }));

  app.post(`${base}/projects/:id/images`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.status(201).json({ ok: true, ...(await svc.addImageElement(paramId(req.params.id), req.body)) });
  }));

  app.post(`${base}/projects/:id/undo`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    const result = await svc.undo(paramId(req.params.id));
    if (!result) {
      jsonError(res, 409, 'nothing_to_undo', 'Undo stack empty');
      return;
    }
    res.json({ ok: true, ...result });
  }));

  app.post(`${base}/projects/:id/redo`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    const result = await svc.redo(paramId(req.params.id));
    if (!result) {
      jsonError(res, 409, 'nothing_to_redo', 'Redo stack empty');
      return;
    }
    res.json({ ok: true, ...result });
  }));

  app.get(`${base}/tasks/:id`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.json({ ok: true, task: await svc.getTask(paramId(req.params.id)) });
  }));

  app.post(`${base}/tasks/:id/cancel`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.json({ ok: true, task: await svc.cancelTask(paramId(req.params.id)) });
  }));

  app.post(`${base}/proposals/:id/choose`, asyncHandler(async (req, res) => {
    const optionId = String((req.body as { optionId?: string }).optionId ?? '');
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.chooseProposal(paramId(req.params.id), optionId)) });
  }));

  app.get(`${base}/revisions/:id/render`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    const { buffer, mime } = await svc.getRevisionRender(paramId(req.params.id));
    res.setHeader('Content-Type', mime);
    res.send(buffer);
  }));

  app.get(`${base}/revisions/:id/boxes`, asyncHandler(async (req, res) => {
    const page = Number.parseInt(String(req.query.page ?? '1'), 10);
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.getBoxes(paramId(req.params.id), page)) });
  }));

  app.get(`${base}/revisions/:id/diff`, asyncHandler(async (req, res) => {
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.getDiff(paramId(req.params.id))) });
  }));

  app.get(`${base}/projects/:id/export`, asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? 'pdf') as 'html' | 'pdf' | 'pptx';
    // `?clicks=1` forces per-click-step export for animated decks (auto-on when the deck has v-click).
    const withClicks = ['1', 'true', 'yes'].includes(String(req.query.clicks ?? '').toLowerCase());
    const svc = getEngineService();
    const { buffer, mime, filename } = await svc.exportProject(paramId(req.params.id), format, { withClicks });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  }));

  app.get(`${base}/standards/profiles`, asyncHandler(async (_req, res) => {
    const svc = getEngineService();
    res.json({ ok: true, profiles: svc.listStandardProfiles() });
  }));

  app.put(`${base}/projects/:id/standard-profile`, asyncHandler(async (req, res) => {
    const profileId = String((req.body as { profileId?: string }).profileId ?? '');
    const svc = getEngineService();
    res.json({ ok: true, ...(await svc.setStandardProfile(paramId(req.params.id), profileId)) });
  }));

  app.use(`${base}`, (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    if (handleEngineError(err, res)) return;
    const message = err instanceof Error ? err.message : String(err);
    jsonError(res, 500, 'engine_error', message);
  });

  app.use('/aoide', express.static(publicRoot));
}
