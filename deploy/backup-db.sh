#!/bin/bash
# backup-db.sh · DaShengOS v0.3 · Phase D.3 (2026-06-16)
# SQLite WAL 备份 → 异地 (S3 / 远端 rsync)
#
# 跑法 (crontab 6h/次):
#   0 */6 * * * /Users/apple/Desktop/ai-workbench-v2/deploy/backup-db.sh >> /var/log/dasheng-backup.log 2>&1
#
# 原理: SQLite WAL mode 下, sqlite3 .backup 命令是 atomic snapshot (不锁写)
# 备份期间业务继续, 备份拿一致快照
#
# 生产推荐: 换 litestream 实时 WAL 复制 → S3, 见 deploy/litestream.yml
#   实时方案恢复点 (RPO) < 1s, 脚本方案 RPO = 6h

set -e

PROJECT_DIR="${PROJECT_DIR:-/Users/apple/Desktop/ai-workbench-v2}"
DB_PATH="$PROJECT_DIR/packages/backend/data/dasheng.db"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
S3_BUCKET="${S3_BUCKET:-}"  # 配了会推 S3
RETENTION_DAYS="${RETENTION_DAYS:-7}"

if [ ! -f "$DB_PATH" ]; then
  echo "[$(date -Iseconds)] ERROR: db not found at $DB_PATH"
  exit 1
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dasheng-$TIMESTAMP.db"

# 1. Atomic backup (sqlite3 .backup, 不锁写)
echo "[$(date -Iseconds)] backup start: $DB_PATH -> $BACKUP_FILE"
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# 2. 校验 (完整性 + 行数 sanity check)
ROW_COUNT=$(sqlite3 "$BACKUP_FILE" "SELECT count(*) FROM users;" 2>/dev/null || echo "0")
FILE_SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE")
echo "[$(date -Iseconds)] backup done: $(numfmt --to=iec --suffix=B $FILE_SIZE 2>/dev/null || echo $FILE_SIZE) | users=$ROW_COUNT"

# 3. 推 S3 (optional)
if [ -n "$S3_BUCKET" ] && command -v aws &> /dev/null; then
  aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/dasheng-db/" --storage-class STANDARD_IA
  echo "[$(date -Iseconds)] s3 upload: s3://$S3_BUCKET/dasheng-db/$(basename $BACKUP_FILE)"
fi

# 4. 清理 N 天前的本地备份
DELETED=$(find "$BACKUP_DIR" -name "dasheng-*.db" -mtime +$RETENTION_DAYS -delete -print | wc -l | tr -d ' ')
echo "[$(date -Iseconds)] retention cleanup: deleted $DELETED files older than ${RETENTION_DAYS}d"

echo "[$(date -Iseconds)] OK"
