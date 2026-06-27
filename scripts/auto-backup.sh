#!/bin/bash
# DaShengOS 自动备份脚本
# 每6小时运行一次，保留最近30个快照

set -e

ROOT="/Users/apple/Desktop/ai-workbench-v2"
BACKUP_DIR="$ROOT/backups"
TIMESTAMP=$(date -u +%Y-%m-%d-%H%M)
KEEP_COUNT=30

mkdir -p "$BACKUP_DIR"

echo "[$(date)] 🔄 自动备份开始..."

# 1. 备份数据库
DB_SRC="$ROOT/packages/backend/data/dasheng.db"
if [ -f "$DB_SRC" ]; then
  cp "$DB_SRC" "$BACKUP_DIR/dasheng-$TIMESTAMP.db"
  echo "  ✅ DB → dasheng-$TIMESTAMP.db"
fi

# 2. 备份系统提示词
PROMPT_SRC="$ROOT/packages/backend/src/core/harness/system-prompt.ts"
if [ -f "$PROMPT_SRC" ]; then
  cp "$PROMPT_SRC" "$BACKUP_DIR/dasheng-$TIMESTAMP.prompt.ts"
  echo "  ✅ 提示词 → dasheng-$TIMESTAMP.prompt.ts"
fi

# 3. 备份 .env.persist
ENV_SRC="$ROOT/.env.persist"
if [ -f "$ENV_SRC" ]; then
  cp "$ENV_SRC" "$BACKUP_DIR/dasheng-$TIMESTAMP.env"
  echo "  ✅ 环境变量 → dasheng-$TIMESTAMP.env"
fi

# 4. 备份 MCP 配置（从 DB 导出）
MCP_JSON="$BACKUP_DIR/dasheng-$TIMESTAMP.mcp.json"
sqlite3 "$DB_SRC" "SELECT json_group_array(json_object('id', id, 'name', name, 'status', status)) FROM mcp_servers;" 2>/dev/null > "$MCP_JSON" || echo '[]' > "$MCP_JSON"
echo "  ✅ MCP配置 → dasheng-$TIMESTAMP.mcp.json"

# 5. 备份 Provider 配置
PROVIDER_JSON="$BACKUP_DIR/dasheng-$TIMESTAMP.providers.json"
sqlite3 "$DB_SRC" "SELECT json_group_array(json_object('id', id, 'name', name, 'enabled', enabled)) FROM llm_providers WHERE enabled=1;" 2>/dev/null > "$PROVIDER_JSON" || echo '[]' > "$PROVIDER_JSON"
echo "  ✅ Provider配置 → dasheng-$TIMESTAMP.providers.json"

# 6. 轮转：只保留最近 KEEP_COUNT 个快照
echo ""
echo "  🧹 清理旧备份 (保留最近 $KEEP_COUNT 个)..."
for pattern in "dasheng-*.db" "dasheng-*.prompt.ts" "dasheng-*.env" "dasheng-*.mcp.json" "dasheng-*.providers.json"; do
  ls -1t "$BACKUP_DIR/$pattern" 2>/dev/null | tail -n +$((KEEP_COUNT + 1)) | while read -r old; do
    rm -f "$old"
    echo "    删除: $(basename "$old")"
  done
done

# 7. 验证备份完整性
LATEST_DB=$(ls -1t "$BACKUP_DIR"/dasheng-*.db 2>/dev/null | head -1)
if [ -f "$LATEST_DB" ]; then
  DB_SIZE=$(stat -f%z "$LATEST_DB" 2>/dev/null || stat -c%s "$LATEST_DB" 2>/dev/null || echo 0)
  echo ""
  echo "  📊 最新备份: $(basename "$LATEST_DB") (${DB_SIZE} bytes)"
fi

BACKUP_COUNT=$(ls "$BACKUP_DIR"/dasheng-*.db 2>/dev/null | wc -l | tr -d ' ')
echo "  📦 备份总数: $BACKUP_COUNT"
echo "[$(date)] ✅ 自动备份完成"
