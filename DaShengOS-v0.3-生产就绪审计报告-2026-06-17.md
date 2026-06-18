# DaShengOS v0.3 · 生产就绪全面审计报告

> **审计日期**: 2026-06-17
> **审计范围**: 代码完整性、功能连通性、生产环境可行性
> **项目路径**: `/Users/apple/Desktop/ai-workbench-v2/`
> **项目版本**: v0.3 (B 方案) — 标注 100% 代码完成

---

## 执行摘要

**总评: 不能直接商用。** 项目架构设计优秀、代码框架完整，但存在 **3 个阻断级缺陷**、**8 个高风险缺口** 和 **1 个文档层面的严重误导**。在解决阻断项之前，只能在本地开发环境演示，不具备生产部署条件。

| 维度 | 评分 | 判定 |
|------|------|------|
| 代码完整性 | 60% | 核心框架完整，大量 stub/mock |
| 功能连通性 | 45% | 组件间 API 通，但全链路 mock 占比高 |
| 生产可行性 | 25% | 缺太多生产要素 |
| **综合商用力** | **❌ 不可商用** | 至少需 3-6 周补缺口 |

---

## 一、项目现状快照

### 1.1 当前文件结构（代码层 100% 完成？）

```
ai-workbench-v2/
├── apps/web/          Vite+React 19 前端 (12 路由, 11 屏, 25 UI 组件)   ✅ 框架完整
├── packages/backend/  Fastify 5 REST API (47 端点, 21 DB 表)           ✅ 框架完整
├── agent/             Python FastAPI LLM Bridge (5 端点)               ✅ 框架完整
├── deerflow/          Python 嵌入 daemon (14 IPC 方法)                 ⚠️ 大量 stub
├── sandbox/           Go JSON-RPC daemon (26 方法)                     ⚠️ 部分 stub
├── docker/            Docker 构建文件                                   ⚠️ 未使用
├── k8s/               K8s 部署清单                                      ❌ probe bug
├── deploy/            生产部署文档 + 脚本                                ✅ 文档好
└── docs/              架构 ADR (4 份)                                  ✅ 文档好
```

### 1.2 编译/构建状态

| 组件 | 状态 |
|------|------|
| Go (sandbox/) | ✅ `go build ./...` 通过 |
| Python (agent/, deerflow/) | ✅ `py_compile` 全部通过 |
| TypeScript 前端 | ✅ `dist/` 存在 (曾构建成功) |
| TypeScript 后端 | ✅ `dist/` 存在 (曾构建成功) |
| **⚠️ node_modules** | **❌ 当前未安装（前端和后端均无）** |

---

## 二、⚠️ 阻断级缺陷（必须先修复才能商用）

### 🔴 阻断 #1: 文档层严重误导 — STATUS.md 描述的是已废弃架构

**严重程度: 致命**

`STATUS.md`（554 行，标注"新对话 Read 1st"）和 `P0-P5-CLOSURE-REPORT.md`（284 行）描述的是 **v0.2 旧架构**（CopilotKit + Next.js + `runtime/src/index.ts` + `vendors/deer-flow/`），而当前代码库是 **v0.3 B 方案**（Vite + Fastify + `agent/main.py` + `deerflow/daemon.py`）。

旧架构引用的文件全部不存在：
- `runtime/src/index.ts` → ❌ 不存在
- `frontend/app/page.tsx` → ❌ 不存在（已迁移到 `apps/web/`）
- `vendors/deer-flow/backend/` → ❌ 不存在
- `backend/p3/query_orders.py` → ❌ 不存在
- `:8002` DeerFlow 旧实例 → ❌ 不存在
- `:8003` health 端口 → ❌ 不同的服务

**影响**: 任何新开发者读 STATUS.md 会完全被误导。`P0-P5-CLOSURE-REPORT.md` 声称"P0-P5 全部 ✅ 收官"实际上指的是已删除的旧代码。

