---
name: ao-scientific-figure
description: >
  Builds an editable scientific figure in draw.io from a text brief plus an
  optional hand-drawn sketch. Use when the user asks for 科研绘图, 科学图,
  draw.io 图, or 严谨插图. Engine entry is POST /api/engine/figures; Agent
  walks Designer → Drawer → Reviewer → Corrector. Forbidden: DALL·E / Flux /
  Midjourney / AutoFigure, and pasting the whole sketch onto the canvas.
---

# AutoOffice — 科研绘图

> 文字描述 + 可选手绘草图 → 可编辑 `.drawio` 科研图。协议，不实现、不画图、**禁生图**。

## 触发

用户给**文字描述**，可附**手绘草图**，并要下列任一：

`科研绘图` · `科学图` · `draw.io 图` · `严谨插图`

不要用本 skill 做 Slidev 排版、Mermaid 报告图、或文生图。

## 核心信息

| 维度 | 值 |
|---|---|
| 引擎入口 | `POST /api/engine/figures`（`:3900`，PolarProcess `autooffice`） |
| Agent 入口 | 本 skill 四角色；vendor 协议只引用、不粘贴 |
| Vendor pin | `vendor/scientific-illustrator` **v1.5.4** |
| 图 SoT | draw.io 原生对象（`.drawio` / mxGraph） |
| 文稿 SoT | 仍是 Slidev `slides.md`（本轨并列，不替换） |
| 草图 | 只进 VLM 理解；`whole-sketch-raster` = hard fail |
| 预览 | 仅 draw.io Desktop CLI 导出 PNG/SVG（导出 ≠ 生图） |
| LLM / 密钥 | PolarPrivate `:12790`，能力码 **V0000**；本 skill 不写密钥 |

## 入口（二选一，同一契约）

引擎在时走 API；否则 Agent 按四角色自己走完，交付物相同。

契约：`src/engine/figure/types.ts` 的 `FigureRequest` / `FigureResult`。`sketch` 是对象，不是路径、不是 `data:` URI。

```bash
# 引擎（PolarProcess 已拉起 autooffice）
curl -fsS -X POST http://127.0.0.1:3900/api/engine/figures \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{
  "prompt": "<文字描述>",
  "sketch": { "mime": "image/png", "data": "<raw-base64-no-data-prefix>" },
  "attachToProjectId": "<可选已有 presentation id>",
  "attachPage": 0
}
JSON
```

| 方向 | 字段（与 types.ts 同名） |
|---|---|
| 入 `FigureRequest` | `prompt`（必填）· `sketch?: { mime, data }`（`data` = raw base64，无 `data:` 前缀）· `attachToProjectId?` · `attachPage?` |
| 出 `FigureResult` | `figureId` · `designSpec` · `drawioXml` · `drawioPath` · `previewPath?` · `audit` |

缺 `prompt` → 400。不要另开 `kind=figure` 项目。禁止把 `sketch` 写成路径或 `data:` URI。

## 四角色（Designer → Drawer → Reviewer → Corrector）

角色逻辑分离，即使一人串完。细则读 vendor，**禁止把上游 SKILL 整份粘进对话**。

| 角色 | 本仓动作 | 读这份（勿复述成长文） |
|---|---|---|
| **Designer** | V0000 读文字+草图 → `design_spec`（面板、对象、连线、歧义）。草图是参考，不是底图 | `vendor/scientific-illustrator/plugins/scientific-illustrator/skills/design-scientific-figure/SKILL.md` |
| **Drawer** | 按 spec 写 draw.io **文件**（具名 vertex/edge）。默认 `ao-drawio-files`。live 仅在用户要可见画布时开 | `…/recreate-scientific-figure-in-drawio/SKILL.md`（Drawer 适配）· 总控 `…/recreate-scientific-figure/SKILL.md` |
| **Reviewer** | `drawio_validate` / `audit_figure`；只出 findings，不画。hard=0 才过 | `…/audit-scientific-figure/SKILL.md` |
| **Corrector** | findings → 对象级修正计划 → 交回 Drawer；再 Reviewer。循环 **≤3** | `…/correct-scientific-figure/SKILL.md` |

