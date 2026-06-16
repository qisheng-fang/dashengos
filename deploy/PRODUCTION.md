# DaShengOS v0.3 · Production 部署文档

> 2026-06-17 · Stream 5 audit 配套
> 适用: v0.3 B 方案 (apps/web + packages/backend + agent/ + deerflow)
> 前提: 已 `git clone` + `cd ai-workbench-v2`

---

## 0. 老板必看 (部署前 5 分钟)

### 🚨 部署前必做 (机器做不了, 你要手动)

```bash
# 1. revoke 旧 SiliconFlow key
#    去 https://cloud.siliconflow.cn/account/ak 删 sk-wtpelv... 建新 key

# 2. 改 packages/backend/.env
cat >> packages/backend/.env << 'EOF'

# 老板新 key (生产, 走 1Password 存)
SILICONFLOW_API_KEY=sk-NEW_KEY_HERE

# Prod 必填
DASHENG_JWT_SECRET=$(openssl rand -hex 32)     # 64 字符 hex
DASHENG_STRIPE_MOCK_MODE=false
DASHENG_STRIPE_WEBHOOK_SECRET=whsec_xxx_from_stripe_dashboard

# Prod 必开 auth
DASHENG_REQUIRE_AUTH=true

# Node 环境
NODE_ENV=production
EOF
```

**🚨 不然 server.ts 启动直接 process.exit(1) (B.1 + D.7 启动校验)**

### ✅ 部署前自动检查

```bash
# 跑 deploy/scripts/pre-deploy-check.sh (下面有)
# 或手检:
[ -n "$SILICONFLOW_API_KEY" ] && [[ ! $SILICONFLOW_API_KEY == dev-* ]] && echo "✅ SiliconFlow key 改完"
[ "$DASHENG_STRIPE_MOCK_MODE" == "false" ] && echo "✅ Stripe mock 关"
[ ${#DASHENG_JWT_SECRET} -ge 32 ] && [[ ! $DASHENG_JWT_SECRET == dev-* ]] && echo "✅ JWT secret 强"
```

---

## 1. 5 步部署 (15 min)

### Step 1: 拉代码 + 装 pre-commit hook

```bash
git clone git@github.com:qisheng-fang/dashengos.git /opt/dashengos
cd /opt/dashengos
git config core.hooksPath .githooks       # 防 .env / secret 误 commit (D.1)
pnpm install
```

### Step 2: 配 env

```bash
# Backend (.env 已在 gitignore)
cp packages/backend/.env.example packages/backend/.env
$EDITOR packages/backend/.env
# ↑ 必填: SILICONFLOW_API_KEY, DASHENG_JWT_SECRET, DASHENG_STRIPE_WEBHOOK_SECRET

# Agent (单独 .env, 默认读 process.env)
cat > agent/.env << 'EOF'
DASHENG_BRAIN_BACKEND=deerflow
DASHENG_REQUIRE_AUTH=true
DASHENG_AUTH_TOKEN=<跟 backend DASHENG_JWT_SECRET 一样>
DASHENG_CORS_ORIGINS=https://app.example.com
DASHENG_RATE_LIMIT=300
EOF
```

### Step 3: 起 DB + 备份 cron

```bash
# 备份脚本 (Phase D.3)
crontab -e
# 加: 0 */6 * * * /opt/dashengos/deploy/backup-db.sh >> /var/log/dasheng-backup.log 2>&1

# S3 备份 (推荐, RPO < 6h)
export S3_BUCKET=dasheng-prod-db-backups
echo "export S3_BUCKET=$S3_BUCKET" >> ~/.bashrc
```

### Step 4: 起 4 服务

```bash
# 用 docker compose (推荐) 或裸跑
docker compose -f docker-compose.yml up -d

# 裸跑参考
# Backend
cd packages/backend && pnpm dev &

# Agent bridge
cd agent && ./.venv/bin/python -m agent.main &

# DeerFlow daemon
cd deerflow && python -m deerflow.daemon &

# Frontend (Vite preview for prod)
cd apps/web && pnpm build && pnpm preview &
```

### Step 5: Caddy TLS 终止

```bash
# 装 Caddy (macOS: brew install caddy; Linux: apt install caddy)
caddy run --config deploy/Caddyfile

# 验证
curl -I https://app.example.com/api/v1/system/status
# 应返 200 + HSTS header
```