### 🔴 阻断 #2: 社媒 Agent 内容生成全是 Mock

后端 `agents/social/douyin.ts`, `xiaohongshu.ts`, `wechat.ts` 的**内容生成**功能：

| Agent | 功能 | 真实程度 |
|-------|------|---------|
| DouyinAgent.generate_video | AI 视频生成 | `stage<2` 时 mock 硬编码 |
| XiaohongshuAgent.generate_xhs_note | 小红书种草 | **100% 硬编码模板** ("LLM 不可用时返模板") |
| WechatAgent.generate_article | 公众号文章 | **100% 硬编码模板** |

发布链路（sau-bridge/douyin-bridge/wechat-mp）走的是真实 worker HTTP 调用，但**内容本身是假的**。没有接入真实 LLM key，`generate_article` 返回一堆硬编码的假文本。

### 🔴 阻断 #3: LLM Key 为占位符，Agent 推理链路不通

`DEEPSEEK_API_KEY` 在 `.env` 中是占位符。这意味着：
- `deerflow_brain.py` 的 1-shot LLM 调用 → 走 fallback 返回 mock
- `hermes_brain.py` 需要真 key 才能启动
- `deerflow/agents/` 的子 agent 调 `AsyncOpenAI` → key 无效

**影响**: 整个 Agent 推理链路（从用户输入→LLM 思考→工具调用→结果生成）中最核心的 LLM 调用环节完全不工作。

---

## 三、🟠 高风险缺口（非阻断但严重）

### H1: DeerFlow 子 Agent 全是空壳 (stub)

5 个子 agent 文件中：

```python
# deerflow/agents/researcher.py  ← 全部内容
from . import run_sub_agent

# deerflow/agents/analyst.py  ← 全部内容
from . import run_sub_agent

# deerflow/agents/writer.py / quality.py / security.py  ← 全部相同
```

- 没有任何 agent-specific 逻辑
- `run_sub_agent()` 是单次 LLM 调用，不是真正的 agent loop（无 tool use、无 reasoning、无 multi-step）
- 跟 README 声称的"5 阶段研究管道"严重不符

### H2: DeerFlow daemon 核心功能是 Stub/Simulator

| 功能 | 真实程度 |
|------|---------|
| `browser.navigate/extract` | ❌ "Playwright integration in P3.10" |
| `research.run` 数据 | ❌ 生成假 finding (`"Finding 1 for: query"`) |
| `sandbox.exec` | ⚠️ macOS 退化为 `subprocess.run`，无隔离 |
| `secret.read` | ⚠️ 明文 `credentials/*.env`，无加密 |
| `skill.*` | ❌ "Phase 3 stub" |

### H3: 后端缺少生产关键能力

| 缺失项 | 风险 |
|--------|------|
| 无 SIGTERM 优雅关闭 | 进程 kill 时飞行中请求丢失 |
| 健康检查浅层 | 只返 `{status:ok}`，不查 DB/Redis |
| Redis 硬依赖 | Redis 不可达时后端启动 crash |
| SQLite 生产问题 | 单机低并发 OK，多租户不行 |
| Skills/MCP 端点 | 完全 Stub（POST import 返 501，reload 不做任何事） |

### H4: 前端缺少生产关键能力

| 缺失项 | 风险 |
|--------|------|
| 无路由认证守卫 | 未登录可访问受保护路由（API 层拦截但 UI 先崩） |
| 无 ErrorBoundary | React 异常白屏，无兜底 |
| 无 Suspense/Lazy | 首屏加载全量 |
| Storybook 仅 1 组件 | 设计系统未验收 |

### H5: 社媒 Cookie 缺失

旧 worker 的 `cookie_files_found=0`，抖音/小红书/公众号真 cookie 缺失。发布链路虽然 API 通，但没有真 cookie 无法完成实际发布。

### H6: 容器化未就绪

