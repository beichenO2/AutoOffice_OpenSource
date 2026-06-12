import type {
  PptxDeckPayload,
  SlideDeckValidationResult,
  SlideValidationIssue,
} from './types.js';
import { isPptxThemeId } from './types.js';

/** 单页最大要点数（与 Phase 2 产品约束一致） */
export const MAX_BULLETS_PER_SLIDE = 6;

/** 标题建议最大字符数（过长的标题在投影上难读） */
export const MAX_TITLE_CHARS = 80;

/** 单条要点建议上限（过长在幻灯片上难扫读） */
export const MAX_BULLET_CHARS = 200;

const PPTX_LOCALES = ['zh-CN', 'en-US'] as const;

function push(
  issues: SlideValidationIssue[],
  slideIndex: number,
  severity: SlideValidationIssue['severity'],
  code: string,
  message: string,
): void {
  issues.push({ severity, slideIndex, code, message });
}

function validateSlide(
  slide: { title: string; bullets: string[] },
  index: number,
  issues: SlideValidationIssue[],
): void {
  const title = slide.title?.trim() ?? '';
  if (!title) {
    push(issues, index, 'warning', 'title.missing', '该页缺少标题，不利于观众跟随结构。');
  }
  if (title.length > MAX_TITLE_CHARS) {
    push(issues, index, 'warning', 'title.too_long', `标题过长（>${MAX_TITLE_CHARS} 字），建议缩短。`);
  }

  const bullets = slide.bullets ?? [];
  if (bullets.length > MAX_BULLETS_PER_SLIDE) {
    push(
      issues,
      index,
      'error',
      'bullets.too_many',
      `单页要点数为 ${bullets.length}，超过上限 ${MAX_BULLETS_PER_SLIDE}。请拆页或合并。`,
    );
  }

  bullets.forEach((t, bi) => {
    const s = t?.trim() ?? '';
    if (!s) {
      push(issues, index, 'error', 'bullet.empty', `第 ${bi + 1} 条要点为空。`);
    } else if (s.length > MAX_BULLET_CHARS) {
      push(
        issues,
        index,
        'warning',
        'bullet.too_long',
        `第 ${bi + 1} 条要点过长（>${MAX_BULLET_CHARS} 字），建议拆成两条或缩短。`,
      );
    }
  });
}

/**
 * 校验幻灯片结构化数据是否符合排版与信息密度约束。
 * 在调用 python-pptx 等生成器之前调用，可避免劣质版式进入导出环节。
 */
export function validatePptxPayload(deck: PptxDeckPayload): SlideDeckValidationResult {
  const issues: SlideValidationIssue[] = [];

  if (!isPptxThemeId(deck.theme)) {
    push(
      issues,
      -1,
      'error',
      'meta.theme.invalid',
      `theme 须为 PPTX_THEME_IDS 中之一，当前为 ${String(deck.theme)}。`,
    );
  }

  if (!PPTX_LOCALES.includes(deck.locale as (typeof PPTX_LOCALES)[number])) {
    push(
      issues,
      -1,
      'error',
      'meta.locale.invalid',
      `locale 须为 zh-CN 或 en-US，当前为 ${String(deck.locale)}。`,
    );
  }

  if (!deck.title?.trim()) {
    push(issues, -1, 'error', 'meta.title.missing', '演示文稿总标题不能为空。');
  }

  if (!deck.slides?.length) {
    push(issues, -1, 'error', 'slides.empty', '至少需要一张幻灯片。');
    return { ok: false, issues };
  }

  deck.slides.forEach((slide, i) => {
    validateSlide(slide, i, issues);
  });

  const hasError = issues.some((x) => x.severity === 'error');
  return { ok: !hasError, issues };
}
