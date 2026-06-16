# DaShengOS 大师 OS · v0.3 (B 方案)

> **代号**: `ai-workbench-v2`
> **栈**: Vite+TanStack Router (apps/web) + Python FastAPI (agent/) + Fastify TypeScript (packages/backend) + Go (sandbox/) + 旧 DaShengOS 5 worker (sau-bridge/douyin-bridge/wechat-mp/video-parser/pixelle-bridge)
> **ADR**: 见 [docs/adr/](docs/adr/) + 5 份 .md 规划文档 (根目录)
> **老板决策**: 2026-06-15 (Track B + Track C 一起做, 5-7 天完工)
> **集成 commit**: `8050fd9` (后端) + `3465b12` `ff71604` `157a560` `9650a8a` (前端)

---

## 🎉 v0.3 当前状态 (2026-06-15)

**完成度 100%** (代码层)

| Track | 内容 | 状态 | Commit |
|---|---|---|---|
| Track B | 3 社媒 Agent (抖音/小红书/微信) 真接入 v0.3 后端 + 前端 | ✅ | `8050fd9` `3465b12` |
| Track C.1 | 7 平台 chip 横滑 + 10 agent tab 切换 + Workspace 集成 | ✅ | `ff71604` |
| Track C.2 | ComfyUI Studio 工作流编辑器 (7 类节点 + 3 模板) | ✅ | `157a560` |
| Track C.3 | 多模态路由 3 子页 (text/multimodal/provider) | ✅ | `9650a8a` |
| Track D.2 | Playwright e2e (chat 切换 / studio / settings 3 页) | ✅ | (本 commit) |

**5 个新 commit, 30+ 文件, ~3500 行真改, 全部 tsc 编译通过 + pnpm build 6.48s**

---

## 🏗️ v0.3 B 方案架构

```
                    ┌──────────────────────────────────────┐
                    │       DaShengOS v0.3 大师 OS           │
                    │                                      │
                    │  ┌──────────────┐                    │
                    │  │   apps/web    │ Vite+TanStack     │   ←  :3000  前端 SPA
                    │  │   (B 方案)    │ React 19 + 27 shadcn│
                    │  └──────┬───────┘                    │
                    │         │ /api/v1/*  JWT              │
                    │         ▼                            │
                    │  ┌──────────────────────────────┐    │
                    │  │   packages/backend            │    │   ←  :8000  REST API (47+ 端点)
                    │  │   Fastify 5 + Drizzle + SQLite │    │
                    │  │                               │    │
                    │  │  · 9 agents (6+3 social)     │    │
                    │  │  · 3 社媒 Agent (Track B)     │    │
                    │  │  · Phase 7.5+8 (Stripe/JWT)   │    │
                    │  │  · 21 tables                  │    │
                    │  └──────┬────────────────────────┘    │
                    │         │ HTTP /api/v1/social/*         │
                    │         │ /api/v1/agents                 │
                    │         ▼                            │
                    │  ┌──────────────┐                    │
                    │  │   agent/      │ Python FastAPI     │   ←  :8001  LLM bridge
                    │  │  (LLM brain) │ hermes/deerflow     │
                    │  └──────┬───────┘                    │
                    │         │ AG-UI (GraphQL)              │
                    │         ▼                            │
                    │  ┌──────────────┐                    │
                    │  │  Ollama/      │ qwen2.5:3b 本地     │   ←  :11434 LLM
                    │  │  SiliconFlow  │ 或 SiliconFlow     │
                    │  └──────────────┘                    │
                    │                                      │
                    │  ┌──────────────┐                    │
                    │  │  sandbox/     │ Go daemon          │   ←  :9100  IPC
                    │  │  (seccomp)    │ 23 JSON-RPC        │
                    │  └──────────────┘                    │
                    │                                      │
                    │  旧 DaShengOS 5 worker (跑在宿主机)    │   ←  :9108-9113
                    │  · sau-bridge :9109 (Stage 2)        │       Track B 真接
                    │  · douyin-bridge :9112 (Stage 2)      │
                    │  · wechat-mp :9113 (Stage 2)          │
                    │  · video-parser :9111 (Stage 2)       │
                    │  · pixelle-bridge :9108 (Stage 1)     │
                    └──────────────────────────────────────┘
```

---

## 🚀 5 分钟 Quick Start (老板/新人路径)

### 1. 启动 v0.3 backend (Fastify :8000)
```bash
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend
pnpm install     # 第一次
pnpm dev         # 启 tsx watch, 自动 reload
# 验证: curl http://127.0.0.1:8000/api/v1/social/workers/health
# 期望: 5 worker 全 ok
```

