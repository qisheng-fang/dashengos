#!/bin/bash
# DaShengOS 快速重启（不重做检查，只重启服务）
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "🔄 重启 DaShengOS..."

lsof -ti :8000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
screen -S dasheng-backend -X quit 2>/dev/null || true
screen -S dasheng-frontend -X quit 2>/dev/null || true
sleep 2

screen -dmS dasheng-backend bash -c './node_modules/.bin/tsx packages/backend/src/server.ts 2>&1'
cd apps/web && screen -dmS dasheng-frontend bash -c 'npx vite --host 127.0.0.1 --port 3000 2>&1'

sleep 4
echo "后端: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v1/health)"
echo "前端: $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000)"
echo "✅ 完成"
