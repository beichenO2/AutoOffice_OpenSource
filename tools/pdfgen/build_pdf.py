#!/usr/bin/env python3
"""从 stdin 读入 JSON，生成专业级 PDF 到 argv[1] 路径（WeasyPrint）。"""
from __future__ import annotations

import html
import json
import sys
from typing import Any

try:
    from weasyprint import HTML
except ImportError:
    print("ERROR: weasyprint not installed. Run: pip3 install weasyprint", file=sys.stderr)
    sys.exit(1)

# ── 主题配色 ──────────────────────────────────────────────────────

THEMES: dict[str, dict[str, str]] = {
    "academic": {
        "primary": "#1A365D",
        "secondary": "#2C5A8F",
        "text": "#2D3741",
        "muted": "#64748B",
        "bg": "#FFFFFF",
        "cover_bg": "#F8FAFC",
        "accent_border": "#2C5A8F",
        "heading_font": "'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif",
        "body_font": "'Noto Sans SC', 'Source Han Sans SC', 'PingFang SC', sans-serif",
        "mono_font": "'JetBrains Mono', 'Fira Code', monospace",
    },
    "business": {
        "primary": "#0F172A",
        "secondary": "#30588C",
        "text": "#1E293B",
        "muted": "#64748B",
        "bg": "#FFFFFF",
        "cover_bg": "#F1F5F9",
        "accent_border": "#30588C",
        "heading_font": "'Helvetica Neue', 'PingFang SC', sans-serif",
        "body_font": "'PingFang SC', 'Noto Sans SC', sans-serif",
        "mono_font": "'SF Mono', 'Menlo', monospace",
    },
    "minimal": {
        "primary": "#18181B",
        "secondary": "#3F3F46",
        "text": "#27272A",
        "muted": "#71717A",
        "bg": "#FFFFFF",
        "cover_bg": "#FAFAFA",
        "accent_border": "#D4D4D8",
        "heading_font": "'Inter', 'PingFang SC', sans-serif",
        "body_font": "'Inter', 'PingFang SC', sans-serif",
        "mono_font": "'JetBrains Mono', monospace",
    },
    "elegant": {
        "primary": "#44403C",
        "secondary": "#78716C",
        "text": "#292524",
        "muted": "#A8A29E",
        "bg": "#FFFBF5",
        "cover_bg": "#FEF7ED",
        "accent_border": "#C4956A",
        "heading_font": "'Noto Serif SC', 'Songti SC', serif",
        "body_font": "'Noto Sans SC', 'PingFang SC', sans-serif",
        "mono_font": "'Fira Code', monospace",
    },
}


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


def _sections_html(sections: list[dict[str, Any]]) -> str:
    """把 sections 列表转为带层级标题的 HTML 片段。"""
    parts: list[str] = []
    for i, sec in enumerate(sections):
        level = sec.get("level", 1)
        tag = f"h{min(max(level, 1), 3) + 1}"  # h2, h3, h4
        heading = _esc(sec.get("heading", ""))
        body = sec.get("body", "")
        chart = sec.get("chart")

        anchor = f"sec-{i}"
        parts.append(f'<section id="{anchor}">')
        if heading:
            parts.append(f"<{tag}>{heading}</{tag}>")

        for para in body.split("\n\n"):
            para = para.strip()
            if not para:
                continue
            if para.startswith("- ") or para.startswith("* "):
                items = [_esc(ln.lstrip("-* ").strip()) for ln in para.split("\n") if ln.strip()]
                parts.append("<ul>" + "".join(f"<li>{it}</li>" for it in items) + "</ul>")
            elif para.startswith("```"):
                code = "\n".join(para.split("\n")[1:])
                if code.endswith("```"):
                    code = code[:-3]
                parts.append(f"<pre><code>{_esc(code)}</code></pre>")
            else:
                parts.append(f"<p>{_esc(para)}</p>")

        if chart:
            if chart.get("kind") == "svg" and chart.get("data"):
                parts.append(f'<figure class="mermaid-chart">{chart["data"]}</figure>')
            elif chart.get("kind") == "png" and chart.get("data"):
                parts.append(
                    '<figure class="mermaid-chart">'
                    f'<img src="data:image/png;base64,{chart["data"]}" alt="Mermaid chart" />'
                    "</figure>"
                )

        parts.append("</section>")
    return "\n".join(parts)