---

## 2. 部署后必查 (smoke test)

```bash
# A. Backend 起来 + JWT 工作
TOKEN=$(curl -s -X POST https://app.example.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD"}' \
  | jq -r .access_token)
echo $TOKEN | head -c 30
# 应 200 + JWT 形如 eyJ...

# B. CORS 严
curl -s -X OPTIONS https://app.example.com/api/agent \
  -H 'Origin: https://app.example.com' \
  -H 'Access-Control-Request-Method: POST' \
  -D - -o /dev/null | grep -iE 'access-control|allow'
# 应有 allow-origin / allow-credentials

# C. X-Request-Id 贯穿
curl -s -D - -o /dev/null \
  -H "X-Request-Id: req_smoke_$(date +%s)" \
  -H "Authorization: Bearer $TOKEN" \
  https://app.example.com/api/v1/system/status | grep -i x-request-id
# 应回: x-request-id: req_smoke_xxx

# D. Stripe webhook 真验签 (没签名应 400)
curl -s -X POST https://app.example.com/api/v1/billing/stripe/webhook \
  -H 'Content-Type: application/json' \
  -d '{"type":"customer.subscription.updated","data":{"object":{}}}'
# 应: {"code":"SIGNATURE_INVALID"}

# E. Phase A 真持久化
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"sk-smoke-test"}' \
  https://app.example.com/api/v1/settings/provider/siliconflow
# 应: {"ok":true,"hasKey":true,"provider":"siliconflow"}

# 5 min 后 kill backend, 重启, 再 GET /settings → 还应 hasKey=true (持久化验)
```

---

## 3. 监控 + 告警 (Stream 5 audit P0-5)

### 装 Prometheus + Grafana

```bash
# Docker
docker run -d --name prometheus \
  -v /opt/dashengos/sandbox/deploy/monitoring/prometheus.yml:/etc/prometheus/prometheus.yml \
  -v /opt/dashengos/sandbox/deploy/monitoring/rules:/etc/prometheus/rules \
  -p 127.0.0.1:9090:9090 \
  prom/prometheus

# 验 rules 加载
curl -s http://127.0.0.1:9090/api/v1/rules | jq '.data.groups[].name'
# 应有 4 组: dasheng-up / dasheng-errors / dasheng-latency / dasheng-resources
```

### Alertmanager (邮件 / 钉钉 webhook)

```bash
docker run -d --name alertmanager \
  -v /opt/dashengos/sandbox/deploy/monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml \
  -p 127.0.0.1:9093:9093 \
  prom/alertmanager
```

钉钉 webhook 模板见 [alertmanager.yml 示例](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config)。

### Grafana Dashboard

```bash
docker run -d --name grafana \
  -v /opt/dashengos/sandbox/deploy/monitoring/grafana-provisioning:/etc/grafana/provisioning \
  -p 127.0.0.1:3001:3000 \
  grafana/grafana
# http://127.0.0.1:3001  admin/admin (改密码)
```

---

## 4. Runbook (常见故障)

| 症状 | 诊断 | 修法 |
|---|---|---|
| **登录 401** | 看 `packages/backend/data/dasheng.db` `login_attempts` 表 | 等 15min 自动解锁 或 `DELETE FROM login_attempts;` |
| **登录 429** | 锁了, 看 Retry-After 头 | 同上, 改客户端加退避 |
| **Stripe webhook 400 SIGNATURE_INVALID** | Stripe dashboard 没配 webhook secret | 去 Stripe 拿 `whsec_...` 填 `DASHENG_STRIPE_WEBHOOK_SECRET` |
| **Backend 启动直接 exit(1)** | log 有 `🚨 FATAL` | 检查: `DASHENG_JWT_SECRET` 不能 dev-only / `DASHENG_STRIPE_MOCK_MODE=false` 必填 webhook secret / `DASHENG_REQUIRE_AUTH=true` |
| **Chat 死 (前端 "agent bridge unreachable")** | 看 :8001 health | CORS (8ed7dde 修了) / agent bridge 没起 / DASHENG_REQUIRE_AUTH 前端没 token |
| **tools/:id/invoke 403** | 没 tool_permissions | `INSERT INTO tool_permissions VALUES('tp_admin', NULL, 'ADMIN', '*', 1, 0);` |
| **DB 文件超大** | `du -sh packages/backend/data/dasheng.db` | 跑 `deploy/backup-db.sh` 然后考虑迁 Postgres |
| **5xx rate > 1%** | Prometheus alert 触发 | 看 pino-pretty log 找上游 (SiliconFlow 限流 / DB lock) |
| **Prometheus rule 加载失败** | `curl :9090/api/v1/rules` | 检 rule_files 路径, 见 `sandbox/deploy/monitoring/prometheus.yml:52` |
| **忘记 revoke 旧 SiliconFlow key** | log 有 key 字样 | 立刻去 cloud.siliconflow.cn revoke + 换新 key |