- `Dockerfile.backend` 有多处 hack（`COPY deerflow/package.json 2>/dev/null`）
- `k8s/deerflow.yaml` 的 readinessProbe 用 HTTP 探针，但 deerflow daemon 只有 Unix socket
- Docker 镜像未推送到 ghcr.io
- `docker-compose.yml` 缺 deerflow daemon 服务

### H7: STATUS.md 与 README.md 信息矛盾

| 项目 | STATUS.md 声称 | README.md 声称 | 实际 |
|------|---------------|---------------|------|
| 前端框架 | Next.js 15 + CopilotKit | Vite + TanStack Router | Vite ✅ |
| 桥 | `runtime/src/index.ts` (Node.js) | `agent/main.py` (Python) | Python ✅ |
| DeerFlow | `vendors/deer-flow/backend/` | `deerflow/daemon.py` (嵌入) | 嵌入 ✅ |
| 端口 | :8001(桥), :8002(DeerFlow), :8003(health) | :8000(后端), :8001(Agent) | :8000/:8001 ✅ |
| 服务数 | 3 进程 | 4+ 进程 | 4+ ✅ |

### H8: 测试无法运行

- `node_modules` 未安装 → `vitest`, `playwright`, `storybook` 全跑不了
- agent/.venv 存在但未验证 deerflow 端到端测试

---

## 四、🟡 中低风险项

| 项目 | 说明 |
|------|------|
| agent/main.py 无限流 | `config.py` 有 `rate_limit_per_minute` 字段但从未使用 |
| deerflow_brain.py cancel() 嵌套事件循环 | `asyncio.run()` 在已有循环中可能死锁 |
| 前端部分 UI 存根 | 右侧面板文件/追踪标签是 "Phase 10.5" 占位符 |
| i18n 不完整 | 5 种语言，仅 2 种 100% 完整 |
| 审计日志无加密 | secrets 表 `encrypted_value` 是 BLOB 但未见加密逻辑 |
| deerflow daemon 无鉴权 | 任何能访问 Unix socket 的进程都能调所有方法 |
| 事务不完整 | session 创建 + message 插入分两步无事务 |

---

## 五、✅ 做得好的地方

### 5.1 架构设计
- **六边形架构**：`agent/brain.py` 是干净的 ABC，hermes/deerflow 两个 brain 完全解耦
- **Adapter Pattern**：`brain_factory.py` 通过 `DASHENG_BRAIN_BACKEND` 环境变量切换，代码零改动
- **Clean monorepo**：pnpm workspace 结构清晰

### 5.2 后端质量
- **JWT 认证**：bcrypt + refresh token 撤销 + IP 锁定 + token 失效时间戳
- **输入验证**：所有端点 Zod safeParse
- **SQL 安全**：100% 参数化查询，无 SQL 注入风险
- **Stripe webhook**：完整 HMAC-SHA256 验签 + timingSafeEqual 防时序攻击
- **限流**：基于 tier 分级 (free/pro/enterprise)
- **Prometheus 可观测性**：业务指标完善

### 5.3 前端质量
- **12 个路由**全部是真实实现，无占位页面
- **API 客户端**自动 JWT 刷新 + 并发刷新合并
- **AG-UI GraphQL 客户端**完整
- **7 个 Playwright e2e spec**
- **5 语言 i18n** 框架完整

### 5.4 Go Sandbox
- **生产级 IPC server**：worker pool、优雅关闭、metrics
- **安全框架**：seccomp + cgroup v2 + namespace（Linux）
- **纯标准库**：零外部依赖

### 5.5 文档
- `README.md` 清晰准确（v0.3 架构）
- `deploy/PRODUCTION.md` 详尽实用
- 4 份 ADR 决策记录完整

---

## 六、连通性分析

### 6.1 能连通的链路 ✅