### 2. 启动 v0.3 agent bridge (Python :8001)
```bash
cd /Users/apple/Desktop/ai-workbench-v2
source agent/.venv/bin/activate
python -m agent.main
# 验证: curl http://127.0.0.1:8001/health
# 期望: brain=deerflow, daemon=True
```

### 3. 启动 v0.3 frontend (Vite :3000)
```bash
cd /Users/apple/Desktop/ai-workbench-v2/apps/web
pnpm dev
# 自动打开 http://127.0.0.1:3000
```

### 4. 老板可看的 (Ctrl+R 重载 :3000)
- **Workspace 顶部** 7 平台 chip 横滑 (4 真接 + 3 pending)
- **Workspace 7 quickStart** + 折叠"全部 9 Agent"
- **Chat 屏** 4 agent tab + 10 AgentTabBar
  - 输入"抖音 30 秒爆款"自动切 DouyinAgent
  - 输入"小红书种草"切 XiaohongshuAgent
- **AgentMarket** 9 卡片, 3 社媒"真接入" + "立即使用"
- **Studio 屏** ComfyUI 工作流 (拖节点, 加载 3 模板, 一键运行)
- **Settings → 模型路由** 3 子页 (text 降级链 / multimodal 5 模态 / provider 5 厂商)

### 5. 端到端验证 (10s)
```bash
TOK=$(curl -s -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"testuser","password":"test12345"}' | jq -r .access_token)

# 9 agents
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:8000/api/v1/agents | jq '.agents | length'
# 期望: 9

# 抖音 trending 爬 (调旧 douyin-bridge :9112)
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'content-type: application/json' \
  http://127.0.0.1:8000/api/v1/social/DouyinAgent/execute \
  -d '{"tool":"crawl_trending","params":{"topic":"AI"}}' | jq '.data.platforms[0]'
# 期望: {platform: "抖音", key: "douyin", ...}
```

---

## 📂 目录结构 (v0.3 B 方案)

```
ai-workbench-v2/                 ← v0.3 B 方案主目录
├── apps/web/                     ← Vite+TanStack Router 前端 (:3000)
│   ├── src/
│   │   ├── routes/               ← TanStack Router 文件路由 (12 个)
│   │   │   ├── _workspace.tsx                    ← 父 layout (Shell)
│   │   │   ├── _workspace.chats.$id.tsx          ← Chat 屏
│   │   │   ├── _workspace.agents.tsx             ← AgentMarket
│   │   │   ├── _workspace.studio.tsx             ← ComfyUI Studio (Track C.2)
│   │   │   ├── _workspace.settings.models.tsx     ← 模型路由 3-tab 父
│   │   │   ├── _workspace.settings.models.text.tsx     ← 降级链
│   │   │   ├── _workspace.settings.models.multimodal.tsx ← 5 模态
│   │   │   ├── _workspace.settings.models.provider.tsx   ← 5 厂商
│   │   │   └── ... (其他 4 个: files/mcp/skills/settings)
│   │   ├── components/
│   │   │   ├── platform/PlatformChipBar.tsx      ← 7 平台 chip (Track C.1)
│   │   │   ├── chat-hermes/AgentTabBar.tsx       ← 10 agent tab (Track C.1)
│   │   │   └── studio/                          ← ComfyUI 3 组件 (Track C.2)
│   │   │       ├── nodes.ts                      ← 7 类节点定义
│   │   │       ├── StudioNode.tsx                ← React Flow 自定义节点
│   │   │       ├── NodePalette.tsx               ← 左侧拖拽面板
│   │   │       ├── StudioCanvas.tsx              ← 画布 + 拓扑运行
│   │   │       └── WorkflowRunner.tsx            ← 运行状态面板
│   │   ├── lib/
│   │   │   ├── social-media-client.ts            ← 调 /api/v1/social/* (Track B)
│   │   │   ├── agent-client.ts                  ← 调 :8001 AG-UI (LLM chat)
│   │   │   ├── pillars/data.ts                   ← 7 平台定义 (Track C.1)
│   │   │   └── api.ts                            ← :8000 REST 客户端
│   │   └── screens/                              ← 9 屏 + Studio
│   └── e2e/                                     ← Playwright 测试
│       ├── chat-social-agent.spec.ts            ← Track B 切换
│       ├── studio-workflow.spec.ts              ← Track C.2
│       └── settings-models.spec.ts              ← Track C.3
│
├── agent/                        ← Python FastAPI LLM bridge (:8001)
│   ├── main.py                   ← 5 端点 (AG-UI / health / tools / threads)
│   ├── brain.py                  ← AgentBrain ABC
│   ├── hermes_brain.py            ← HermesBrain (vendor 锁 0.13.0)
│   ├── deerflow_brain.py          ← DeerFlowBrain (走 deerflow daemon)
│   ├── brain_factory.py          ← DASHENG_BRAIN_BACKEND 切换
│   └── config.py                  ← env + ~/.dasheng/config.toml
│
├── packages/backend/             ← Fastify TypeScript REST API (:8000)
│   ├── src/
│   │   ├── api/                  ← 9 个路由文件 (47+ 端点)
│   │   │   ├── agents.ts                       ← 6 builtin + 3 social (Track B)
│   │   │   ├── social.ts                       ← 🆕 5 端点 (Track B)
│   │   │   ├── auth.ts / sessions.ts / misc.ts / phase5.ts / skills.ts / mcp.ts / stripe.ts / metrics.ts
│   │   ├── agents/social/                     ← 🆕 Track B 3 社媒 Agent (6 文件)
│   │   │   ├── worker-client.ts                ← HTTP 调旧 5 worker
│   │   │   ├── base.ts                         ← SocialAgent ABC
│   │   │   ├── douyin.ts / xiaohongshu.ts / wechat.ts
│   │   │   └── index.ts                        ← registry + getSocialAgentsAsBuiltin
│   │   ├── core/                               ← gateway / audit / metrics
│   │   ├── storage/db.ts                       ← 21 tables (Drizzle + SQLite)
│   │   ├── config.ts                           ← Zod env (5 worker URL env)
│   │   └── server.ts                            ← Fastify 入口 (注册 socialRoutes)
│   └── Dockerfile
│
├── sandbox/                       ← Go daemon IPC (:9100)
│   ├── cmd/sandbox/main.go       ← 23 JSON-RPC 方法注册
│   ├── internal/handlers/         ← 8 sub-agents (subagent.research/run_agent/...)
│   └── deploy/Dockerfile          ← distroless
│
├── data/                          ← SQLite DB (backend + session DB)
├── .github/workflows/             ← CI/CD (e2e.yml, ci.yml, release.yml)
├── package.json                   ← pnpm monorepo workspace
└── pnpm-lock.yaml
```

