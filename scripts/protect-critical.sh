#!/bin/bash
# DaShengOS 关键文件保护脚本
# 将系统提示词、配置、数据库设为只读，防止 AI Agent 误改

set -e

ROOT="/Users/apple/Desktop/ai-workbench-v2"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "🔒 DaShengOS 关键文件加固 — $TIMESTAMP"
echo ""

# ─── 绝对保护 (400 = 只读) ───
CRITICAL_FILES=(
  "packages/backend/src/core/harness/system-prompt.ts"
  "packages/backend/src/core/system-prompt-config.ts"
  ".codex-protect"
  ".codex-protect-hash"
  ".env.persist"
  "AGENTS.md"
)

echo "━━━ 🔴 绝对保护 (chmod 400) ━━━"
for f in "${CRITICAL_FILES[@]}"; do
  full="$ROOT/$f"
  if [ -f "$full" ]; then
    chmod 400 "$full"
    echo "  ✅ $f → 400 (只读)"
  else
    echo "  ⚠️  $f → 文件不存在"
  fi
done

# ─── 启动脚本保护 (500 = 只读+可执行) ───
PROTECTED_SCRIPTS=(
  "start.sh"
  "restart.sh"
  "scripts/protect-critical.sh"
)

echo ""
echo "━━━ 🟡 启动脚本保护 (chmod 500) ━━━"
for f in "${PROTECTED_SCRIPTS[@]}"; do
  full="$ROOT/$f"
  if [ -f "$full" ]; then
    chmod 500 "$full"
    echo "  ✅ $f → 500 (只读+执行)"
  fi
done

# ─── DB 文件保护 ───
echo ""
echo "━━━ 🗄️ 数据库保护 ━━━"
DB_PATH="$ROOT/packages/backend/data/dasheng.db"
if [ -f "$DB_PATH" ]; then
  chmod 600 "$DB_PATH"
  echo "  ✅ dasheng.db → 600"
fi

# ─── 备份当前哈希 ───
echo ""
echo "━━━ 📝 更新哈希 ━━━"
CURRENT_HASH=$(shasum -a 256 "$ROOT/packages/backend/src/core/harness/system-prompt.ts" 2>/dev/null | cut -d' ' -f1)
if [ -n "$CURRENT_HASH" ]; then
  echo "$CURRENT_HASH" > "$ROOT/.codex-protect-hash"
  chmod 400 "$ROOT/.codex-protect-hash"
  echo "  ✅ 哈希已更新: ${CURRENT_HASH:0:16}..."
fi

echo ""
echo "═══════════════════════════════════════"
echo "  加固完成 — $TIMESTAMP"
echo "  解除保护: chmod 644 <文件>"
echo "═══════════════════════════════════════"
