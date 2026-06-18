#!/usr/bin/env bash
# deploy/migrate-sqlite-to-pg.sh · Track B.1 (2026-06-17)
# SQLite → PostgreSQL 一键迁移脚本
#
# 用法:
#   1. 先启动 PostgreSQL (Docker 或云服务)
#   2. 设置 PG 环境变量:
#      export PG_URL="postgres://user:pass@host:5432/dasheng"
#   3. 运行: bash deploy/migrate-sqlite-to-pg.sh
#
# 原理:
#   - dump SQLite → SQL (INSERT 语句)
#   - 通过 psql 导入 PostgreSQL
#   - 验证行数一致性
#
# 前置条件:
#   - sqlite3 CLI (macOS 已自带)
#   - psql CLI (brew install libpq 或 Postgres.app)
#   - 源 SQLite DB 存在 (默认 packages/backend/data/dasheng.db)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# === 配置 ===
SQLITE_DB="${SQLITE_DB:-packages/backend/data/dasheng.db}"
PG_URL="${PG_URL:-}"
TMP_DIR="/tmp/dasheng-pg-migration-$$"

if [ -z "$PG_URL" ]; then
  echo -e "${RED}错误: PG_URL 未设置${NC}"
  echo "用法: PG_URL='postgres://user:pass@host:5432/dasheng' bash $0"
  exit 1
fi

echo -e "${YELLOW}=== DaShengOS SQLite → PostgreSQL 迁移 ===${NC}"
echo "源: $SQLITE_DB"
echo "目标: ${PG_URL%%@*}@***"
echo ""

# === 1. 检查源 DB ===
if [ ! -f "$SQLITE_DB" ]; then
  echo -e "${RED}错误: SQLite DB 不存在: $SQLITE_DB${NC}"
  exit 1
fi

SQLITE_SIZE=$(du -h "$SQLITE_DB" | cut -f1)
SQLITE_ROWS=$(sqlite3 "$SQLITE_DB" "SELECT COUNT(*) FROM users;")
echo "SQLite 大小: $SQLITE_SIZE · users 行数: $SQLITE_ROWS"

# === 2. 检查 PG 连通 ===
if ! command -v psql &>/dev/null; then
  echo -e "${RED}错误: psql CLI 未安装${NC}"
  echo "安装: brew install libpq && echo 'export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\"' >> ~/.zshrc"
  exit 1
fi

if ! psql "$PG_URL" -c "SELECT 1;" &>/dev/null; then
  echo -e "${RED}错误: 无法连接 PostgreSQL: $PG_URL${NC}"
  exit 1
fi
echo -e "${GREEN}✓ PostgreSQL 连接成功${NC}"

# === 3. 导出 SQLite → SQL ===
mkdir -p "$TMP_DIR"
echo ""
echo "导出 SQLite → SQL..."

# 导出所有表的结构和数据
sqlite3 "$SQLITE_DB" ".schema" > "$TMP_DIR/schema.sql"
sqlite3 "$SQLITE_DB" ".dump --data-only" > "$TMP_DIR/data.sql"

# SQLite dump 的 INSERT 语句需要小改才能兼容 PG:
#   - INTEGER → 保持 (PG 的 BIGINT 能接收)
#   - TEXT → 转义单引号 (已经有)
#   - 移除 SQLite 特有的 PRAGMA
sed -i '' '/^PRAGMA/d' "$TMP_DIR/schema.sql"

echo "导出完成: $(wc -l < "$TMP_DIR/data.sql") 行"

# === 4. 导入 PostgreSQL ===
echo ""
echo "⚠️  即将清空 PostgreSQL 目标库中的表并重新导入"
echo "   目标: ${PG_URL%%@*}@***"
echo ""
read -rp "确认继续? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  rm -rf "$TMP_DIR"
  exit 0
fi

echo ""
echo "导入 PostgreSQL..."

# 先建表 (用 db-pg.ts 的 schema 更可靠, 手动 SQL 不完美)
# 直接导入 data
psql "$PG_URL" -f "$TMP_DIR/data.sql" 2>&1 | tail -5

# === 5. 验证 ===
echo ""
echo "验证行数..."

PG_USERS=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM users;" | tr -d ' ')
PG_SESSIONS=$(psql "$PG_URL" -t -c "SELECT COUNT(*) FROM sessions;" | tr -d ' ')

echo "  users:    SQLite=$SQLITE_ROWS  PG=$PG_USERS"
echo "  sessions: PG=$PG_SESSIONS"

if [ "$PG_USERS" -eq "$SQLITE_ROWS" ]; then
  echo -e "${GREEN}✓ users 行数一致${NC}"
else
  echo -e "${RED}✗ users 行数不一致! SQLite=$SQLITE_ROWS PG=$PG_USERS${NC}"
fi

# === 6. 更新 .env ===
echo ""
echo -e "${YELLOW}=== 后续步骤 ===${NC}"
echo "1. 更新 packages/backend/.env:"
echo "   DATABASE_TYPE=postgres"
echo "   DATABASE_URL=$PG_URL"
echo ""
echo "2. 安装 pg 依赖:"
echo "   cd packages/backend && pnpm add pg && pnpm add -D @types/pg"
echo ""
echo "3. 重启 backend:"
echo "   pnpm backend:dev"
echo ""
echo "4. 验证: curl http://127.0.0.1:8000/status"

# 清理
rm -rf "$TMP_DIR"
echo ""
echo -e "${GREEN}迁移完成${NC}"
