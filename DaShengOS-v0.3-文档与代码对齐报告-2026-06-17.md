# DaShengOS v0.3 · 开发指南文档 vs 实际代码对齐报告

> **核对文档**: `WorkBuddy/2026-06-15-02-43-15/.workbuddy/docs/dasheng-os-private-ai-workbench-dev-guide-v0.3.html`
> **核对时间**: 2026-06-17
> **方法**: 逐节读取文档声明 → 实际代码库文件/目录存在性验证 → 内容匹配度评级

---

## 一、总评

**文档是一份"理想架构设计书"，不是"当前实际状态描述"。** 差距量化：

| 维度 | 文档声明的数量 | 实际存在的数量 | 匹配率 |
|------|:-----------:|:-----------:|:-----:|
| 目录条目 | ~120 个预期路径 | ~66 个存在 | **55%** |
| 核心模块 (`core/*.ts`) | 8 个 | 2/8 匹配 + 3 个文档未声明 | **25%** |
| API 端点 | 47 个 | 72+ 个（远超文档） | **153%** ⚠️ |
| 数据库表 | 14 张 (Prisma) | 23 张 (Drizzle+SQL) | **✗ ORM方案不同** |
| 前端屏幕 | 9 个 | 9/9 + 3 额外 | **100%** (路径不同) |
| Docker Compose 服务 | 14 个 | 文件不存在 | **0%** |
| K8s Helm 模板 | 25+ 个 | 仅 1 个 YAML | **4%** |
| 环境变量 | ~85 个文档声明 | ~40 个实际，命名体系不同 | **~50%** |
| 文档内部矛盾 | 多处 | HTML title 写 "v0.2" 但 TOC 写 "v0.3" | — |

**核心结论：文档描述的是一份"需要构建的蓝图"，代码库是"已经构建了什么"的现实。两者差距显著，不应以文档为准来评判代码完整性。**

---

## 二、逐节差异清单

### §3 架构设计 — 差距: ⚠️ 中等

| 文档声明 | 实际状态 |
|----------|---------|
| 后端框架 FastAPI :8000 (架构图) | 实际 Fastify :8000，架构图与文字描述矛盾 |
| 端口 8001-9101 内部服务 | 实际还多了 9108-9113 (5个社媒 worker) 文档完全未提 |
| Agent Orchestrator 组件 | 无独立 `agent.ts` 核心模块，逻辑分散在 `deerflow/agents/` |
| Skill Registry 组件 | 无独立核心模块 |
| Redis 7 (ioredis) | 存在 `cache/redis.ts`，已改为完全可选 ✅ |
| MCP Client SDK | 无 `mcp-client.ts` 文件 |
| Postgres 仅 P3+ | 已有 `db-pg.ts` 完整 schema ✅ (文档低估了实现进度) |

### §10 OpenAPI 端点 — 差距: ⚠️ 多出很多

| 文档声明 | 实际状态 |
|----------|---------|
| 47 个端点 | 实际 72+ 个端点，多了约 25 个 |
| `api/settings.ts`, `api/models.ts` 等独立文件 | 实际合并到 `api/misc.ts` (26 个端点挤在一个文件) |
| 无社媒路由 | 实际有 `api/social.ts` (9 端点) 文档完全未提及 |
| 无 Stripe webhook | 实际有 `api/stripe.ts` 文档未提 |
| 无Phase5路由 | 实际有 `api/phase5.ts` (14 端点, SSO/市场/计费) |

### §12 数据库设计 — 差距: 🚨 完全不对

| 文档声明 | 实际状态 |
|----------|---------|
| **ORM: Prisma** (`prisma/schema.prisma`) | **实际: Drizzle + 原始 SQL** (`db.ts` 673行手写 SQL) |
| 14 张表 | 实际 23 张表 |
| 10 种枚举类型 (Prisma enum) | Drizzle 不用 Prisma 枚举，用 Zod 验证 |
| 表名: `files`, `settings` | 实际: `file_objects`, `user_settings` + 顶层 `settings` |
| 文档未提到的表 | 实际有: `billing_tier`, `billing_usage`, `refresh_tokens`, `social_cookies`, `sso_links`, `sso_sessions`, `api_keys`, `marketplace_installs`, `login_attempts`, `user_settings` — **多出 10 张表** |

### §15 Monorepo 目录树 — 差距: ⚠️ 中等

