#!/usr/bin/env bash
# AutoOffice · Agent 研究预览 —— PolarProcess 托管的辅助服务（非生产）
#
# 生命周期由 PolarProcess（服务 id: autooffice-agent-preview）唯一管理，端口由
# PolarPort 保留分配（固定 3905）→ start/stop/restart 全走 PolarManager，URL 永不漂移。
# 与生产 autooffice:3900 完全隔离：独立 service id、独立端口、独立 engine home、
# 真 LLM 编辑（AUTOOFFICE_LLM_EDIT=1）。
#
# 严禁在此后台化或直接发送进程信号；启停只能走 PolarProcess 精确接口。
set -euo pipefail
cd "$(dirname "$0")/.."   # → AutoOffice 根目录

# PolarPort policy: allocations must end in 0 or 5. Prod is 3900; preview pins 3905.
PORT="${AUTOOFFICE_PREVIEW_PORT:-3905}"
# PolarProcess spawns without a login shell PATH → resolve an absolute node
# binary (same convention as Start/start.sh), otherwise bare `node` is not found.
NODE_BIN=${AUTOOFFICE_NODE_BIN:-~/.nvm/versions/node/v22.22.2/bin/node}
if [ ! -x "$NODE_BIN" ]; then NODE_BIN=$(command -v node || true); fi
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "AutoOffice preview: node executable not found" >&2; exit 1
fi

# —— 走受管路径（不再使用测试后门 NODE_ENV=test / AUTOOFFICE_DIRECT_PORT）——
export POLAR_RUNTIME_MANAGED=1
export PORT
export AUTOOFFICE_MANAGED_PORT="$PORT"          # 声明本辅助服务的固定端口（governance 放行）
export AUTOOFFICE_SERVICE_ID=autooffice-agent-preview
export AUTOOFFICE_PROJECT=AutoOffice

# —— 预览业务配置 ——
export AUTOOFFICE_ENGINE_HOME="$PWD/.planning/ide-engine/preview-home-managed"
export AUTOOFFICE_PPT_SOT=slidev
export AUTOOFFICE_BOXMAP=measure
export AUTOOFFICE_LLM_EDIT=1
export AUTOOFFICE_ENGINE_INTERPRETER=auto
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# 首次播种富 PPT（含可编辑插图）+ 富 PDF；已存在则快速 no-op（幂等）
"$NODE_BIN" .planning/ide-engine/seed-managed.mjs || true

exec "$NODE_BIN" dist/cli.js serve -p "$PORT"
