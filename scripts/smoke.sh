#!/usr/bin/env bash
# Day 0 · E2E 验收脚本
# 老板原则: 改后先 pytest / 端到端验证 (Day 67 自欺警钟)
# 验收 2 关 (P0 简化版 — 老板 2026-06-14 修订后只剩 2 进程):
#   ✅ 关1: DeerFlow Lead Agent health 200 (替代原来的 backend + runtime)
#   ✅ 关2: frontend HTTP 200 (CopilotKit React app)

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

check() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" || echo "000")
  if [ "$code" = "200" ]; then
    pass "$name  ($url)  → 200"
  else
    fail "$name  ($url)  → $code (期望 200)"
  fi
}

echo "━━━ 关1: DeerFlow Lead Agent health ━━━"
check "DeerFlow /health"         "http://localhost:8002/health"

echo ""
echo "━━━ 关2: frontend HTTP 200 ━━━"
check "frontend /"               "http://localhost:3000"

echo ""
echo "━━━ 汇总 ━━━"
echo "🎉 P0 骨架 2/2 全过 — Day 0 hello world 跑通"
echo ""
echo "  ⚠️ 老板 2026-06-14 修订: 不再有 CopilotKit Runtime 层"
echo "     进程数从 3 减到 2 (frontend + deer-flow)"
echo "     AG-UI 直连 DeerFlow"
echo ""
echo "下一步: P1 阶段 — 接 DeerFlow Lead Agent 真 AG-UI endpoint,"
echo "        注册 1 mock tool (e.g. '现在几点了')"