| 文档声明的目录 | 实际 |
|----------|------|
| `dasheng-os/` (根目录名) | `ai-workbench-v2/` |
| `apps/desktop/` (Tauri 2.x) | **不存在** |
| `apps/cli/` (Node CLI) | **不存在** |
| `packages/shared/` (共享类型) | **不存在** |
| `packages/sandbox/` | 实际在顶级 `sandbox/` |
| `packages/workers/` (Python worker) | **不存在** |
| `mcp_servers/` (MCP 白名单) | **不存在** — 整个目录缺失 |
| `skills/` (Skill 模板) | **不存在** — 整个目录缺失 |
| `docs/openapi.yaml` | 存在 `docs/` 目录但无 `openapi.yaml` |
| 额外目录 文档未提 | `agent/`, `backend/`, `deerflow/`, `docker/`, `frontend/`, `node_modules/`, `ops/` |

### §16 核心模块代码 — 差距: 🚨 大量缺失

| 文档声明的 core/*.ts | 实际 |
|----------|------|
| `agent.ts` — AI 执行引擎 | **不存在** — 逻辑在 `deerflow/agents/` + `api/sessions.ts` |
| `mcp-client.ts` — MCP SDK 包装 | **不存在** |
| `tool.ts` — 工具注册表 | **不存在** |
| `skill-loader.ts` — Skill 加载器 | **不存在** |
| `session-manager.ts` — 会话管理 | **不存在** — 逻辑在 `api/sessions.ts` |
| `gateway.ts` — API Gateway | **存在** ✅ |
| `audit.ts` — 审计日志 | **存在** ✅ |
| `crypto.ts` — 加密工具 (文档未提) | **存在** (Track B.1 新增) |
| `logger.ts` — 日志 (文档未提) | **存在** |
| `metrics.ts` — 指标 (文档未提) | **存在** |

**8 个文档声明模块 → 仅 2 个存在。另 3 个实现的模块文档未提。**

### §20 Docker Compose — 差距: 🚨 部署文件完全缺失

| 文档声明 | 实际状态 |
|----------|---------|
| **`deploy/docker-compose.yml`** (14 个服务，3 个网络) | **文件不存在** — 这是文档中最关键的部署文件之一 |
| `backend_net`, `sandbox_net`, `llm_net`, `internet_net` | 不存在 |
| squid:6 代理容器 | 无对应 Dockerfile/配置 |
| ollama-pull init 容器 | 不存在 |
| 3 个 MCP server 容器 | `mcp_servers/` 目录完全没有 |
| `deploy/caddy/Caddyfile` | 实际在 `deploy/Caddyfile` ✅ |
| Docker Compose Secrets | 不存在 |

**实际有**: `sandbox/deploy/docker-compose.yml`（仅沙箱，非完整栈）

### §21 Kubernetes — 差距: 🚨 Helm Chart 完全不存在

| 文档声明 | 实际状态 |
|----------|---------|
| `deploy/k8s/helm/dasheng/` — 完整 Helm Chart (~25 文件) | **完全不存在** |
| Chart.yaml, values.yaml, 10+ templates | **完全不存在** |
| Ingress, NetworkPolicy, HPA, PVC 等模板 | **完全不存在** |
| 实际仅存 | `k8s/deerflow.yaml`（仅 DeerFlow Deployment+Service） |

### §32 核心屏幕 — 差距: ✅ 全部存在 (路径不同)

| 文档声明 | 实际 (均在 `apps/web/src/screens/`) |
|----------|------|
| 登录/注册 `/login` → `Login.tsx` | **存在** ✅ |
| 工作台 `/` → `Workspace.tsx` | **存在** ✅ |
| 对话 `/chats/:id` → `Chat.tsx` | **存在** ✅ |
| Agent市场 `/agents` → `AgentMarket.tsx` | **存在** ✅ |
| Skill详情 `/skills/:id` → `SkillDetail.tsx` | **存在** ✅ |
| MCP管理 `/mcp` → `McpManager.tsx` | **存在** ✅ |
| 文件浏览 `/files/*` → `FileBrowser.tsx` | **存在** ✅ |
| 设置 `/settings/*` → `Settings.tsx` | **存在** ✅ |
| 错误页 `/error/:code` → `ErrorPage.tsx` | **存在** ✅ |
| 额外 (文档未提) | `Studio.tsx`, `Shell.tsx` — 2 个额外屏幕 |

**文档声明所有屏幕组件在 `components/` — 实际在 `screens/`。全部 9 个都存在！**

### §35-37 DeerFlow 集成 — 差距: ⚠️ 中等

| 文档声明 | 实际状态 |
|----------|---------|
| DeerFlow daemon JSON-RPC 14 方法 | `deerflow/daemon.py` 存在 ✅ |
| 5 个子 Agent | `deerflow/agents/` 存在 (researcher/analyst/writer/quality/security) ✅ |
| 凭据共享 `credentials.py` | 存在 ✅ |
| Browser 抓取 (navigate/extract) | 已实现 (urllib 真实 HTTP) ✅ |
| Backend side `services/deerflow/client.ts` | **不存在** — `packages/backend/src/services/` 目录不存在 |
| Worker pool | 不存在 |
| `deerflow.yaml` 配置文件 | 不存在 |
| `.env` 中 DeerFlow 配置 | 不存在 (无 `DEERFLOW_ENABLED` 等) |

### 附录 A 环境变量 — 差距: 🚨 命名体系完全不同

| 文档命名体系 | 实际命名体系 |
|-------------|------------|
| `BACKEND_HOST`, `BACKEND_PORT` | `APP_HOST`, `APP_PORT` |
| `DASHENG_JWT_SECRET_FILE` (文件路径) | `DASHENG_JWT_SECRET` (直接值) |
| `DASHENG_NAMESPACE` | `APP_ENV` |
| `DATABASE_URL=file:/var/lib/...` | `file:./data/dasheng.db` |
| 有 MCP/Sandbox/Storage/TLS/Worker 变量组 | **全部缺失** — 这些功能的配置入口不存在 |
| 无 SiliconFlow/DeepSeek/Stripe 变量 | **实际有** — 文档滞后 |
| 无社媒 worker URL 变量 | **实际有** `SAU_BRIDGE_URL` 等 5 个 |

---

## 三、文档内部矛盾

| 矛盾点 | 详情 |
|--------|------|
| HTML `<title>` | 写 "v0.2" |
| 侧边栏标题 | 写 "v0.3" |
| 架构图后端标注 | "FastAPI :8000" |
| 文字描述后端 | "Fastify 5 TypeScript" (正确) |
| Docker 镜像 tag | 全部写 "0.2.0" |
| Git tag 建议 | "v0.2.0" |

---

## 四、按严重程度分类

### 🔴 阻断级差异 (文档声称存在但完全不存在，影响部署)

1. **`deploy/docker-compose.yml`** — 生产部署的核心编排文件不存在
2. **完整的 K8s Helm Chart** — 25+ 个模板文件全不存在
3. **Prisma ORM Schema** — 不存在，实际用 Drizzle + 原始 SQL
4. **`mcp_servers/` + `skills/` 目录** — 整目录缺失
5. **核心模块 6/8 缺失** — agent.ts, mcp-client.ts, tool.ts, skill-loader.ts, session-manager.ts

### 🟡 高优差异 (文档声称存在但路径/名称/方案不同)

6. **目录命名不同**: `dasheng-os/` vs `ai-workbench-v2/`
7. **环境变量命名体系不同**: `BACKEND_HOST` vs `APP_HOST`
8. **数据库方案不同**: Prisma 14张表 vs Drizzle 23张表
9. **端点数量远多于文档**: 47 vs 72+
10. **额外目录未提及**: `agent/`, `deerflow/`, `docker/`, `frontend/`

### 🟢 低优差异 (实际比文档更完善)

11. **前端屏幕全部存在** (文档低估，实际 11 个屏幕比文档的 9 个多)
12. **数据库表多出 10 张** (计费/SSO/Social Cookies/Marketplace 等)
13. **API 端点多出 25+ 个** (社媒/Stripe/SSO/市场/计费)
14. **核心 crypto.ts 已实现** (文档未提)
15. **PostgreSQL 支持已就绪** (文档说 P3+，实际 P0 已完成)

---

## 五、建议

1. **不要用这份文档来评估项目完整性** — 它是一份设计蓝图，不是现状快照
2. **如果要更新文档**，优先修正: §12 (Prisma→Drizzle)、§20 (补充 docker-compose)、§21 (补充 K8s)、附录A (环境变量)
3. **如果要部署**，以 `STATUS.md` + `deploy/.env.production.example` + `deploy/Caddyfile` 为准，忽略文档中的 Docker/K8s 描述
4. **文档价值**: §3 架构设计、§10 OpenAPI、§17-19 安全模型仍然是对理解系统有用的参考