本切片 Drawer **只**走 draw.io。不要加载 `edit-powerpoint-live`。

## 草图

- 草图只给 Designer / V0000 看，用来拆面板与拓扑。
- **禁止**把整张草图插入画布（垫底、唯一 image cell、整页 `add_image` 都不行）。
- 该类缺陷记为 **`whole-sketch-raster`，hard fail**，Corrector 不得用「裁一圈边」过关。
- 仅当某块纹理/显微视野**不可再拆**时，才允许一个原子 raster（须 `atomic_raster_unit=true` + `raster_reason`）。可重建的框、字、箭头、图例必须是可编辑 cell。

## 禁生图

禁止把下列任何一项当主产物或打底：

- DALL·E / Flux / Midjourney / SD / 任何扩散或文生图 / 图生图 API
- AutoFigure（及「先生图再矢量化」）第一段
- 用一张大 PNG 冒充科研图首页

预览**只用** `/Applications/draw.io.app/Contents/MacOS/draw.io`（或 `DRAWIO_PATH`）从已保存 `.drawio` 导出。调用栈里出现生图 API = 失败。

## 后端（draw.io 文件优先）

Wrap：`integrations/scientific-illustrator/`。MCP 目录：`integrations/scientific-illustrator/mcp.autooffice.json`。

| 路径 | 何时 | 规则 |
|---|---|---|
| **文件优先**（默认） | 写 / 校验 / 导出 `.drawio` | `ao-drawio-files`（vendor `scripts/server.mjs`）+ Desktop CLI |
| live CDP（可选） | 用户要看见画布 | `ao-drawio-live`；端口 **只能 9330 或 9335**；先 PolarPort 申领 |

端口铁律：

- 禁止 **9333**（vendor 默认，PolarPort 不合法）。
- 禁止静默 `port++`。`drawio_live_launch` **必须带**已申领的 `port`，占线则抛错，再改申领 **9335**。
- PolarPort 不可用：保持 `DRAWIO_LIVE_PORT=9330`，只走文件路径，不另起常驻 CDP。

```bash
# live 才申领；文件路径不占端口
source ~/Polarisor/Agent_core/scripts/port-claim.sh
PORT=$(claim_port "ao-drawio-live" "AutoOffice" 9330)
# 9330 被拒再 claim 9335，并改 MCP env 后重载
```

stdio 由 **Cursor 拉起**（把 wrap JSON merge 进项目 `.cursor/mcp.json`）。**不要 HTTP 包一层**。常驻 HTTP MCP / Office.js 才走 PolarProcess。关会话用 MCP `*_close_*`，禁止 `pkill` / `killall` draw.io。

一次性自检（不留进程）：`bash integrations/scientific-illustrator/smoke-drawio.sh`

## PolarPrivate

理解草图：`POST http://127.0.0.1:12790/v1/chat/completions`，模型写 **V0000**（QCSA 视觉能力码，不是 Ollama 标签）。不要写 Ollama 标签，不要把密钥写进本 skill、`.env` 或 MCP env。代理不可用则停在 Designer，不要改走公网生图。

## 不做

| 禁止 | 原因 |
|---|---|
| 本切片 PPT / WPS live | 会顶到 Office.js `:17645` 与新 Python 桥 |
| 替换 Slidev SoT | 科研图是并列图轨；文稿仍是 `slides.md` |
| 新 Python 依赖 / `drawio2pptx` | PolarSoul：本仓不新开 Python 栈 |
| 跑上游 `install.sh` | Codex Marketplace 专用；本仓只用 pin + wrap |
| 把 Mermaid 升格为科研图 SoT | 报告图 ≠ 本轨 |
| 绕过 PolarProcess 启 `autooffice` | 引擎仍只由 `:11055` 启停 |

## 交付

必须：可编辑 `.drawio`（`mxfile` + 具名 cell）+ Reviewer `audit`（hard=0）。

可选：Desktop CLI 导出的 PNG/SVG；`attachToProjectId` + `attachPage` 挂到已有 presentation media（不是新 kind）。

回报：backend、对象计数、每条 raster 声明、剩余歧义、是否触发过 `whole-sketch-raster`。
