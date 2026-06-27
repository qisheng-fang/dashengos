#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "══ DaShengOS 启动 ══"

# 清理
lsof -ti :8000 :3000 2>/dev/null | xargs kill -9 2>/dev/null || true
screen -wipe 2>/dev/null || true
sleep 1

# 沙箱守护进程（工具执行必需）
echo "→ 沙箱守护进程"
screen -S dasheng-sandbox -X quit 2>/dev/null || true
sleep 0.5
screen -dmS dasheng-sandbox ./sandbox/bin/sandbox --socket /tmp/dasheng/sandbox.sock
sleep 1

# 后端
echo "→ 后端 :8000"
screen -dmS dasheng-backend ./node_modules/.bin/tsx packages/backend/src/server.ts

# 前端
echo "→ 前端 :3000"
cd apps/web
# 前端 Vite dev server (即时编译 + HMR) — launchd 管理
launchctl unload ~/Library/LaunchAgents/com.dasheng.frontend.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.dasheng.frontend.plist 2>/dev/null || true
cd "$ROOT"

# 等就绪
for i in $(seq 1 15); do
  sleep 1
  FE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null || echo 0)
  [ "$FE" = "200" ] && break
done

echo ""
echo "后端: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v1/health)"
echo "前端: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000)"
echo "══ http://localhost:3000 ══"