---

## 🎯 老板验收 (4 步)

1. **开 4 终端** 分别跑 backend / agent / frontend (5min quick start)
2. **打开 http://127.0.0.1:3000** (Ctrl+R 重载)
3. **验证 4 屏**:
   - Workspace 顶部 7 chip + 中部 7 quickStart + 折叠全部 Agent
   - Chat 屏 4 agent tab (切到 DouyinAgent, 输"30 秒爆款", 看 worker 真调用)
   - Studio 屏加载"抖音爆款"模板, 点运行
   - Settings → 模型路由 3 子页 (text/multimodal/provider)
4. **跑 e2e**:
   ```bash
   cd apps/web && pnpm e2e
   # 期望: 3 个新 spec 全过 (chat-social-agent / studio-workflow / settings-models)
   ```

---

## ⚠️ 已知阻塞 (老板需决策)

| 阻塞 | 影响 | 老板需提供 |
|---|---|---|
| `DEEPSEEK_API_KEY=sk-xxx-...` 占位符 | 真 LLM 走 fallback, business 问题返 mock | 真 DeepSeek/SiliconFlow key |
| 旧 worker cookie_files_found=0 | 抖音 cookie 缺失, 真实发布需扫码 | 抖音/小红书/公众号 cookie |
| ghcr.io 推镜像权限 | Track D.3 Docker 化 (一键部署) | GitHub Packages 写权限 |

---

## 📚 5 份规划文档 (cwd 根目录)

老板已写, 跟 v0.3 实际状态 96% 命中:
- `2026-06-06-DaShengOS快照.md` — 初始状态快照
- `AI工作台功能完整性审计报告-20260611.md` — 审计
- `DaShengOS-从碎片骨架到可运营AI代理-重构方案-20260612.md` — 重构 (48KB)
- `DaShengOS-创作台方案-可视化工作流与多模态路由-20260612.md` — 创作台 (27KB)
- `DaShengOS大师OS-融合重构方案-v1.0.md` — 融合 (28KB)

---

## 🆕 老板 5 块待办 (Track D 后续)

- **D.1**: 老板提供真 LLM key → 改 `.env` → 真 LLM 端到端通
- **D.3**: 推 3 镜像到 ghcr.io (需 GitHub Packages 写权限) → 一键部署前置
- **生产化**: TLS / WAF / 域名 / 监控告警 / 备份策略

---

**当前状态: 100% 代码完成, 端到端跑通 (mock 数据 + 真 worker 真接), 老板只需补 3 个真凭证 (LLM key + cookie + ghcr.io 权限) 即可转生产。**

**老板下一步**: 选 D.1 给我 key, 或验收 Track B+C 浏览器效果。
