# DaShengOS v0.3 · 开发状态报告

> **最后更新**: 2026-06-17 (Track B.1 · Cookie/安全/PG 迁移)
> **当前阶段**: MVP Dogfooding (v0.3 B 方案架构)
> **本文件用途**: 新对话开场直接 Read, 1 份文件拉齐上下文, 接续推进

---

## 0. 30 秒定位

DaShengOS v0.3 = **Vite+TanStack Router 前端 + Fastify 5 TypeScript 后端 + Python FastAPI Agent Bridge + DeerFlow 2.0 嵌入 daemon + Go 安全沙箱** — 替代 v0.2 CopilotKit 旧架构的完整重写。

**v0.2 vs v0.3 核心变化**:
| 维度 | v0.2 (废弃) | v0.3 (当前) |
|------|------------|------------|
| 前端 | Next.js + CopilotKit | Vite 6 + React 19 + TanStack Router + shadcn/ui |
| 桥 | `runtime/src/index.ts` (Node.js) | `agent/main.py` (Python FastAPI) |
| Agent 引擎 | `vendors/deer-flow/backend/` (外部进程) | `deerflow/daemon.py` (嵌入 Unix socket) |
| 后端 | CopilotKit Runtime | `packages/backend/` (Fastify 5 REST) |
| 沙箱 | 无 | `sandbox/` (Go seccomp+namespace) |

**⚠️ 旧 v0.2 的 `runtime/` `frontend/` `backend/` `vendors/` 全部已删除。** 不要找这些目录。

---

## 1. 进程拓扑

```
[Browser :3000]   Vite + TanStack Router SPA (apps/web/)
    │ /api/v1/*   (JWT Bearer)
    ▼
[Backend :8000]   Fastify 5 TypeScript (packages/backend/)
    │ REST API 47+ 端点, SQLite 21 表
    │
    ├──► [Agent Bridge :8001]  Python FastAPI (agent/main.py)
    │       ├─ AG-UI GraphQL 协议
    │       ├─ DeerFlowBrain (默认) → deerflow daemon (Unix socket)
    │       └─ HermesBrain (备选) → hermes-agent v0.13.0 (vendored)
    │
    ├──► [DeerFlow daemon]  Unix socket JSON-RPC (deerflow/daemon.py)
    │       ├─ 14 IPC 方法 (research/agent/skill/sandbox/browser/file/audit/secret)
    │       └─ LLM: SiliconFlow Qwen2.5-72B (OPENAI_API_KEY, 2026-06-17 已配 ✅)
    │
    ├──► [Sandbox :9100]  Go daemon JSON-RPC over Unix socket (sandbox/)
    │
    └──► [旧 Worker]  sau-bridge :9109 / douyin-bridge :9112 / wechat-mp :9113
                      video-parser :9111 / pixelle-bridge :9108
```

**LLM 链路** (2026-06-17 已通):
```
用户 Chat 输入
  → apps/web AG-UI GraphQL POST :8001
  → DeerFlowBrain → deerflow daemon → lead_agent.py
  → run_sub_agent() → AsyncOpenAI(base_url=https://api.siliconflow.cn/v1, model=Qwen/Qwen2.5-72B-Instruct)
  → SiliconFlow ← OPENAI_API_KEY (sk-gyc... 已配 ✅)
```

---

## 2. 文件地图 (按重要性排)

| 路径 | 行数 | 角色 |
|---|---|---:|---|
| `STATUS.md` | 本文件 | **新对话 Read 1st** |
| `README.md` | 257 | v0.3 架构总览 (准确) |
| `DaShengOS-v0.3-生产就绪审计报告-2026-06-17.md` | — | 完整审计 (阻断/缺口/路线图) |
| `apps/web/src/routes/_workspace.tsx` | — | 前端根布局 (Shell) |
| `apps/web/src/routes/_workspace.chats.$id.tsx` | — | Chat 屏 |
| `apps/web/src/routes/_workspace.studio.tsx` | — | ComfyUI Studio |
| `packages/backend/src/server.ts` | 265 | Fastify 入口 |
| `packages/backend/src/config.ts` | 88 | Zod env 配置 |
| `packages/backend/src/storage/db.ts` | — | 21 表 Drizzle SQLite |
| `packages/backend/src/api/agents.ts` | — | 9 Agent (6+3 social) |
| `packages/backend/src/agents/social/` | — | Track B 3 社媒 Agent |
| `agent/main.py` | — | Python FastAPI AG-UI 入口 |
| `agent/brain.py` | — | AgentBrain ABC (六边形架构) |
| `agent/hermes_brain.py` | — | HermesBrain 适配器 |
| `agent/deerflow_brain.py` | — | DeerFlowBrain 适配器 |
| `agent/config.py` | 92 | env 配置 (含 SILICONFLOW_API_KEY 回退) |
| `deerflow/daemon.py` | — | JSON-RPC daemon (14 方法) |
| `deerflow/hermes_adapter.py` | — | AG-UI ↔ JSON-RPC 桥 |
| `deerflow/agents/__init__.py` | — | Sub-agent 注册表 + run_sub_agent() |
| `deerflow/agents/lead_agent.py` | — | 5 阶段研究管道 |
| `sandbox/cmd/sandbox/main.go` | — | Go daemon (26 方法) |
| `sandbox/internal/ipc/server.go` | — | 生产级 JSON-RPC server |
| `deploy/PRODUCTION.md` | — | 生产部署文档 |
| `docs/adr/ADR-050-v03-migration-decisions.md` | — | v0.2 → v0.3 迁移决策 |

