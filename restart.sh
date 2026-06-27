#!/bin/bash
# DaShengOS v6.1 快速重启 — 保留端口检查，增加等待轮询
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "🔄 重启 DaShengOS v6.1..."

# ─── 停止旧进程 ─────────────────────────────────────────
lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
launchctl unload ~/Library/LaunchAgents/com.dasheng.backend.plist 2>/dev/null || true
screen -S dasheng-backend -X quit 2>/dev/null || true
screen -S dasheng-frontend -X quit 2>/dev/null || true
screen -wipe 2>/dev/null || true
sleep 2

# ─── 确认端口释放 ─────────────────────────────────────────
for port in 8000 3000; do
  if lsof -ti :$port >/dev/null 2>&1; then
    echo "🔴 端口 :$port 仍被占用，强制释放..."
    lsof -ti :$port | xargs kill -9 2>/dev/null
    sleep 2
  fi
done

# ─── 启动后端 ─────────────────────────────────────────────
echo "→ 后端 :8000"
NODE_BIN=$(which node 2>/dev/null || echo "node")
screen -dmS dasheng-backend "$NODE_BIN" packages/backend/dist/server.js

# ─── 启动前端 ─────────────────────────────────────────────
echo "→ 前端 :3000"
cd apps/web
screen -dmS dasheng-frontend npx vite --host 127.0.0.1 --port 3000
cd "$ROOT"

# ─── 等待就绪 (最多20秒) ──────────────────────────────────
echo -n "等待就绪"
BE_OK=0
FE_OK=0
for i in $(seq 1 20); do
  sleep 1
  echo -n "."
  if [ "$FE_OK" = "0" ]; then
    FE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null || echo 0)
    [ "$FE" = "200" ] && FE_OK=1
  fi
  if [ "$BE_OK" = "0" ]; then
    BE=$(curl -s http://127.0.0.1:8000/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    [ "$BE" = "ok" ] && BE_OK=1
  fi
  [ "$BE_OK" = "1" ] && [ "$FE_OK" = "1" ] && break
done
echo ""

# ─── 结果汇报 ─────────────────────────────────────────────
BE_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/health 2>/dev/null || echo "000")
FE_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 2>/dev/null || echo "000")

echo "后端: $BE_CODE"
echo "前端: $FE_CODE"

if [ "$BE_CODE" = "200" ] && [ "$FE_CODE" = "200" ]; then
  echo "✅ 完成 — http://localhost:3000"
else
  echo "⚠️  部分服务未就绪，请检查日志"
fi
