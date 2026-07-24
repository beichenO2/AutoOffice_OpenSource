/**
 * Apply structured EditIntent to LaTeX/HTML source via range-safe splices.
 */
import type { EditIntent, SourceFile } from '../types.js';
import { ScopeViolationError } from '../html/edit.js';

export function applySourcePatch(files: SourceFile[], intent: EditIntent): SourceFile[] {
  const allowed = new Set(intent.allowedNodeIds);
  for (const op of intent.operations) {
    if (!allowed.has(op.nodeId)) {
      throw new ScopeViolationError(`Op on ${op.nodeId} outside allowedNodeIds`);
    }
  }
  const out = files.map((f) => ({ ...f, content: f.content }));
  for (const op of intent.operations) {
    const file = out.find((f) => f.path === 'main.tex' || f.path === 'deck.html') ?? out[0];
    if (!file) throw new ScopeViolationError('No source file');
    if (op.op === 'replaceText') {
      const nodeId = op.nodeId;
      if (file.language === 'latex') {
        file.content = replaceAoNodeContent(file.content, nodeId, String(op.payload.text ?? ''));
      } else {
        throw new ScopeViolationError('HTML patch should use html/edit.applyEditIntent');
      }
    } else if (op.op === 'replaceSource') {
      file.content = String(op.payload.source ?? file.content);
    }
  }
  return out;
}

function replaceAoNodeContent(tex: string, nodeId: string, newText: string): string {
  const marker = `\\aoNode{${nodeId}}{`;
  const idx = tex.indexOf(marker);
  if (idx === -1) throw new ScopeViolationError(`LaTeX node not found: ${nodeId}`);
  const contentStart = idx + marker.length;
  const end = findMatchingBrace(tex, contentStart - 1);
  return tex.slice(0, contentStart) + escapeLatexInline(newText) + tex.slice(end);
}

function findMatchingBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return openIdx;
}

function escapeLatexInline(s: string): string {
  return s.replace(/[&%$#_{}~^\\]/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`));
}

export function buildReplaceTextIntent(
  base: Omit<EditIntent, 'operations' | 'allowedNodeIds'>,
  nodeId: string,
  newText: string,
): EditIntent {
  return {
    ...base,
    targetNodeIds: [nodeId],
    allowedNodeIds: [nodeId],
    operations: [{ op: 'replaceText', nodeId, payload: { text: newText } }],
  };
}