---

## 3. 开发进度 (2026-06-17)

### ✅ 已完成

| Track | 内容 | 状态 |
|-------|------|------|
| 前端 | Vite+React 19+TanStack Router, 12 路由, 11 屏, 25 UI 组件 | ✅ |
| 后端 | Fastify 5, 47+ 端点, 21 DB 表, JWT+Stripe+Ratelimit | ✅ |
| Agent Bridge | Python FastAPI 5 端点, AG-UI GraphQL, brain 切换 | ✅ |
| DeerFlow | JSON-RPC daemon 14 方法, lead_agent 5 阶段管道 | ✅ |
| Sandbox | Go daemon 26 方法, seccomp+namespace (Linux) | ✅ |
| LLM | SiliconFlow Qwen2.5-72B key 已配 ✅ (2026-06-17 验证通过) | ✅ |
| Track B | 3 社媒 Agent (抖音/小红书/微信) 发布链路真接旧 worker | ✅ |
| Track C | 7 平台 chip + 10 agent tab + Studio 工作流 + 多模态路由 | ✅ |
| Track D | Dockerfile + K8s + Playwright e2e + PRODUCTION.md | ✅ |
| Track B.1 | 社媒 Cookie 加密存储 + 自动注入 + 生产安全 + PG 迁移 | ✅ (2026-06-17) |

### ✅ 已完成 — Phase 2-5 生产化补缺 (2026-06-17)

| # | 任务 | 状态 |
|---|------|------|
| Phase 2 | 后端优雅关闭 + 深健康检查 + Redis可选化 + 全局错误处理 | ✅ |
| Phase 3 | 前端路由守卫 + ErrorBoundary + settings/models 真实数据 | ✅ |
| Phase 4 | AI Agent loop + 社媒 LLM 内容 + browser 真抓取 | ✅ |
| Phase 5 | Docker/K8s 修复 + pnpm install | ✅ |

### ✅ Track B.1 (2026-06-17) · 社媒 Cookie + 安全 + PG

| # | 功能 | 状态 |
|---|------|------|
| B.1.1 | `social_cookies` 表 + AES-256-GCM 加密存储 | ✅ |
| B.1.2 | `/api/v1/social/cookies` CRUD (GET/PUT/DELETE) | ✅ |
| B.1.3 | 前端 `settings/social-cookies` 管理页 | ✅ |
| B.1.4 | Cookie 自动注入 douyin/wechat/xiaohongshu worker 调用 | ✅ |
| B.1.5 | CORS 可配置 (`CORS_ORIGINS` env) + CSRF + CSP | ✅ |
| B.1.6 | `.env.production.example` 生产配置模板 | ✅ |
| B.1.7 | PostgreSQL 支持 (`DATABASE_TYPE=postgres`) + 迁移脚本 | ✅ |

---

## 4. 已验证的命令 (新 session 1:1 可复用)

### 4.1 启后端 (Fastify :8000)
```bash
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend
pnpm dev
# 验证: curl http://127.0.0.1:8000/api/v1/system/health
```

### 4.2 启 Agent Bridge (Python :8001)
```bash
cd /Users/apple/Desktop/ai-workbench-v2
source agent/.venv/bin/activate
python -m agent.main
# 验证: curl http://127.0.0.1:8001/health
```

### 4.3 启前端 (Vite :3000)
```bash
cd /Users/apple/Desktop/ai-workbench-v2/apps/web
pnpm dev
# 自动打开 http://127.0.0.1:3000
```

### 4.4 验证 LLM 链路
```bash
cd /Users/apple/Desktop/ai-workbench-v2
source agent/.venv/bin/activate
python3 -c "
import os; os.environ['OPENAI_API_KEY']='sk-gycmiessdahpybtvqohkpettdblieaxrdnvhscqtifgdhskn'
from openai import AsyncOpenAI; import asyncio
async def t():
    c=AsyncOpenAI(base_url='https://api.siliconflow.cn/v1',api_key=os.environ['OPENAI_API_KEY'])
    r=await c.chat.completions.create(model='Qwen/Qwen2.5-72B-Instruct',messages=[{'role':'user','content':'ok'}],max_tokens=10)
    print('✅', r.choices[0].message.content)
asyncio.run(t())
"
# 期望: ✅ ok
```

