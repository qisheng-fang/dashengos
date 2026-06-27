#!/bin/bash
# DaShengOS 健康探活 — 可配 cron 定时执行
# 用法: ./scripts/health-probe.sh [--alert]
#   --alert: 失败时写入 /tmp/dasheng-alert.log

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALERT=0
[ "$1" = "--alert" ] && ALERT=1

FAILS=0
CHECKS=0

check() {
  local name=$1
  local url=$2
  local expect=$3
  CHECKS=$((CHECKS + 1))
  
  local resp=$(curl -s --max-time 5 "$url" 2>/dev/null)
  if [ -z "$resp" ]; then
    echo "❌ $name: 无响应"
    FAILS=$((FAILS + 1))
    return
  fi
  
  local actual=$(echo "$resp" | python3 -c "$expect" 2>/dev/null)
  if [ "$actual" != "OK" ]; then
    echo "❌ $name: $actual"
    FAILS=$((FAILS + 1))
  else
    echo "✅ $name"
  fi
}

# 1. 端口探活
check "端口 :8000" "http://127.0.0.1:8000/health" \
  "import sys,json; d=json.load(sys.stdin); print('OK' if d.get('status')=='ok' else d.get('status','DOWN'))"

check "端口 :3000" "http://127.0.0.1:3000" \
  "import sys; print('OK' if sys.stdin.read(1) else 'EMPTY')"

# 2. 数据库连通
check "DB sessions" "http://127.0.0.1:8000/api/status" \
  "import sys,json; d=json.load(sys.stdin); s=d.get('db',{}).get('sessions','-1'); print('OK' if isinstance(s,int) and s>=0 else 'NO_DB')"

# 3. 假响应检测 — 这是最关键的！
BE_STATUS=$(curl -s --max-time 5 http://127.0.0.1:8000/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
BE_VERSION=$(curl -s --max-time 5 http://127.0.0.1:8000/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version',''))" 2>/dev/null)

if [ "$BE_STATUS" = "ok" ] && [ "$BE_VERSION" = "mini-1.0" ]; then
  echo "🔴 致命: 检测到 mini-backend 假后端！版本=$BE_VERSION"
  FAILS=$((FAILS + 1))
elif [ "$BE_STATUS" = "ok" ]; then
  echo "✅ 后端版本: $BE_VERSION"
fi

# 汇总
echo ""
if [ "$FAILS" -eq 0 ]; then
  echo "✅ 全部 $CHECKS 项通过"
else
  echo "🔴 $FAILS/$CHECKS 项失败"
  if [ "$ALERT" = "1" ]; then
    echo "[$(date -Iseconds)] HEALTH_FAIL failures=$FAILS/$CHECKS" >> /tmp/dasheng-alert.log
  fi
fi

exit $FAILS
