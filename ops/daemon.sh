#!/bin/bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  DaShengOS 服务守护进程 — 持续在线，自动重启               ║
# ║  仅在 LLM API key 欠费时终止                                ║
# ╚══════════════════════════════════════════════════════════════╝

set -e
cd "$(dirname "$0")/.."
WORKSPACE="$(pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S)]${NC} $1"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✅${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] ⚠️${NC} $1"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S)] ❌${NC} $1"; }

# ═══════════════════════════════════════════════════
# 检查 LLM API 是否可用（欠费=唯一允许停止的原因）
# ═══════════════════════════════════════════════════
check_llm_available() {
  local key="${DEEPSEEK_API_KEY:-}"
  [ -z "$key" ] && source "$WORKSPACE/packages/backend/.env" 2>/dev/null
  key="${DEEPSEEK_API_KEY:-}"
  [ -z "$key" ] && return 0  # 没有 key 配就跳过检查
  
  local resp=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $key" \
    "https://api.deepseek.com/v1/models" 2>/dev/null)
  
  if [ "$resp" = "402" ]; then
    err "DEEPSEEK API 余额不足 (HTTP 402) — 停止守护"
    return 1
  fi
  return 0
}

# ═══════════════════════════════════════════════════
# Redis
# ═══════════════════════════════════════════════════
ensure_redis() {
  if redis-cli ping &>/dev/null; then
    return 0
  fi
  warn "Redis 离线，启动中..."
  brew services start redis &>/dev/null || redis-server --daemonize yes &>/dev/null
  sleep 2
  redis-cli ping &>/dev/null && ok "Redis :6379" || err "Redis 启动失败"
}

# ═══════════════════════════════════════════════════
# 后端 :8000
# ═══════════════════════════════════════════════════
ensure_backend() {
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/health/ping 2>/dev/null | grep -q 200; then
    return 0
  fi
  
  warn "后端 :8000 离线，重启中..."
  pkill -9 -f "tsx.*server" 2>/dev/null || true
  sleep 2
  
  cd "$WORKSPACE/packages/backend"
  screen -dmS dasheng-backend zsh -c "npx tsx src/server.ts 2>&1 | tee /tmp/dasheng-backend.log"
  sleep 8
  
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/v1/health/ping 2>/dev/null | grep -q 200; then
    ok "后端 :8000"
    return 0
  fi
  err "后端启动失败，查看 /tmp/dasheng-backend.log"
  return 1
}

# ═══════════════════════════════════════════════════
# 前端 :3000
# ═══════════════════════════════════════════════════
ensure_frontend() {
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null | grep -q 200; then
    return 0
  fi
  
  warn "前端 :3000 离线，重启中..."
  pkill -9 -f "vite" 2>/dev/null || true
  sleep 2
  
  cd "$WORKSPACE/apps/web"
  screen -dmS dasheng-frontend zsh -c "npx vite --host 0.0.0.0 --port 3000 2>&1 | tee /tmp/dasheng-frontend.log"
  sleep 5
  
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null | grep -q 200; then
    ok "前端 :3000"
    return 0
  fi
  err "前端启动失败"
  return 1
}

# ═══════════════════════════════════════════════════
# DeerFlow Gateway :8002
# ═══════════════════════════════════════════════════
ensure_deerflow() {
  if curl -s -o /dev/null http://127.0.0.1:8002/health 2>/dev/null; then
    return 0
  fi
  
  local venv="$WORKSPACE/agent/.venv/bin/python3"
  if [ ! -f "$venv" ]; then
    warn "DeerFlow venv 不存在，跳过"
    return 0
  fi
  
  warn "DeerFlow :8002 离线，启动中..."
  screen -dmS dasheng-deerflow zsh -c "cd $WORKSPACE/agent && $venv -m deerflow.gateway 2>&1 | tee /tmp/dasheng-deerflow.log"
  sleep 5
  
  if curl -s -o /dev/null http://127.0.0.1:8002/health 2>/dev/null; then
    ok "DeerFlow :8002"
  else
    warn "DeerFlow 启动中（非关键服务）"
  fi
}

# ═══════════════════════════════════════════════════
# 沙箱
# ═══════════════════════════════════════════════════
ensure_sandbox() {
  if screen -ls 2>/dev/null | grep -q "dasheng-sandbox"; then
    return 0
  fi
  
  warn "沙箱离线，启动中..."
  screen -dmS dasheng-sandbox zsh -c "echo 'Sandbox ready' && while true; do sleep 3600; done"
  ok "沙箱"
}

# ═══════════════════════════════════════════════════
# 主循环
# ═══════════════════════════════════════════════════

log "DaShengOS 服务守护启动"
log "工作区: $WORKSPACE"
echo ""

CHECK_INTERVAL=15   # 每15秒检查一次
LLM_CHECK_INTERVAL=300  # 每5分钟检查一次 LLM 余额
llm_check_counter=$LLM_CHECK_INTERVAL

while true; do
  # 定期检查 LLM 余额
  if [ $llm_check_counter -ge $LLM_CHECK_INTERVAL ]; then
    check_llm_available || { warn "LLM 欠费，暂停检查 30 分钟..."; sleep 1800; llm_check_counter=0; continue; }
    llm_check_counter=0
  fi
  
  ensure_redis
  ensure_backend
  ensure_frontend
  ensure_deerflow
  ensure_sandbox
  
  sleep $CHECK_INTERVAL
  llm_check_counter=$((llm_check_counter + CHECK_INTERVAL))
done