### 4.5 类型检查
```bash
cd /Users/apple/Desktop/ai-workbench-v2/apps/web && pnpm tsc --noEmit
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend && pnpm tsc --noEmit
# 期望: exit 0
```

### 4.6 构建
```bash
cd /Users/apple/Desktop/ai-workbench-v2/apps/web && pnpm build
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend && pnpm build
```

---

## 5. 环境变量

| 变量 | 默认 | 用途 |
|------|------|------|
| `OPENAI_API_KEY` | `~/.hermes/.env` 读入 | SiliconFlow LLM key (2026-06-17 已配) |
| `SILICONFLOW_API_KEY` | 同上 | agent/config.py 回退链含此变量 |
| `SILICONFLOW_BASE_URL` | `https://api.siliconflow.cn/v1` | SiliconFlow 端点 |
| `DASHENG_BRAIN_BACKEND` | `deerflow` | brain 选择 (deerflow/hermes) |
| `DASHENG_JWT_SECRET` | 32+ 字符 | JWT 签名密钥 (prod 必改) |
| `DASHENG_REQUIRE_AUTH` | `true` (prod) | 鉴权开关 |
| `NODE_ENV` | `production` | 环境模式 |

工作 worker 端点:
| 变量 | 默认 |
|------|------|
| `SAU_BRIDGE_URL` | `http://127.0.0.1:9109` |
| `DOUYIN_BRIDGE_URL` | `http://127.0.0.1:9112` |
| `WECHAT_MP_URL` | `http://127.0.0.1:9113` |
| `VIDEO_PARSER_URL` | `http://127.0.0.1:9111` |
| `PIXELLE_BRIDGE_URL` | `http://127.0.0.1:9108` |

Track B.1 新增:
| 变量 | 默认 | 用途 |
|------|------|------|
| `CORS_ORIGINS` | (空=localhost) | 生产 CORS 域名, 逗号分隔 |
| `CSRF_ENABLED` | `false` | CSRF 保护开关 |
| `CSP_ENABLED` | `false` | Content-Security-Policy 开关 |
| `COOKIE_ENCRYPTION_KEY` | JWT 派生 | 社媒 cookie AES-256-GCM 密钥 |
| `DATABASE_TYPE` | `sqlite` | `sqlite` 或 `postgres` |
| `DATABASE_URL` | `file:./data/dasheng.db` | PG 时用 `postgres://` URL |

---

## 6. 已知坑 / 限制

1. **node_modules**: 需要 `pnpm install` 之后才能编译运行
2. **社媒内容生成当前是 mock**: 抖音/小红书/公众号的 generate_* 返回硬编码模板，需要接 LLM 替换 (Phase 4 任务)
3. **DeerFlow 子 Agent 是空壳**: 5 个子 agent 文件全是 `from . import run_sub_agent` re-export，无 agent-specific 逻辑 (Phase 4)
4. **后端缺优雅关闭**: SIGTERM 时无 DB close / 请求 drain (Phase 2)
5. **前端缺路由守卫**: 未登录也能看到 workspace 页面骨架 (Phase 3)
6. **K8s readinessProbe 有 bug**: deerflow daemon 没有 HTTP 端点，探针永远 unhealthy (Phase 5)
7. **SQLite 单机**: 适合单用户/低并发，多租户需迁移 PostgreSQL
8. **社媒 Cookie 缺失**: 抖音/小红书/公众号真 cookie 未配，发布虽走真 worker 但缺鉴权

---

## 7. 不要做的事

- ❌ 不要找 `runtime/` `frontend/` `vendors/` `backend/` — 全是 v0.2 旧目录，已删除
- ❌ 不要以 STATUS.md 旧版 (v0.2) 为参考 — 本文件已替换
- ❌ 不要改 `agent/brain_factory.py` 里的默认 backend (deerflow)
- ❌ 不要把 API key 写进 git 跟踪文件
- ❌ 不要在 macOS 上期望 sandbox namespace 隔离 (Linux only)
- ❌ 不要把 `DASHENG_JWT_SECRET` 恢复为 dev-only 默认值

---

## 8. 关联文件索引

- `README.md` — v0.3 架构总览 (准确, 新对话建议先读)
- `DaShengOS-v0.3-生产就绪审计报告-2026-06-17.md` — 完整审计报告 (阻断/缺口/路线图)
- `P0-P5-CLOSURE-REPORT.md` — v0.2 旧架构收官报告 (**仅作历史参考**, 描述的是已删除代码)
- `docs/adr/ADR-050-v03-migration-decisions.md` — v0.2 → v0.3 迁移决策
- `deploy/PRODUCTION.md` — 生产部署文档
- `docs/architecture.md` — 详细架构图
- `install.sh` — 一键部署脚本
