#!/usr/bin/env bash
# Day 0 · ai-workbench-v2 一键启动
# 启动顺序: vendors/deer-flow (DeerFlow Lead Agent :8002) → runtime (AG-UI 桥 :8001) → frontend (Next.js :3000)
# 老板 2026-06-15 修订: 3 个服务全要起, 桥要在 :8001 (Node.js), DeerFlow 在 :8002 (FastAPI),
#                     AG-UI 协议: frontend :3000 → bridge :8001 → DeerFlow :8002 via LangGraph
#
# 用法:
#   bash scripts/dev.sh           # 启动全部 3 个进程 (后台输出, 各自 log 文件)
#   bash scripts/dev.sh backend   # 只启动 DeerFlow Lead Agent :8002
#   bash scripts/dev.sh bridge    # 只启动 AG-UI 桥 :8001
#   bash scripts/dev.sh frontend  # 只启动前端 :3000
#   bash scripts/dev.sh stop      # 全停

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date +%H:%M:%S)]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] WARN${NC} $1"; }
err() { echo -e "${RED}[$(date +%H:%M:%S)] ERR${NC} $1"; }

# DeerFlow admin 密码路径 (DeerFlow 启动时会写)
DEERFLOW_CREDS_FILE="$ROOT/vendors/deer-flow/backend/.deer-flow/admin_initial_credentials.txt"

start_backend() {
  log "启动 DeerFlow Lead Agent (FastAPI :8002)..."
  cd "$ROOT/vendors/deer-flow/backend"
  if [ ! -d ".venv" ]; then
    warn "DeerFlow backend/.venv 不存在. 请: cd vendors/deer-flow/backend && uv sync"
    return 1
  fi
  # ⚠️ 坑 (2026-06-15 老板验证):
  #   1) module path: 实际入口是 app.gateway.app:app (deer-flow 改了 gateway 化, 不是 app.main)
  #   2) PYTHONPATH: deerflow 顶层包在 packages/harness/deerflow, 必须加进去
  #   3) VIRTUAL_ENV: shell 里如有老 venv 路径 (如 DaShengOS), 必须 unset 否则 uv 报警
  unset VIRTUAL_ENV
  PYTHONPATH=.:packages/harness nohup .venv/bin/uvicorn app.gateway.app:app --host 0.0.0.0 --port 8002 > "$LOGS/backend.log" 2>&1 &
  echo $! > "$LOGS/backend.pid"
  log "DeerFlow Lead Agent PID=$(cat "$LOGS/backend.pid"), 日志: $LOGS/backend.log"

  # 等待 DeerFlow 把 admin 密码写到 .deer-flow/admin_initial_credentials.txt (启动后 ~5s)
  log "等 DeerFlow 把 admin 密码写到 creds 文件..."
  for i in $(seq 1 30); do
    if [ -f "$DEERFLOW_CREDS_FILE" ]; then
      log "✓ creds 文件就绪 (等 $i 秒)"
      break
    fi
    sleep 1
  done
  if [ ! -f "$DEERFLOW_CREDS_FILE" ]; then
    warn "creds 文件 30s 内没出来, 桥会登录失败"
  fi
}

start_bridge() {
  log "启动 AG-UI 桥 (Node.js :8001)..."
  cd "$ROOT/runtime"
  if [ ! -d "node_modules" ]; then
    warn "runtime/node_modules 不存在. 请: cd runtime && npm install"
    return 1
  fi
  # 从 .deer-flow/admin_initial_credentials.txt 读密码 (DeerFlow 启动时自动生成/重置)
  local deer_pw=""
  if [ -f "$DEERFLOW_CREDS_FILE" ]; then
    deer_pw=$(grep -E "^password:" "$DEERFLOW_CREDS_FILE" | head -1 | awk '{print $2}')
  fi
  if [ -z "$deer_pw" ]; then
    warn "creds 文件没找到或读不到密码 ($DEERFLOW_CREDS_FILE)"
    warn "桥会起来但登录 DeerFlow 失败. 可手动: export DEER_FLOW_PASSWORD=xxx 重启桥"
  else
    export DEER_FLOW_PASSWORD="$deer_pw"
    log "✓ 读到 DeerFlow admin 密码: ${deer_pw:0:4}***"
  fi
  unset VIRTUAL_ENV
  nohup node_modules/.bin/tsx watch src/index.ts > "$LOGS/bridge.log" 2>&1 &
  echo $! > "$LOGS/bridge.pid"
  log "AG-UI 桥 PID=$(cat "$LOGS/bridge.pid"), 日志: $LOGS/bridge.log"
}

start_frontend() {
  log "启动 frontend (Next.js :3000)..."
  cd "$ROOT/frontend"
  if [ ! -d "node_modules" ]; then
    warn "frontend/node_modules 不存在. 请: cd frontend && npm install"
    return 1
  fi
  nohup npm run dev > "$LOGS/frontend.log" 2>&1 &
  echo $! > "$LOGS/frontend.pid"
  log "frontend PID=$(cat "$LOGS/frontend.pid"), 日志: $LOGS/frontend.log"
}

stop_all() {
  log "停止所有进程..."
  for name in backend bridge frontend; do
    pid_file="$LOGS/$name.pid"
    if [ -f "$pid_file" ]; then
      pid=$(cat "$pid_file")
      if kill "$pid" 2>/dev/null; then
        log "  $name (PID=$pid) 停止"
      fi
      rm "$pid_file"
    fi
  done
  # 兜底: 杀任何还占着 3 个端口的进程
  for port in 3000 8001 8002 8003; do
    pids=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
      log "  杀残留 $port: $pids"
      echo "$pids" | xargs -r kill -9 2>/dev/null || true
    fi
  done
}

case "${1:-all}" in
  backend)  start_backend ;;
  bridge)   start_bridge ;;
  frontend) start_frontend ;;
  all)
    start_backend
    start_bridge
    start_frontend
    log "全部启动完成!"
    log "  Frontend:   http://localhost:3000"
    log "  AG-UI 桥:   http://localhost:8001/api/copilotkit"
    log "  DeerFlow:   http://localhost:8002"
    log "  日志:       $LOGS/{backend,bridge,frontend}.log"
    log "  停:         bash scripts/dev.sh stop"
    log ""
    log "  ⚠️ 老板 2026-06-15 修订: 3 服务架构"
    log "     frontend :3000 → bridge :8001 → DeerFlow :8002 via LangGraph"
    ;;
  stop) stop_all ;;
  *) err "用法: $0 {backend|bridge|frontend|all|stop}"; exit 1 ;;
esac