```
前端(3000) → 后端(8000) REST API → 社媒 Worker(9108-9113)
前端(3000) → Agent Bridge(8001) AG-UI GraphQL
后端(8000) → SQLite DB (21 表)
后端(8000) → Redis (可选缓存)
Agent(8001) → DeerFlow daemon (Unix socket)
Agent(8001) → Hermes Agent (vendored)
Go Sandbox(9100) → Unix socket JSON-RPC
```

### 6.2 连通但返回 Mock 的链路 ⚠️

```
Chat 输入"抖音爆款" → DouyinAgent → generate_video → Mock 模板
Chat 输入"小红书种草" → XiaohongshuAgent → generate_note → 硬编码
Agent Bridge AG-UI → DeerFlow daemon → research → 假 finding
前端文件浏览器 → sandbox file.list → (sandbox 实现但无真文件)
```

### 6.3 完全不通的链路 ❌

```
LLM 推理 → DEEPSEEK_API_KEY=占位符 → 无响应
容器化部署 → docker-compose 缺 deerflow → 不完整
K8s → readinessProbe HTTP 探针但 daemon 是 Unix socket → 永远 unhealthy
```

---

## 七、商用路线图

### 第一阶段: 解除阻断 (1-2 周)

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P0 | 更新 STATUS.md 为 v0.3 架构 | 2h |
| P0 | 老板提供真 DEEPSEEK_API_KEY / SILICONFLOW_API_KEY | 老板操作 |
| P0 | 接入真 LLM key 到 deerflow/agents/ + hermes_brain | 4h |
| P0 | 安装 node_modules (`pnpm install`) | 10min |

### 第二阶段: 补核心缺口 (2-3 周)

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P1 | 实现 DeerFlow 子 Agent 真逻辑（researcher/analyst/writer） | 3d |
| P1 | 修复后端优雅关闭 + 深健康检查 | 1d |
| P1 | 前端加路由守卫 + ErrorBoundary | 1d |
| P1 | 搞到社媒平台 cookie 并测试真发布 | 老板+2d |
| P1 | 修复 K8s readinessProbe（改成 exec 探针或加 HTTP 端点） | 2h |
| P2 | 实现 MCP/Skills 端点真逻辑 | 2d |
| P2 | browser sandbox 接 Playwright | 2d |
| P2 | research 接真搜索 API (Tavily/SerpAPI) | 1d |

### 第三阶段: 生产化 (2-4 周)

| 优先级 | 任务 | 工作量 |
|--------|------|--------|
| P2 | TLS + 域名 + WAF 配置 | 2d |
| P2 | 构建并推送 Docker 镜像到 ghcr.io | 1d |
| P2 | 完整 docker-compose.yml（含 deerflow daemon） | 1d |
| P2 | 数据库迁移方案（SQLite → PostgreSQL） | 3d |
| P2 | Redis 变为可选依赖（后端启动不 crash） | 2h |
| P2 | 审计日志加密 + Secret 管理 | 1d |
| P3 | Storybook 补完 + 视觉回归测试 | 3d |
| P3 | i18n 补完 5 语言 | 2d |

---

## 八、最终判定

| 场景 | 判定 |
|------|------|
| 本地开发演示 | ✅ 可以（需先 `pnpm install`） |
| 内部 Dogfooding | ⚠️ 需先补 LLM Key + 修阻断项 |
| 小范围 Beta | ❌ 缺太多 |
| 正式商用 | ❌ 至少 3-6 周缺口 |

**一句话**: 项目的**架构骨架非常优秀**——六边形设计、类型安全、安全基础扎实、文档详尽。但它是一个**80% 完成的骨架**，大量功能是 mock/stub，核心 AI 推理链路不通。`STATUS.md` 标注的"100% 代码完成"有误导性——代码框架 100% 完成，但业务逻辑约 40% 是 mock。

**建议**: 如果老板给真 LLM key，我可以在本轮立即打通核心推理链路，然后逐步补全各 stub。
