#!/usr/bin/env bash
# DaShengOS v0.3 · Unified Start Script (2026-06-20)
#
# 启动所有服务：
#   1. Agent Bridge (:8001) — hermes/deerflow 双模式
#   2. Backend (:8000) — Fastify API
#   3. Frontend (:3000) — Vite dev server
#
# 环境变量切换 brain 模式：
#   DASHENG_BRAIN_BACKEND=hermes   (丰富工具链，推荐)
#   DASHENG_BRAIN_BACKEND=deerflow (自研 daemon)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HERMES_VENV="/Users/apple/.hermes/hermes-agent/venv/bin/python"
LOG_DIR="$ROOT/.logs"
mkdir -p "$LOG_DIR"

BRAIN_BACKEND="${DASHENG_BRAIN_BACKEND:-hermes}"
AGENT_DEBUG="${DASHENG_DEBUG:-true}"

echo "============================================"
echo " DaShengOS v0.3 · 启动中..."
echo " Brain Backend: $BRAIN_BACKEND"
echo "============================================"

cleanup() {
    echo ""
    echo "[cleanup] 停止所有服务..."
    jobs -p | xargs kill 2>/dev/null || true
    wait 2>/dev/null || true
    echo "[cleanup] 完成"
}
trap cleanup EXIT INT TERM

# ─── 1) Agent Bridge (:8001) ────────────────────────────────────
echo ""
echo "[1/3] Agent Bridge → :8001 (backend=$BRAIN_BACKEND)"
DASHENG_DEBUG="$AGENT_DEBUG" \
DASHENG_REQUIRE_AUTH=false \
DASHENG_BRAIN_BACKEND="$BRAIN_BACKEND" \
DASHENG_LLM_MODEL="${DASHENG_LLM_MODEL:-deepseek-v4-pro}" \
DASHENG_LLM_BASE_URL="${DASHENG_LLM_BASE_URL:-https://api.deepseek.com/v1}" \
DASHENG_LLM_API_KEY="${DASHENG_LLM_API_KEY:-sk-7a05a78ef46f4e40a770e95b5bf313a9}" \
PYTHONPATH="$ROOT:$PYTHONPATH" \
"$HERMES_VENV" -m agent.main > "$LOG_DIR/agent-bridge.log" 2>&1 &
AGENT_PID=$!
sleep 3
if curl -s http://127.0.0.1:8001/health > /dev/null 2>&1; then
    echo "[1/3] ✅ Agent Bridge 就绪 (pid=$AGENT_PID)"
else
    echo "[1/3] ⚠️  Agent Bridge 启动中，查看日志: tail -f $LOG_DIR/agent-bridge.log"
fi

# ─── 2) Backend (:8000) ─────────────────────────────────────────
echo ""
echo "[2/3] Backend → :8000"
cd "$ROOT/packages/backend" && node dist/server.js > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
sleep 2
if curl -s http://127.0.0.1:8000/health > /dev/null 2>&1; then
    echo "[2/3] ✅ Backend 就绪 (pid=$BACKEND_PID)"
else
    echo "[2/3] ⚠️  Backend 启动中..."
fi

# ─── 3) Frontend (:3000) ────────────────────────────────────────
echo ""
echo "[3/3] Frontend → :3000"
cd "$ROOT/apps/web" && npx vite --port 3000 --strictPort > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "[3/3] ✅ Frontend 启动中 (pid=$FRONTEND_PID)"

echo ""
echo "============================================"
echo " 所有服务已启动"
echo " Agent Bridge: http://127.0.0.1:8001/health"
echo " Backend:      http://127.0.0.1:8000/health"
echo " Frontend:     http://127.0.0.1:3000"
echo "============================================"
echo ""

wait -n 2>/dev/null || wait
