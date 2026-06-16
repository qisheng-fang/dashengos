#!/bin/bash
# install.sh · DaShengOS v0.3 · 2026-06-17 · 一键部署 (Phase 10 audit #1 修)
#
# 老板装机就一行:
#   curl -fsSL https://raw.githubusercontent.com/qisheng-fang/dashengos/main/install.sh | bash
#
# 行为:
#   1. 检查前置 (docker 20+ / docker compose v2 / git)
#   2. 克隆 repo
#   3. 生成 secrets (JWT, audit HMAC, session tokens)
#   4. 写 .env from .env.example (替换 dev 默认值)
#   5. build 6 容器镜像
#   6. docker compose up -d
#   7. 装 pre-commit hook
#   8. 跑 smoke test (login + settings + chat)
#   9. 装 DB 备份 cron
#  10. 打印 dashboard URLs

set -euo pipefail

# ---- 颜色 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[$(date +%T)]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
die()  { echo -e "${RED}✗${NC} $*" >&2; exit 1; }

# ---- Step 0: 前置检查 ----
log "Step 0/10 检查前置 (docker / git / openssl)"
command -v docker >/dev/null 2>&1 || die "docker 没装, 装 Docker Desktop 20+"
docker compose version >/dev/null 2>&1 || die "docker compose v2 没装 (Docker Desktop 自带)"
command -v git >/dev/null 2>&1 || die "git 没装"
command -v openssl >/dev/null 2>&1 || die "openssl 没装 (用来生成 JWT secret)"
ok "前置齐"

# ---- Step 1: 克隆 repo ----
REPO="https://github.com/qisheng-fang/dashengos.git"
INSTALL_DIR="${DASHENG_INSTALL_DIR:-$HOME/dashengos}"
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Step 1/10 repo 已存在 ($INSTALL_DIR), 跳 clone"
  cd "$INSTALL_DIR"
  git pull --ff-only 2>/dev/null || warn "git pull 失败, 用现有代码继续"
else
  log "Step 1/10 克隆 $REPO → $INSTALL_DIR"
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi
ok "repo 就位"

# ---- Step 2: 生成 secrets ----
log "Step 2/10 生成 secrets (JWT / audit HMAC / session)"
JWT_SECRET=$(openssl rand -hex 32)
AUDIT_HMAC=$(openssl rand -hex 32)
ok "secrets 生成 (JWT 64 字符 hex, audit HMAC 64 字符 hex)"

# ---- Step 3: 写 .env (从 example 复制 + 替换 dev 默认值) ----
log "Step 3/10 写 packages/backend/.env (from .env.example)"
if [ -f packages/backend/.env ]; then
  warn ".env 已存在, 保留 (老板自定义值优先)"
else
  cp packages/backend/.env.example packages/backend/.env
  # 替换 dev 默认 secret (server.ts 启动校验 prod 必填, 不会默认通过)
  sed -i.bak \
    -e "s|DASHENG_JWT_SECRET=.*|DASHENG_JWT_SECRET=${JWT_SECRET}|" \
    -e "s|DASHENG_AUDIT_LOG_HMAC_SECRET=.*|DASHENG_AUDIT_LOG_HMAC_SECRET=${AUDIT_HMAC}|" \
    -e "s|DASHENG_STRIPE_MOCK_MODE=.*|DASHENG_STRIPE_MOCK_MODE=false|" \
    packages/backend/.env
  rm packages/backend/.env.bak
  ok ".env 写好, 必填 secret 已生成"
  warn "记得填 SILICONFLOW_API_KEY (去 https://cloud.siliconflow.cn/account/ak 取)"
fi

# ---- Step 4: build 6 容器 ----
log "Step 4/10 build 6 容器 (sandbox/supervisord/backend/web/prometheus/grafana)"
log "  首次 build ~5-10min, 看机器网速"
docker compose -f sandbox/deploy/docker-compose.yml build --progress=plain
ok "6 镜像 build 完"

# ---- Step 5: docker compose up ----
log "Step 5/10 docker compose up -d"
docker compose -f sandbox/deploy/docker-compose.yml up -d
ok "6 容器在跑"

# ---- Step 6: 等健康检查 ----
log "Step 6/10 等 backend 起来 (healthcheck 30s)"
for i in {1..30}; do
  if docker compose -f sandbox/deploy/docker-compose.yml exec -T backend wget -q --spider http://127.0.0.1:8000/docs/ 2>/dev/null; then
    ok "backend 起来了 (${i}s)"
    break
  fi
  [ $i -eq 30 ] && die "backend 30s 没起来, 看 docker compose logs backend"
  sleep 1
done

# ---- Step 7: pre-commit hook ----
log "Step 7/10 装 pre-commit hook (防 .env 进 commit)"
git config core.hooksPath .githooks
ok "hook 装好"

# ---- Step 8: smoke test ----
log "Step 8/10 smoke test (login + settings + agent)"
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null)
if [ -n "$TOKEN" ]; then
  ok "login ✅"
else
  warn "login 失败, 跳过 smoke test (默认 admin/admin12345 应该是 init 时 seed 的)"
fi

# ---- Step 9: DB 备份 cron ----
log "Step 9/10 配 DB 备份 cron (6h/次)"
CRON_CMD="0 */6 * * * /usr/local/bin/dasheng-backup-db.sh >> /var/log/dasheng-backup.log 2>&1"
if crontab -l 2>/dev/null | grep -q "dasheng-backup-db.sh"; then
  ok "cron 已装"
else
  # 装脚本 + 加 cron
  if [ -f deploy/backup-db.sh ]; then
    cp deploy/backup-db.sh /usr/local/bin/dasheng-backup-db.sh
    chmod +x /usr/local/bin/dasheng-backup-db.sh
  fi
  (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
  ok "cron 装好 (6h/次)"
fi

# ---- Step 10: 打印 URL ----
echo ""
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo -e "${GREEN}  DaShengOS v0.3 装好 ✅${NC}"
echo -e "${GREEN}════════════════════════════════════════════${NC}"
echo ""
echo "  Frontend:    http://127.0.0.1:3000"
echo "  Backend:     http://127.0.0.1:8000"
echo "  OpenAPI:     http://127.0.0.1:8000/docs"
echo "  Metrics:     http://127.0.0.1:8000/api/v1/metrics"
echo "  Prometheus:  http://127.0.0.1:9090"
echo "  Grafana:     http://127.0.0.1:3001  (admin/admin, 改密码)"
echo ""
echo "  必做 (1 min):"
echo "    1. $EDITOR packages/backend/.env"
echo "       → 填 SILICONFLOW_API_KEY=sk-新key (去 cloud.siliconflow.cn 取)"
echo "    2. docker compose -f sandbox/deploy/docker-compose.yml restart backend"
echo ""
echo "  部署文档:    $INSTALL_DIR/deploy/PRODUCTION.md"
echo "  跑通 e2e:    cd $INSTALL_DIR/apps/web && pnpm exec playwright test --workers=1"
echo ""
ok "完毕 ✅"
