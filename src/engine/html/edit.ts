/**
 * Apply a schema-validated EditIntent to deck HTML via jsdom. Scope is enforced
 * two ways: (1) every op must target an allowed node id; (2) after applying, any
 * node that is not a target, ancestor, or descendant of a target must be byte
 * identical — otherwise the edit is rejected as collateral damage.
 */
import { JSDOM } from 'jsdom';
import type { EditIntent, EditOp } from '../types.js';
import { outerHtmlMap } from './dom.js';

export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

export interface CollateralReport {
  ok: boolean;
  unexpectedChanged: string[];
  unexpectedRemoved: string[];
  unexpectedAdded: string[];
}

export interface EditResult {
  html: string;
  changedNodeIds: string[];
  patchSummary: string;
  collateral: CollateralReport;
}

function collectAffected(doc: Document, targetIds: string[]): Set<string> {
  const affected = new Set<string>(targetIds);
  for (const tid of targetIds) {
    const el = doc.querySelector(`[data-ao-id="${cssEscape(tid)}"]`);
    if (!el) continue;
    for (const d of Array.from(el.querySelectorAll('[data-ao-id]'))) {
      const id = d.getAttribute('data-ao-id');
      if (id) affected.add(id);
    }
    let p: Element | null = el.parentElement ? el.parentElement.closest('[data-ao-id]') : null;
    while (p) {
      const id = p.getAttribute('data-ao-id');
      if (id) affected.add(id);
      p = p.parentElement ? p.parentElement.closest('[data-ao-id]') : null;
    }
  }
  return affected;
}

function cssEscape(id: string): string {
  return id.replace(/["\\]/g, '\\$&');
}

function applyOp(doc: Document, op: EditOp, affected: Set<string>): void {
  const el = doc.querySelector(`[data-ao-id="${cssEscape(op.nodeId)}"]`);
  if (!el) throw new ScopeViolationError(`Target node not found: ${op.nodeId}`);
  switch (op.op) {
    case 'replaceText': {
      el.textContent = String(op.payload.text ?? '');
      return;
    }
    case 'setStyle': {
      const style = (op.payload.style ?? {}) as Record<string, string>;
      const htmlEl = el as unknown as { style: CSSStyleDeclaration };
      for (const [k, v] of Object.entries(style)) htmlEl.style.setProperty(k, String(v));
      return;
    }
    case 'setAttr': {
      const attrs = (op.payload.attrs ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'data-ao-id' || k === 'data-ao-type') {
          throw new ScopeViolationError(`Refusing to mutate identity attribute ${k}`);
        }
        el.setAttribute(k, String(v));
      }
      return;
    }
    case 'remove': {
      el.remove();
      return;
    }
    case 'insertAfter':
    case 'insertBefore': {
      const newId = String(op.payload.newId ?? '');
      const raw = String(op.payload.html ?? '');
      if (!newId) throw new ScopeViolationError('insert requires payload.newId');
      const frag = JSDOM.fragment(raw);
      const first = frag.firstElementChild;
      if (!first) throw new ScopeViolationError('insert requires element html');
      first.setAttribute('data-ao-id', newId);
      if (op.op === 'insertAfter') el.after(first);
      else el.before(first);
      affected.add(newId);
      return;
    }
    case 'wrap':
    case 'replaceSource': {
      const raw = String(op.payload.html ?? '');
      const frag = JSDOM.fragment(raw);
      const first = frag.firstElementChild;
      if (!first) throw new ScopeViolationError('replaceSource requires element html');
      first.setAttribute('data-ao-id', op.nodeId);
      el.replaceWith(first);
      return;
    }
  }
}

export function applyEditIntent(html: string, intent: EditIntent): EditResult {
  const allowed = new Set(intent.allowedNodeIds);
  for (const op of intent.operations) {
    if (!allowed.has(op.nodeId)) {
      throw new ScopeViolationError(
        `Op on ${op.nodeId} is outside allowedNodeIds [${intent.allowedNodeIds.join(', ')}]`,
      );
    }
  }

  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const targetIds = Array.from(new Set(intent.operations.map((o) => o.nodeId)));
  for (const id of targetIds) {
    if (!doc.querySelector(`[data-ao-id="${cssEscape(id)}"]`)) {
      throw new ScopeViolationError(`Target node not found: ${id}`);
    }
  }

  const beforeMap = outerHtmlMap(html);
  const affected = collectAffected(doc, targetIds);

  const changed = new Set<string>();
  for (const op of intent.operations) {
    applyOp(doc, op, affected);
    changed.add(op.nodeId);
  }

  const newHtml = dom.serialize();
  const afterMap = outerHtmlMap(newHtml);

  const unexpectedChanged: string[] = [];
  const unexpectedRemoved: string[] = [];
  for (const [id, before] of beforeMap) {
    if (affected.has(id)) continue;
    const after = afterMap.get(id);
    if (after === undefined) unexpectedRemoved.push(id);
    else if (after !== before) unexpectedChanged.push(id);
  }
  const unexpectedAdded: string[] = [];
  for (const id of afterMap.keys()) {
    if (!beforeMap.has(id) && !affected.has(id)) unexpectedAdded.push(id);
  }

  const collateral: CollateralReport = {
    ok: unexpectedChanged.length === 0 && unexpectedRemoved.length === 0 && unexpectedAdded.length === 0,
    unexpectedChanged,
    unexpectedRemoved,
    unexpectedAdded,
  };

  const patchSummary = intent.operations
    .map((o) => `${o.op}(${o.nodeId})`)
    .join(', ');

  return { html: newHtml, changedNodeIds: Array.from(changed), patchSummary, collateral };
}
