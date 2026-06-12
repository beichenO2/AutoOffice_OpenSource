/**
 * PolarDesign → AutoOffice 主题桥接
 * 将 PolarDesign 设计系统 CSS 变量注入 AutoOffice HTML 渲染管线
 */

const SYSTEM_VARS: Record<string, Record<string, string>> = {
  'polar-tech': {
    '--pd-bg': '#0c0d10',
    '--pd-surface': '#161820',
    '--pd-surface-2': '#1e2028',
    '--pd-text': '#f0f1f3',
    '--pd-text-secondary': '#b0b4bc',
    '--pd-accent': '#3b82f6',
    '--pd-border': 'rgba(255,255,255,0.08)',
    '--pd-font': 'Inter, SF Pro Display, -apple-system, system-ui, sans-serif',
  },
  'polar-soft': {
    '--pd-bg': '#faf9f7',
    '--pd-surface': '#ffffff',
    '--pd-surface-2': '#f3f2ef',
    '--pd-text': '#1a1a1a',
    '--pd-text-secondary': '#5c5c5c',
    '--pd-accent': '#2563eb',
    '--pd-border': 'rgba(0,0,0,0.08)',
    '--pd-font': 'Inter, Georgia, serif',
  },
  'polar-dense': {
    '--pd-bg': '#111111',
    '--pd-surface': '#1a1a1a',
    '--pd-surface-2': '#222222',
    '--pd-text': '#e8e8e8',
    '--pd-text-secondary': '#999999',
    '--pd-accent': '#10b981',
    '--pd-border': 'rgba(255,255,255,0.06)',
    '--pd-font': 'JetBrains Mono, ui-monospace, monospace',
  },
}

/** AutoOffice 主题名 → PolarDesign 系统 ID */
export function mapThemeToDesignSystem(theme?: string): string | null {
  if (!theme) return null
  const t = theme.toLowerCase()
  if (t.startsWith('polar-')) return t
  const map: Record<string, string> = {
    tech: 'polar-tech',
    nord: 'polar-tech',
    slate: 'polar-tech',
    warm: 'polar-soft',
    minimal: 'polar-soft',
    academic: 'polar-soft',
    business: 'polar-dense',
  }
  return map[t] ?? null
}

function buildCssBlock(systemId: string): string {
  const vars: Record<string, string> =
    SYSTEM_VARS[systemId] ?? SYSTEM_VARS['polar-tech'] ?? {}
  const decl = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n  ')
  return `:root {\n  ${decl}\n}
body { background: var(--pd-bg); color: var(--pd-text); font-family: var(--pd-font); line-height: 1.6; }
h1, h2, h3, h4 { color: var(--pd-text); letter-spacing: -0.01em; }
p, li { color: var(--pd-text-secondary); }
a { color: var(--pd-accent); }
section, article, .card { background: var(--pd-surface); border: 1px solid var(--pd-border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid var(--pd-border); padding: 8px; }`
}

export function injectPolarDesignCss(html: string, systemId: string): string {
  const css = buildCssBlock(systemId)
  const tag = `<style data-polar-design="${systemId}">\n${css}\n</style>`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${tag}</head>`)
  }
  return `${tag}${html}`
}

export function resolveDesignSystemFromPayload(data: Record<string, unknown>): string | null {
  const explicit = data.design_system ?? data.designSystem
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.startsWith('polar-') ? explicit : mapThemeToDesignSystem(explicit) ?? explicit
  }
  const theme = data.theme ?? (data.pptx as Record<string, unknown> | undefined)?.theme
  if (typeof theme === 'string') return mapThemeToDesignSystem(theme)
  return null
}
