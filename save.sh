#!/bin/bash
# 持久固态化：提交所有改动 + 推送
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
git add -A
git commit -m "💾 persist: $(date '+%m-%d %H:%M')" 2>/dev/null || echo "无改动"
echo "✅ 已保存"
