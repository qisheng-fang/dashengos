#!/bin/bash
# kill-legacy-workers.sh · DaShengOS v0.3 · 2026-06-17
# 安全 kill 6 个旧 DaShengOS worker (9108-9113) · 跟 ai-workbench-v2 无关
#
# ⚠️ 警告: 这 6 个 worker 跑在 /Users/apple/Desktop/创造 AI工作台/workers/
#    跟 ai-workbench-v2 完全独立. 如果你还在用 "创造 AI工作台" 项目 (旧 DaShengOS),
#    kill 它们会破那个项目. 请先确认旧项目不再用.
#
# 6 个 worker 列表 (查 lsof -iTCP:9108-9113):
#   PID     端口  cwd 路径                                           进程         跑多久
#   41806   9113  .../workers/wechat-mp          python server.py   9d 3h
#   42363   9108  .../workers/pixelle-bridge    uvicorn server:app 5d 2h
#   42381   9109  .../workers/sau-bridge        uvicorn server:app 5d 2h
#   42404   9110  .../workers/handlers-bridge   uvicorn server:app 5d 2h
#   42422   9111  .../workers/video-parser-bridge uvicorn server:app 5d 2h
#   42440   9112  .../workers/douyin-bridge     uvicorn server:app 5d 2h
#
# 跑法:
#   ./deploy/kill-legacy-workers.sh        # 干跑 (只列, 不 kill)
#   ./deploy/kill-legacy-workers.sh --yes  # 真 kill (用 SIGTERM, 5s 后 SIGKILL)

set -e

PORTS=(9108 9109 9110 9111 9112 9113)
DO_KILL=false
[ "${1:-}" = "--yes" ] && DO_KILL=true

echo "=== 6 旧 worker 扫描 (端口: ${PORTS[*]}) ==="
echo ""

KILL_PIDS=()
for port in "${PORTS[@]}"; do
  pid=$(lsof -tiTCP:$port -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -z "$pid" ]; then
    echo "  :$port — (空闲)"
    continue
  fi
  cwd=$(lsof -p $pid 2>/dev/null | awk '/cwd/ {print $NF}' | head -1)
  cmd=$(ps -p $pid -o command= 2>/dev/null)
  etime=$(ps -p $pid -o etime= 2>/dev/null | tr -d ' ')
  # 判定: 走 CommandLineTools Python 3.9 + uvicorn server:app/server.py → 旧 DaShengOS worker
  #        走 python 3.11 (ai-workbench-v2) → ❌ 不动
  is_legacy="❓"
  if [[ "$cmd" == *"CommandLineTools"*Python*3.9* ]] && [[ "$cmd" == *"uvicorn server:app"* || "$cmd" == *"server.py"* ]]; then
    is_legacy="✅ 旧 DaShengOS worker (Python 3.9 + CommandLineTools + uvicorn server:app)"
  elif [[ "$cmd" == *"ai-workbench-v2"* ]] || [[ "$cmd" == *".venv/bin/python"* ]]; then
    is_legacy="❌ ai-workbench-v2 进程, 不要动"
  fi
  echo "  :$port  PID $pid  ($etime)  $is_legacy"
  echo "    cwd:   $cwd"
  echo "    cmd:   $(echo $cmd | head -c 80)"
  if [[ "$is_legacy" == *"✅"* ]]; then
    KILL_PIDS+=($pid)
  fi
  echo ""
done

if [ ${#KILL_PIDS[@]} -eq 0 ]; then
  echo "✅ 没找到旧 worker (要么跑了, 要么不是 DaShengOS)"
  exit 0
fi

echo "=== 待 kill: ${KILL_PIDS[*]} ==="
if [ "$DO_KILL" = false ]; then
  echo "干跑模式. 真 kill 跑: $0 --yes"
  exit 0
fi

echo "5s 后 SIGKILL 兜底, 先 SIGTERM ..."
for pid in "${KILL_PIDS[@]}"; do
  echo "  kill -TERM $pid"
  kill -TERM $pid 2>/dev/null || true
done

# 等 5s, 还没死的 SIGKILL
sleep 5
for pid in "${KILL_PIDS[@]}"; do
  if kill -0 $pid 2>/dev/null; then
    echo "  $pid 还活, SIGKILL 兜底"
    kill -KILL $pid 2>/dev/null || true
  else
    echo "  $pid 已退出 ✅"
  fi
done

echo ""
echo "=== 验证 ==="
for port in "${PORTS[@]}"; do
  if lsof -iTCP:$port -sTCP:LISTEN 2>/dev/null | grep -q LISTEN; then
    echo "  :$port — 还占着 (启动旧 worker 的脚本可能 supervisor 自动拉起)"
  else
    echo "  :$port — 释放 ✅"
  fi
done
