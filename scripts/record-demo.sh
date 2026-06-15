#!/bin/bash
# scripts/record-demo.sh · v0.3 Phase 5 收官
# Helper: 启完整 stack 准备录 5 分钟 demo
#
# 用法:
#   ./scripts/record-demo.sh                    # 启 backend + agent + daemon + web
#
# 录屏用 QuickTime / OBS / ScreenFlow, 这里只确保 stack 起来
# 跑法:
#   chmod +x scripts/record-demo.sh
#   ./scripts/record-demo.sh

set -e

cd "$(dirname "$0")/.."

echo "=== DaShengOS demo record helper ==="
echo

# 1. 检 keychain 是否有 SiliconFlow key
if [ ! -f ~/.workbuddy/credentials/OPENAI_API_KEY.env ] && [ -z "$OPENAI_API_KEY" ]; then
    echo "⚠️  OPENAI_API_KEY not set. DaSheng 集成可能返 stub."
    echo "   加 key:"
    echo "     echo 'sk-...' > ~/.workbuddy/credentials/OPENAI_API_KEY.env"
    echo "   或: export OPENAI_API_KEY=sk-..."
    echo
fi

# 2. 起 backend (port 8000)
echo "→ 启 backend (port 8000)..."
if lsof -ti :8000 > /dev/null 2>&1; then
    echo "   8000 已被占, 跳过"
else
    cd packages/backend
    pnpm dev > /tmp/demo-backend.log 2>&1 &
    echo "   PID: $!"
    sleep 3
    cd ../..
fi

# 3. 起 agent (port 8001, brain=deerflow)
echo "→ 启 agent (port 8001, brain=deerflow)..."
if lsof -ti :8001 > /dev/null 2>&1; then
    echo "   8001 已被占, 跳过"
else
    cd agent
    DASHENG_BRAIN_BACKEND=deerflow \
        /Users/apple/Desktop/DaShengOS\ 大师OS/backend/.venv/bin/python -m agent.main \
        > /tmp/demo-agent.log 2>&1 &
    echo "   PID: $!"
    sleep 3
    cd ..
fi

# 4. 起 deerflow daemon (Unix socket)
echo "→ 启 deerflow daemon (Unix socket /tmp/dasheng/deerflow.sock)..."
if [ -S /tmp/dasheng/deerflow.sock ]; then
    echo "   socket 已存在, 跳过"
else
    cd deerflow
    /Users/apple/Desktop/DaShengOS\ 大师OS/backend/.venv/bin/python -m deerflow.daemon \
        > /tmp/demo-daemon.log 2>&1 &
    echo "   PID: $!"
    sleep 2
    cd ..
fi

# 5. 起 web dev (port 3000)
echo "→ 启 web dev (port 3000)..."
if lsof -ti :3000 > /dev/null 2>&1; then
    echo "   3000 已被占, 跳过"
else
    cd apps/web
    pnpm dev > /tmp/demo-web.log 2>&1 &
    echo "   PID: $!"
    sleep 5
    cd ../..
fi

echo
echo "=== Stack up ==="
echo "  Backend:    http://127.0.0.1:8000"
echo "  Agent:      http://127.0.0.1:8001 (brain=deerflow)"
echo "  Daemon:     /tmp/dasheng/deerflow.sock"
echo "  Web dev:    http://127.0.0.1:3000"
echo
echo "→ 录屏! 用 QuickTime / OBS. 浏览器开 http://localhost:3000"
echo "→ 录完 kill:"
echo "    pkill -f 'agent.main|packages/backend|sandbox.daemon|web/dev'"
echo
echo "→ 看 log: tail -f /tmp/demo-{backend,agent,daemon,web}.log"
