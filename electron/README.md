# AutoOffice 桌面 App（Electron）

把 AutoOffice 的 `/aoide/` 三栏 IDE 打包成原生桌面应用。启动时在本机私有端口拉起
与 `autooffice serve` 完全相同的 HTTP 服务（`startServer`），健康检查通过后在原生窗口
里加载 `/aoide/`；退出时自动回收服务子进程。

## 结构
- `main.cjs` — Electron 主进程：选空闲端口 → 以 `ELECTRON_RUN_AS_NODE` 拉起 `server-boot.mjs`
  → 轮询 `/health` → 打开窗口加载 `http://127.0.0.1:<port>/aoide/`；退出时 kill 子进程。
- `server-boot.mjs` — 纯 Node 引导：`import('../dist/server.js').startServer(PORT)`（桌面版直接
  运行引擎，不走 Polar 治理，仅监听 127.0.0.1）。
- `preload.cjs` — 最小 preload（`contextIsolation` 开启；仅暴露 `window.autooffice.desktop` 标记）。

## 运行（开发）
```bash
npm run app          # 先 build，再用本地 Electron 启动窗口
```
默认启用要点：`AUTOOFFICE_BOXMAP=estimate`（框选无需 Chromium）、`AUTOOFFICE_LLM_EDIT=1`
（本机 LLM 代理可用时走 GLM 生成/编辑）、项目持久化到系统 app-data 的 `engine-home`。

## 打包
```bash
npm run app:pack     # electron-builder --dir（未压缩目录，快速验证）
npm run app:dist     # 生成安装包（mac: dmg / win: nsis / linux: AppImage）
```
产物输出到 `release/`（已 gitignore）。

## 说明 / 后续
- 完整导出（PDF/PPTX、xelatex、Slidev 逐步动画）依赖系统的 xelatex 与打包内的
  playwright-chromium（已在 `build.asarUnpack` 放行）；仅做在线预览/生成时无需这些。
- 首次打包体积较大（含 Slidev CLI + Chromium）；如需精简可按需裁剪 `build.files`。
