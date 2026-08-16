/**
 * Scientific-figure pipeline: Designer → Drawer → Audit → persist .drawio.
 *
 * Empty / whitespace prompt is the only pipeline throw for bad input.
 * Audit always runs; a full-page raster spec returns with hardCount > 0.
 * Interpreter output that fails the DesignSpec contract gets an extra hard
 * finding — never a silent blank-box pass. This module never calls an
 * image-generation API and never pastes sketch bytes.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv from 'ajv';
import { engineStoreRoot, projectRoot } from '../config.js';
import { auditDrawioXml } from './audit.js';
import { designSpecFromInput } from './designer.js';
import { drawioFromSpec } from './drawer.js';
import { defaultFigureInterpreter } from './polar-interpreter.js';
import type { CreateFigureFn, DesignSpec, FigureAuditResult, FigureResult } from './types.js';

function loadDesignSpecValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const schema = JSON.parse(
    readFileSync(join(projectRoot(), 'contracts', 'figure.schema.json'), 'utf-8'),
  ) as object;
  ajv.addSchema(schema);
  return ajv.compile({ $ref: 'autooffice/figure#/definitions/DesignSpec' });
}

const validateDesignSpec = loadDesignSpecValidator();

function applyDesignSpecContract(spec: DesignSpec, audit: FigureAuditResult): FigureAuditResult {
  if (validateDesignSpec(spec)) return audit;
  const detail =
    validateDesignSpec.errors
      ?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
      .join('; ') ?? 'invalid DesignSpec';
  return {
    ok: false,
    hardCount: audit.hardCount + 1,
    findings: [
      ...audit.findings,
      {
        category: 'invalid-design-spec',
        severity: 'hard',
        message: `DesignSpec failed contract validation: ${detail}`,
      },
    ],
  };
}

export const createFigure: CreateFigureFn = async (request, options): Promise<FigureResult> => {
  const trimmed = typeof request.prompt === 'string' ? request.prompt.trim() : '';
  if (!trimmed) {
    throw new Error('prompt is required and must be non-empty');
  }

  const interpreter = options?.interpreter ?? defaultFigureInterpreter();
  const sketch = request.sketch;
  const designSpec = await designSpecFromInput({ prompt: trimmed, sketch }, interpreter);
  const drawioXml = drawioFromSpec(designSpec);
  const audit = applyDesignSpecContract(designSpec, auditDrawioXml(drawioXml));

  const outputDir = options?.outputDir ?? join(engineStoreRoot(), 'figures');
  await mkdir(outputDir, { recursive: true });
  const figureId = randomUUID();
  const drawioPath = join(outputDir, `${figureId}.drawio`);
  await writeFile(drawioPath, drawioXml, 'utf-8');

  return { figureId, designSpec, drawioXml, drawioPath, audit };
};
