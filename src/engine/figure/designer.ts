/**
 * Designer — text + optional sketch → DesignSpec via an injected interpreter.
 *
 * PolarPrivate / VLM stays outside this module: production wires an
 * interpreter; tests inject a deterministic double. This file never
 * generates pictures and never copies sketch bytes onto the spec as a
 * raster (or any other object). Page geometry is fail-closed at
 * {@link FIGURE_PAGE_WIDTH} × {@link FIGURE_PAGE_HEIGHT}.
 */

import {
  FIGURE_PAGE,
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
  type DesignSpec,
  type FigureInterpretInput,
  type FigureInterpreter,
} from './types.js';

export {
  FIGURE_PAGE,
  FIGURE_PAGE_HEIGHT,
  FIGURE_PAGE_WIDTH,
};

export type {
  DesignSpec,
  FigureInterpretInput,
  FigureInterpreter,
  FigureObjectSpec,
  FigurePanelSpec,
  FigureSketch,
} from './types.js';

export class DesignSpecPageError extends Error {
  readonly pageWidth: unknown;
  readonly pageHeight: unknown;

  constructor(pageWidth: unknown, pageHeight: unknown) {
    super(
      `DesignSpec page must be ${FIGURE_PAGE_WIDTH}×${FIGURE_PAGE_HEIGHT}; got ${String(pageWidth)}×${String(pageHeight)}`,
    );
    this.name = 'DesignSpecPageError';
    this.pageWidth = pageWidth;
    this.pageHeight = pageHeight;
  }
}

function readPageDim(spec: object, key: 'pageWidth' | 'pageHeight'): unknown {
  return key in spec ? (spec as Record<typeof key, unknown>)[key] : undefined;
}

/**
 * Fail-closed page lock. Accepts untrusted interpreter output.
 * Does not mutate `spec` and does not inspect sketch bytes.
 */
export function assertDesignSpecPage(spec: unknown): asserts spec is {
  pageWidth: typeof FIGURE_PAGE_WIDTH;
  pageHeight: typeof FIGURE_PAGE_HEIGHT;
} {
  if (spec === null || typeof spec !== 'object') {
    throw new DesignSpecPageError(undefined, undefined);
  }
  const pageWidth = readPageDim(spec, 'pageWidth');
  const pageHeight = readPageDim(spec, 'pageHeight');
  if (pageWidth !== FIGURE_PAGE_WIDTH || pageHeight !== FIGURE_PAGE_HEIGHT) {
    throw new DesignSpecPageError(pageWidth, pageHeight);
  }
}

export async function designSpecFromInput(
  input: FigureInterpretInput,
  interpreter: FigureInterpreter,
): Promise<DesignSpec> {
  const spec = await interpreter.interpret(input);
  assertDesignSpecPage(spec);
  return spec;
}