---

## 5. 备份 + 恢复

### 备份 (6h/次)

```bash
# 跑 deploy/backup-db.sh
# 拿 atomic sqlite3 .backup, 写本地 + 推 S3
# 默认保留 7 天本地

ls -la /opt/dashengos/backups/ | head -5
```

### 恢复

```bash
# 1. 停 backend
docker stop dasheng-backend

# 2. 选最近一份
LATEST=$(ls -t /opt/dashengos/backups/dasheng-*.db | head -1)

# 3. 覆盖 (建议先备份当前)
cp packages/backend/data/dasheng.db /tmp/dasheng.db.broken
cp $LATEST packages/backend/data/dasheng.db

# 4. 重启 backend
docker start dasheng-backend
# 或裸跑: cd packages/backend && pnpm dev
```

---

## 6. 安全 checklist (上 prod 前)

- [ ] 🚨 `DASHENG_JWT_SECRET` ≥ 32 字符真随机 (非 dev-only-)
- [ ] 🚨 `DASHENG_STRIPE_MOCK_MODE=false`
- [ ] 🚨 `DASHENG_STRIPE_WEBHOOK_SECRET` 从 Stripe dashboard 拿
- [ ] 🚨 `DASHENG_REQUIRE_AUTH=true`
- [ ] 🚨 旧 `sk-wtpelvunqnswnaawmjaibimwpnftugefmihvwxrswzuobcqp` 已 revoke
- [ ] `packages/backend/.env` 已在 .gitignore
- [ ] `agent/.env` 已在 .gitignore
- [ ] Caddy TLS 配完, HSTS 开着
- [ ] 备份 cron 已配
- [ ] Prometheus + Alertmanager 起着, 4 类 rule 加载成功
- [ ] tool_permissions 已 seed (`INSERT role=ADMIN pattern='*' allow=1`)
- [ ] pre-commit hook 已装 (`git config core.hooksPath .githooks`)
- [ ] admin 密码改完 (默认 admin12345)
- [ ] SSH key 设了 (D 阶段配的 ed25519)
- [ ] Login lockout 5/15min 验过 (5 fail 后 429)

---

## 7. 相关文档

- 全面审计报告: `audit-final-report.md`
- 5 stream 分报告: `audit-stream-{1,2,5}-{frontend,backend,prod}.md`
- Caddy 配置: `deploy/Caddyfile`
- 备份脚本: `deploy/backup-db.sh`
- Pre-commit hook: `.githooks/pre-commit`
- Alert rules: `sandbox/deploy/monitoring/rules/dasheng-alerts.yml`

---

## 8. 故障树 (4 步诊断)

```
服务挂? → 哪个服务?
  ├─ 前端 :3000 → curl 200?  → 看 nginx / vite log
  ├─ Backend :8000 → curl /api/v1/system/status?
  │   ├─ 500 → 看 pino-pretty log 找堆栈
  │   └─ 401 → JWT 过期, refresh token
  ├─ Bridge :8001 → curl /health?  → 看 agent/main.py log
  └─ DeerFlow :8002 → curl /api/v1/health?  → 看 daemon log

LLM 不响应?
  ├─ 5xx rate > 1% → 看 alert (D.5)
  ├─ p95 > 2s → SiliconFlow 限流, 降级链
  └─ tools/invoke 403 → 加 tool_permissions

DB 慢?
  ├─ WAL 文件 > 100MB → checkpoint pragma wal_checkpoint(TRUNCATE)
  └─ > 1GB → 考虑迁 Postgres (P2-1)
```

---

**部署文档完。Phase A+B+C+D 17 fix 全部 push 远端, 老板按 §0 必做清单 + §6 checklist 走完就 prod-ready。**
