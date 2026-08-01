/**
 * Slidev presentation engine — public API.
 * Slidev (`slides.md`) is the PPT source-of-truth; HTML/pptxgenjs remains legacy.
 */
export {
  renderSlidevSource,
  renderSlidesMd,
  previewHtmlFromSource,
  previewHtmlFromSlidesMd,
  imageElementHtml,
  deckHasClicks,
  SLIDES_MD,
  STYLES_PATH,
  COMPONENTS_DIR,
} from './generate.js';

export {
  buildSlidevSourceMap,
  semanticNodesFromMap,
  lookupSlidevNode,
  slideIndexAtOffset,
  type SlidevSourceMap,
  type SlidevSourceMapEntry,
} from './sourcemap.js';

export {
  applySlidevEditIntent,
  insertImageIntoSlideMarkdown,
  setDeckAccentInFrontmatter,
  recolorColorCardImages,
  deckTextReplace,
  collectDeckTextNodes,
} from './edit.js';
export { parseSlidevDeck, listSlidevNodeIds, type ParsedSlidevDeck } from './parse.js';

export {
  hasSlidevCli,
  resolveSlidevBin,
  slidevPlaywrightEnv,
  runSlidev,
  slidevBuild,
  slidevExport,
  slidevExportPptx,
  cleanupSlidevWorkDir,
  slidevInstallHint,
  type SlidevBuildResult,
  type SlidevRunResult,
} from './cli.js';