def _toc_html(sections: list[dict[str, Any]]) -> str:
    """生成目录 HTML。"""
    items: list[str] = []
    for i, sec in enumerate(sections):
        heading = _esc(sec.get("heading", f"第 {i+1} 节"))
        level = sec.get("level", 1)
        indent = (level - 1) * 24
        items.append(
            f'<li style="margin-left:{indent}px">'
            f'<a href="#sec-{i}">{heading}</a>'
            f"</li>"
        )
    return (
        '<nav class="toc">'
        "<h2>目 录</h2>"
        f'<ol>{"".join(items)}</ol>'
        "</nav>"
    )


def _css(th: dict[str, str], locale: str) -> str:
    lang_font_stack = th["body_font"]
    return f"""
/* ── 基础重置 ─────────────────── */
*, *::before, *::after {{ margin: 0; padding: 0; box-sizing: border-box; }}

/* ── 页面设置 ─────────────────── */
@page {{
    size: A4;
    margin: 28mm 24mm 30mm 24mm;

    @top-center {{
        content: string(doc-title);
        font-family: {lang_font_stack};
        font-size: 8pt;
        color: {th["muted"]};
        border-bottom: 0.4pt solid {th["accent_border"]};
        padding-bottom: 4pt;
    }}

    @bottom-center {{
        content: counter(page) " / " counter(pages);
        font-family: {lang_font_stack};
        font-size: 8pt;
        color: {th["muted"]};
    }}
}}

@page :first {{
    margin-top: 0;
    @top-center {{ content: none; }}
    @bottom-center {{ content: none; }}
}}

/* ── 全局排版 ─────────────────── */
html {{
    font-size: 11pt;
    line-height: 1.72;
    color: {th["text"]};
    font-family: {lang_font_stack};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
}}

/* ── 封面 ─────────────────────── */
.cover {{
    page-break-after: always;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: {th["cover_bg"]};
    padding: 60px 48px;
    text-align: center;
}}

.cover h1 {{
    string-set: doc-title content();
    font-family: {th["heading_font"]};
    font-size: 28pt;
    font-weight: 700;
    color: {th["primary"]};
    margin-bottom: 12px;
    letter-spacing: 0.02em;
    line-height: 1.3;
}}

.cover .subtitle {{
    font-size: 14pt;
    color: {th["secondary"]};
    margin-bottom: 32px;
}}

.cover .meta {{
    font-size: 10pt;
    color: {th["muted"]};
    margin-top: 8px;
}}

.cover .accent-line {{
    width: 64px;
    height: 3px;
    background: {th["accent_border"]};
    margin: 28px auto;
    border-radius: 2px;
}}

/* ── 目录 ─────────────────────── */
.toc {{
    page-break-after: always;
    padding: 20px 0;
}}

.toc h2 {{
    font-family: {th["heading_font"]};
    font-size: 18pt;
    color: {th["primary"]};
    margin-bottom: 20px;
    padding-bottom: 6px;
    border-bottom: 2px solid {th["accent_border"]};
}}

.toc ol {{
    list-style: none;
    padding: 0;
}}

.toc li {{
    padding: 6px 0;
    border-bottom: 0.5pt dotted {th["muted"]};
}}

.toc a {{
    color: {th["text"]};
    text-decoration: none;
    font-size: 11pt;
}}

.toc a::after {{
    content: target-counter(attr(href), page);
    float: right;
    color: {th["muted"]};
}}

/* ── 正文章节 ─────────────────── */
section {{
    margin-bottom: 18px;
}}

h2 {{
    font-family: {th["heading_font"]};
    font-size: 17pt;
    font-weight: 700;
    color: {th["primary"]};
    margin-top: 28px;
    margin-bottom: 10px;
    padding-bottom: 5px;
    border-bottom: 1.5px solid {th["accent_border"]};
    page-break-after: avoid;
}}

h3 {{
    font-family: {th["heading_font"]};
    font-size: 13pt;
    font-weight: 600;
    color: {th["secondary"]};
    margin-top: 20px;
    margin-bottom: 8px;
    page-break-after: avoid;
}}

h4 {{
    font-family: {th["heading_font"]};
    font-size: 11.5pt;
    font-weight: 600;
    color: {th["secondary"]};
    margin-top: 14px;
    margin-bottom: 6px;
    page-break-after: avoid;
}}

p {{
    margin-bottom: 10px;
    text-align: justify;
    orphans: 3;
    widows: 3;
}}

ul, ol {{
    margin: 8px 0 12px 20px;
    padding-left: 6px;
}}

li {{
    margin-bottom: 4px;
}}

pre {{
    background: #F8F9FA;
    border: 1px solid #E2E8F0;
    border-radius: 4px;
    padding: 12px 16px;
    font-family: {th["mono_font"]};
    font-size: 9pt;
    line-height: 1.55;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    margin: 10px 0 14px;
    page-break-inside: avoid;
}}

code {{
    font-family: {th["mono_font"]};
    font-size: 9.5pt;
    background: #F1F5F9;
    padding: 1px 4px;
    border-radius: 3px;
}}

pre code {{
    background: none;
    padding: 0;
}}

.mermaid-chart {{
    margin: 12px 0 18px;
    page-break-inside: avoid;
}}

.mermaid-chart img,
.mermaid-chart svg {{
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
}}

/* ── 表格（备用） ────────────── */
table {{
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 10pt;
    page-break-inside: avoid;
}}

th, td {{
    border: 1px solid #CBD5E1;
    padding: 6px 10px;
    text-align: left;
}}

th {{
    background: {th["cover_bg"]};
    font-weight: 600;
    color: {th["primary"]};
}}
"""


