"""Jinja2-based LaTeX source generator: reads JSON from stdin, writes .tex to stdout."""
import json, sys

def escape_latex(text: str) -> str:
    """Escape special LaTeX characters."""
    replacements = [
        ("\\", "\\textbackslash{}"),
        ("&", "\\&"), ("%", "\\%"), ("$", "\\$"),
        ("#", "\\#"), ("_", "\\_"), ("{", "\\{"),
        ("}", "\\}"), ("~", "\\textasciitilde{}"),
        ("^", "\\textasciicircum{}"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    return text

def wrap_base64(text: str, width: int = 76) -> str:
    clean = "".join(text.split())
    chunks = [clean[i:i + width] for i in range(0, len(clean), width)]
    return "\n".join(f"{chunk}%" for chunk in chunks)

def render_verbatim_block(code: str) -> list[str]:
    return [
        "\\begin{verbatim}\n",
        code.rstrip("\n") + "\n",
        "\\end{verbatim}\n",
    ]

def inline_chart_filename(index: int) -> str:
    return f"mermaid-diagram-{index + 1}.png"

TEMPLATES = {
    "article": {
        "zh-CN": "\\documentclass[12pt,a4paper]{article}\n\\usepackage{xeCJK}\n\\setCJKmainfont{Songti SC}\n\\setCJKsansfont{Heiti SC}\n\\setCJKmonofont{STFangsong}\n",
        "en-US": "\\documentclass[12pt,a4paper]{article}\n\\usepackage{fontspec}\n",
    },
    "report": {
        "zh-CN": "\\documentclass[12pt,a4paper]{report}\n\\usepackage{xeCJK}\n\\setCJKmainfont{Songti SC}\n\\setCJKsansfont{Heiti SC}\n\\setCJKmonofont{STFangsong}\n",
        "en-US": "\\documentclass[12pt,a4paper]{report}\n\\usepackage{fontspec}\n",
    },
    "beamer": {
        "zh-CN": "\\documentclass{beamer}\n\\usepackage{xeCJK}\n\\setCJKmainfont{Songti SC}\n\\usetheme{Madrid}\n",
        "en-US": "\\documentclass{beamer}\n\\usetheme{Madrid}\n",
    },
    "cvpr": {
        "zh-CN": (
            "\\documentclass[10pt,twocolumn,letterpaper]{article}\n"
            "\\usepackage{xeCJK}\n\\setCJKmainfont{Songti SC}\n"
            "\\usepackage[pagenumbers]{cvpr}\n"
            "\\usepackage{times}\n"
            "\\usepackage{epsfig}\n"
            "\\usepackage{url}\n"
        ),
        "en-US": (
            "\\documentclass[10pt,twocolumn,letterpaper]{article}\n"
            "\\usepackage[pagenumbers]{cvpr}\n"
            "\\usepackage{times}\n"
            "\\usepackage{epsfig}\n"
            "\\usepackage{url}\n"
        ),
    },
    "uestc-thesis": {
        "zh-CN": (
            "\\documentclass[bachelor,chinese]{uestcthesis}\n"
            "\\usepackage{xeCJK}\n"
            "\\setCJKmainfont{Songti SC}\n"
            "\\setCJKsansfont{Heiti SC}\n"
            "\\setCJKmonofont{STFangsong}\n"
        ),
        "en-US": (
            "\\documentclass[bachelor,english]{uestcthesis}\n"
            "\\usepackage{fontspec}\n"
        ),
    },
}

COMMON_PACKAGES = (
    "\\usepackage{geometry}\n"
    "\\usepackage{amsmath}\n"
    "\\usepackage{graphicx}\n"
    "\\usepackage{hyperref}\n"
    "\\usepackage{enumitem}\n"
    "\\usepackage{verbatim}\n"
    "\\newif\\ifautoofficeinlineimages\n"
    "\\autoofficeinlineimagesfalse\n"
    "\\IfFileExists{inline-images.sty}{\\autoofficeinlineimagestrue\\usepackage{inline-images}}{\n"
    "\\IfFileExists{tools/latexgen/inline-images.sty}{\\autoofficeinlineimagestrue\\usepackage{tools/latexgen/inline-images}}{}\n"
    "}\n"
    "\\geometry{margin=2.5cm}\n"
)

HEADING_CMDS = {1: "\\section", 2: "\\subsection", 3: "\\subsubsection"}

def build(payload: dict) -> str:
    theme = payload.get("theme", "article")
    locale = payload.get("locale", "en-US")

    preamble = TEMPLATES.get(theme, TEMPLATES["article"]).get(locale, TEMPLATES["article"]["en-US"])
    lines = [preamble, COMMON_PACKAGES]

    lines.append(f"\\title{{{escape_latex(payload['title'])}}}\n")
    if payload.get("author"):
        lines.append(f"\\author{{{escape_latex(payload['author'])}}}\n")
    if payload.get("date"):
        lines.append(f"\\date{{{escape_latex(payload['date'])}}}\n")
    else:
        lines.append("\\date{\\today}\n")

    lines.append("\n\\begin{document}\n")
    lines.append("\\maketitle\n")

    if payload.get("abstract"):
        lines.append("\\begin{abstract}\n")
        lines.append(escape_latex(payload["abstract"]) + "\n")
        lines.append("\\end{abstract}\n")

    if payload.get("toc"):
        lines.append("\\tableofcontents\n\\newpage\n")

    for index, sec in enumerate(payload.get("sections", [])):
        level = sec.get("level", 1)
        cmd = HEADING_CMDS.get(level, "\\section")
        lines.append(f"\n{cmd}{{{escape_latex(sec['heading'])}}}\n\n")
        if sec.get("body"):
            lines.append(escape_latex(sec["body"]) + "\n")
        if sec.get("math"):
            lines.append(f"\n\\[\n{sec['math']}\n\\]\n")
        if sec.get("chartPngBase64"):
            lines.append("\n\\ifautoofficeinlineimages\n")
            lines.append("\\begin{figure}[htbp]\n")
            lines.append("\\centering\n")
            lines.append(
                f"\\inlineimg{{{inline_chart_filename(index)}}}{{%\n{wrap_base64(sec['chartPngBase64'])}\n}}\n"
            )
            lines.append(f"\\caption{{{escape_latex(sec['heading'])}}}\n")
            lines.append("\\end{figure}\n")
            lines.append("\\else\n")
            if sec.get("mermaidCode"):
                lines.append("\\noindent\\textit{Mermaid 图形嵌入不可用，回退为源码。}\n")
                lines.extend(render_verbatim_block(sec["mermaidCode"]))
            else:
                lines.append("\\noindent\\textit{Mermaid 图形嵌入不可用。}\n")
            lines.append("\\fi\n")
        elif sec.get("mermaidCode"):
            lines.extend(render_verbatim_block(sec["mermaidCode"]))

    if payload.get("bibliography"):
        lines.append("\n\\begin{thebibliography}{99}\n")
        for i, ref in enumerate(payload["bibliography"], 1):
            lines.append(f"\\bibitem{{ref{i}}} {escape_latex(ref)}\n")
        lines.append("\\end{thebibliography}\n")

    lines.append("\n\\end{document}\n")
    return "".join(lines)

if __name__ == "__main__":
    data = json.load(sys.stdin)
    sys.stdout.write(build(data))
