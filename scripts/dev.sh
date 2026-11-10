#!/usr/bin/env bash
# 职到 AI · 本地开发启动脚本
# 用法：
#   ./scripts/dev.sh            # 开发模式（热重载）
#   ./scripts/dev.sh --no-reload # 关闭热重载
# 说明：首次运行会自动创建 backend/.venv 并安装依赖。

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VENV="$ROOT/backend/.venv"
PORT="${PORT:-4173}"

PY="${PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
  echo "❌ 需要 Python 3.10+，当前: $($PY -V 2>&1)"
  exit 1
fi

if [ ! -x "$VENV/bin/python" ]; then
  echo "→ 创建虚拟环境 backend/.venv"
  "$PY" -m venv "$VENV"
  echo "→ 安装依赖"
  # 某些环境下 /tmp 空间很小，pip 解包会失败，这里指到大一点的目录
  TMPDIR="${TMPDIR:-$ROOT/.tmp}" "$VENV/bin/pip" install -q --upgrade pip
  TMPDIR="${TMPDIR:-$ROOT/.tmp}" "$VENV/bin/pip" install -q -r backend/requirements.txt
fi

if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "⚠️  已生成 backend/.env，请填入模型 / Embedding / Reranker / ASR 密钥后重新运行"
fi

RELOAD="--reload"
if [ "${1:-}" = "--no-reload" ]; then RELOAD=""; fi

echo "→ 启动 http://127.0.0.1:$PORT  (Ctrl+C 退出)"
exec "$VENV/bin/python" -m uvicorn backend.app.main:app \
  --host 127.0.0.1 --port "$PORT" $RELOAD \
  --reload-dir "$ROOT/backend" --reload-dir "$ROOT"