def build_html(data: dict[str, Any]) -> str:
    theme_id = data.get("theme", "minimal")
    th = THEMES.get(theme_id, THEMES["minimal"])
    locale = data.get("locale", "zh-CN")

    title = _esc(data.get("title", "报告"))
    subtitle = data.get("subtitle", "")
    author = data.get("author", "")
    date_str = data.get("date", "")
    sections = data.get("sections", [])
    show_toc = data.get("toc", True) and len(sections) > 1

    css = _css(th, locale)
    body_parts: list[str] = []

    # 封面
    body_parts.append('<div class="cover">')
    body_parts.append(f"<h1>{title}</h1>")
    if subtitle:
        body_parts.append(f'<div class="subtitle">{_esc(subtitle)}</div>')
    body_parts.append('<div class="accent-line"></div>')
    meta_items = []
    if author:
        meta_items.append(_esc(author))
    if date_str:
        meta_items.append(_esc(date_str))
    if meta_items:
        body_parts.append(f'<div class="meta">{" · ".join(meta_items)}</div>')
    body_parts.append("</div>")

    # 目录
    if show_toc:
        body_parts.append(_toc_html(sections))

    # 正文
    body_parts.append('<main class="content">')
    body_parts.append(_sections_html(sections))
    body_parts.append("</main>")

    lang = "zh" if locale.startswith("zh") else "en"
    return f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
{"".join(body_parts)}
</body>
</html>"""


def build(data: dict[str, Any], out_path: str) -> None:
    html_str = build_html(data)
    doc = HTML(string=html_str)
    doc.write_pdf(out_path)


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: build_pdf.py <output.pdf> [--html-only] < stdin.json", file=sys.stderr)
        sys.exit(2)
    raw = sys.stdin.read()
    data = json.loads(raw)
    if "--html-only" in sys.argv:
        sys.stdout.write(build_html(data))
    else:
        build(data, sys.argv[1])


if __name__ == "__main__":
    main()
