# ADR-050 · DaShengOS v0.2 → v0.3 完整迁移决策 (WorkBuddy 私有 AI 工作台)

> **状态**: ACCEPTED (老板 2026-06-15 签字)
> **日期**: 2026-06-15
> **作者**: 小爪 (整理)
> **决策者**: 老板
> **前置**: ADR-047 (CopilotKit + DeerFlow 双开源) · ADR-048 (Phase 拆分) · ADR-049 (能力对比)
> **关联**: 老板原则 #4 「改前先 ADR」+ #5 「先复检再解释」+ #6 「禁止复读机」
> **来源**: `/Users/apple/WorkBuddy/2026-06-15-02-43-15/.workbuddy/docs/dasheng-os-private-ai-workbench-dev-guide-v0.3.html` (11145 行 / 42 节 / 6 附录)
> **PoC**: Phase 0 hello world 已 ✅ (deerflow/daemon.py + runtime/src/deerflow-socket-client.ts + runtime/src/test-deerflow-socket.ts, health.ping 2ms / hello.echo 0ms)
> **3 决策 (2026-06-15 老板拍板)**: 1) 范围=Phase 1+2+3 一起 12-16 周 (中途 2-3 周零聊天窗口) · 2) CopilotKit 命运=彻底删除 (frontend/app/ 全部删, /legacy 路由不保留) · 3) DeerFlow 嵌入=用 vendored DeerFlow 2.0-rc-1 (按 v0.3 spec §35-37 完全复现嵌入模式)

---

## 1. 背景

老板 2026-06-15 拍板：要按 v0.3 完整开发指南重做 **DaShengOS 私有 AI 工作台**（physical 在 `/Users/apple/Desktop/ai-workbench-v2`）。

### 1.1 v0.3 spec 新加的 9 大块（vs v0.2）

| # | 章节 | 内容 | 强度 |
|---|---|---|---|
| 1 | §0 迁移 | 7 项 break change + 30 分钟迁移步骤 | 全局 |
| 2 | §30 UI 设计 | 5 原则 + token.ts + 爱尤趣橙 #FF6B35 + 暗色优先 + 锁版技术栈 | 中 |
| 3 | §31 布局 | 5 区 WorkspaceShell + useBreakpoint + Framer Motion | 中 |
| 4 | §32 9 屏 | Login / Workspace / Chat / AgentMarket / SkillDetail / McpManager / FileBrowser / Settings / ErrorPage | 大 |
| 5 | §33 25 组件 | shadcn/ui 复制粘贴 + 7 工作台组件 + Storybook | 中 |
| 6 | §34 状态/路由/i18n | Zustand + TanStack Router + react-i18next (5 lang) + next-themes + TanStack Query | 中 |
| 7 | §35 DeerFlow 集成 | JSON-RPC over Unix socket + 14 IPC 方法 + MCP 互调 + 凭据共享 | 大 |
| 8 | §36 deerflow.yaml | 1 lead + 5 sub-agents (researcher/analyst/writer/security/quality) + 3 实战案例 | 大 |
| 9 | §37 部署/监控 | 容器 + supervisord + Worker 池 + Trace 同步 + K8s + Prom/Grafana + runbook | 大 |

### 1.2 现状（v0.2-ish MVP）vs v0.3 目标 关键差距

| 维度 | 现状 (v0.2 MVP, P0-P5A ✅) | v0.3 目标 | 缺口 |
|---|---|---|---|
| 前端框架 | Next.js 15 | Vite + TanStack Router | 框架栈重写 |
| 前端 UI | CopilotKit + 1623 行 CSS + 15 组件 | shadcn/ui + Tailwind 3.4+ + 25 组件 | 全栈 UI 重做 |
| 前端状态 | useState + CopilotKit state | Zustand + TanStack Query + react-i18next | 状态层重做 |
| 后端 | Node.js `node:http` 桥 (runtime/src/index.ts) | Fastify (TypeScript) packages/backend/ | 后端重写 |
| ORM | 无 (裸 SQLite) | Drizzle + 14 张表 + 4 DeerFlow 表 | 全部新建 |
| 缓存 | 无 | Redis (11 key 模式 + 雪崩/击穿/穿透 + pub/sub) | 全部新建 |
| 沙箱 | DeerFlow 内置 | Go 写的 Firecracker/Docker + seccomp + rlimit | 全部新建 |
| MCP | 仅 package-lock 引用 | client + 5 白名单 server + 签名验证 | 全部新建 |
| Auth | DeerFlow session (cookie+CSRF) | JWT (access 15min / refresh 7d) + bcrypt + MFA | 全部新建 |
| Audit | 无 | HMAC 签名 + Redis pub/sub + JSON/CSV/PDF 导出 | 全部新建 |
| DeerFlow 集成 | HTTP REST :8002 (vendored) | JSON-RPC over Unix socket + Python daemon + 5 sub-agents | 重写嵌入模式 |
| 部署 | dev.sh 3 服务 | Docker Compose + supervisord + K8s + Prom + Grafana | 全套新建 |
| 测试 | 仅 P2 pytest | Vitest + Playwright + 4 安全 PoC | 全套新建 |

**结论**：90% 新建 + 10% 沿用，**3-4 个月工程**。

### 1.3 老板原则冲突检查

- 原则 #4「改前先 ADR」 → 本 ADR 满足 ✅
- 原则 #5「先复检再解释」 → 风险列表见 §5
- 原则 #6「禁止复读机」 → v0.3 §33 锁版组件库（不许引入新库）满足 ✅
- 原则 #7「单次工具失败立刻换工具」 → v0.3 §16.1 agent 状态机 + §36.6 sub-agent retry 满足 ✅
- 历史拍板「前端 UI 只在 ai-workbench-v2 改」 → v0.3 spec 前端都在 `apps/web/`，不动 DaShengOS backend/static/chat-v2-app/，满足 ✅

---

## 2. 决策 (老板 2026-06-15 拍板)

**完整按 v0.2→v0.3 迁移 42 节**，分 5 阶段 12-16 周落地。**代码全部在 `/Users/apple/Desktop/ai-workbench-v2`**，不动 DaShengOS 本体。

### 2.1 三个核心子决策

| 子决策 | 方案 | 理由 |
|---|---|---|
| **A. 范围** | 完整 v0.3 迁移（42 节 + 6 附录） | 老板拍板 |
| **B. 架构** | apps/web (Vite+TanStack+shadcn) + packages/backend (Fastify+Drizzle+Redis) + packages/sandbox (Go) + deerflow/ (Python daemon) | v0.3 §15 monorepo 锁版 |
| **C. 阶段** | 5 阶段 12-16 周（Phase 0 决策 → Phase 1 前端 → Phase 2 后端 → Phase 3 沙箱+DeerFlow → Phase 4 部署 → Phase 5 收官） | 风险分层，老板每个 Phase 可中断验收 |

### 2.2 Phase 0（本周，1-2 天）交付

1. **本 ADR-050**（v0.3 决策记录 + 风险列表 + 路线图）
2. **PoC 通过 ✅**：Python daemon + JSON-RPC over Unix socket + TypeScript client → hello world 跑通（2026-06-15 04:22）
3. **3 个开放决策 (2026-06-15 老板拍板)**：
   - **决策 1** ✅ — **Phase 1+2+3 一起 12-16 周**（中途 2-3 周零聊天窗口）
   - **决策 2** ✅ — **彻底删除 CopilotKit**（frontend/app/ 全部删, 不保留 /legacy 路由）
   - **决策 3** ✅ — **vendored DeerFlow 2.0-rc-1**（按 v0.3 spec §35-37 完全复现嵌入模式）

### 2.3 Phase 0 不做的事

- 不动 frontend/（保留到 Phase 1 验证通过再删）
- 不动 runtime/（保留到 Phase 2 验证通过再删）
- 不动 agent/ hermes（hermes 迁到 deerflow/hermes-adapter.py 走 Adapter Boundary）
- 不动 DaShengOS 本体

---

## 3. 5 阶段路线图（详细见 `/Users/apple/.claude/plans/robust-cuddling-deer.md`）

| Phase | 范围 | 工期 | 验收 |
|---|---|---|---|
| **0 · 决策** | ADR-050 + 1 PoC + 老板拍板 3 决策 | 1-2 天 | hello world 通 |
| **1 · 前端重写** | apps/web (Vite+TanStack+shadcn+25 组件+9 屏+WorkspaceShell+i18n) | 2-3 周 | 老板截图验证 5 设计原则 |
| **2 · Fastify 后端** | packages/backend (47 端点 + Drizzle 14 表 + Redis + 8 模块 + 5 MCP) | 3-4 周 | curl 47 端点 + 联调前端 |
| **3 · 沙箱 + DeerFlow 嵌入** | packages/sandbox (Go) + deerflow/ (Python daemon) + 14 IPC + worker 池 + 5 sub-agents | 3-4 周 | 「行业调研」prompt → 5 researcher 并发 → lead 汇总 → quality 检查 |
| **4 · 部署 + 监控 + K8s** | Docker Compose + K8s + CI/CD + Prom/Grafana + Vitest + Playwright + 4 安全 PoC | 2 周 | `docker compose up` + `kubectl apply` + E2E 全过 |
| **5 · 桌面端 + 收官** | Tauri 2.x + 移动端响应式 + v0.3 验收清单 + 老板 demo | 1-2 周 | 录 5 分钟视频 |

---

## 4. v0.2 已交付可复用清单

| 现有文件 | 复用方式 | 迁到 |
|---|---|---|
| `frontend/app/page.tsx`（Workspace 结构 + domain tabs + chips） | 抽成 fixture | `apps/web/src/screens/Workspace.tsx` |
| `frontend/app/components/WorkBuddySidebar.tsx` | 抽成 Sidebar | `apps/web/src/components/workspace/Sidebar.tsx` (260px→280px) |
| `frontend/app/components/BusesPanel.tsx`（4 业务总线数据） | 抽成 fixture | `apps/web/src/fixtures/buses.json`（等 Phase 2 接入 Redis） |
| `frontend/app/components/FeedbackPortal.tsx`（MutationObserver 模式） | 抽成 lib | `apps/web/src/lib/dom-observer.ts` |
| `frontend/app/globals.css`（1623 行 + 30+ `--cdx-*` 变量） | 部分映射 | 保留 5 关键 CSS variable，删除 25 个 |
| `frontend/app/lib/edit-diff.ts` | 直接搬 | `apps/web/src/lib/edit-diff.ts` |
| `runtime/src/index.ts`（AG-UI 桥逻辑） | 改写 | `packages/backend/src/api/sessions/messages.ts` |
| `runtime/src/evolution/`（L1/L2/L3 SQLite 模型） | 迁到 Drizzle | `packages/backend/src/core/evolution/` |
| `runtime/src/buses.ts`（4 业务总线） | 迁到 Redis | `packages/backend/src/core/session-manager.ts` |
| `runtime/src/metrics.ts`（Prom 指标） | 迁到 services | `packages/backend/src/services/metrics.ts` |
| `backend/p2/get_today_gmv.py` + `p3/query_orders.py` | 改写为 TS | `packages/backend/src/core/tools/builtin/{gmv,orders}.ts` |
| `vendors/deer-flow/`（已 vendored DeerFlow 2.0-rc-1） | 抽 daemon + sub-agent 逻辑 | `deerflow/daemon.py` + `deerflow/agents/` |
| `agent/hermes_brain.py`（hermes-agent 包装） | Adapter Boundary 模板 | `deerflow/hermes-adapter.py` |
| `runtime/src/deerflow-session.ts`（DeerFlow session 管理） | 改写为 daemon client | `packages/backend/src/services/deerflow/client.ts` |

**不搬**：CopilotKit 所有引用（`@copilotkit/react-core` / `useAgent` / `useRenderToolCall` / `useHumanInTheLoop` / `ToolRegistry.tsx`）→ v0.3 栈纯原生替代。

---

## 5. 风险列表

| 风险 | 概率 | 缓解 |
|---|---|---|
| CopilotKit 1.60+ 用 GraphQL 不 SSE，迁到 Zustand+TanStack Query 流式时坑 | 高 | Phase 1 PR1 先 PoC：5 行 Zustand + fetch EventSource 跑通 1 屏再全量 |
| v0.3 spec 11K 行，老板改主意要改 §30 配色或 §32 屏数 | 中 | Phase 1 PR1 把 token 单独 PR 出来，老板改 1 个 hex 就能立即生效 |
| DeerFlow 2.0-rc-1 在生产不稳定 | 高 | Phase 3 PR1 用 hermes-agent v0.13.0 替代 DeerFlow 做 fallback，daemon 协议对齐即可 |
| Phase 1 没聊天能力，老板 2 周没用 | 中 | 保留 `frontend/app/` 作为 `/legacy` 路由兜底，1-2 周内可切回 CopilotKit 聊天 |
| 47 端点 + 14 表 + 8 模块 + 25 组件，Phase 2/3 工期翻倍 | 中 | 老板拍板后每个 Phase 拆 7 个小 PR，每个小 PR 1-2 天，给老板「日更」感 |
| Drizzle + Redis + Fastify 全是新栈，学习曲线 | 中 | 每个 PR 配 1 个 ADR 子决策，先查 v0.3 spec 引用 §10/§12/§13 |
| pnpm 未装（用 npm） | 低 | 装 pnpm + 用 corepack 一行启用 |
| Python 3.11 (没 3.12) | 中 | deerflow/pyproject.toml requires-python = ">=3.11,<3.13"（比 v0.3 spec 3.12 略宽） |
| 14 张表 + 4 DeerFlow 表 + FTS5 触发器 migration 写错 | 中 | 用 SQL 客户端先跑 .sql 文件验证，OK 后再包成 Drizzle migration |
| 现有 4 大支柱 BusesPanel / EvolutionPanel 数据丢失 | 中 | Phase 1 之前全 fixture 化，存 `apps/web/src/fixtures/`，可逆 |

---

## 6. 验收清单（Phase 0 老板拍板前）

- [ ] **老板看了 v0.3 spec §30 截图 + §32 9 屏 ASCII + §35 DeerFlow 架构图** → 点头
- [ ] **3 个开放决策回答了**（Phase 范围 / CopilotKit 命运 / DeerFlow 替代）
- [ ] **Phase 0 PoC 跑通**：`daemon.py` 起 + `client.ts` 通过 Unix socket 收到 `{"jsonrpc":"2.0","result":"hello world","id":1}`
- [ ] **老板签 ADR-050** + status 改 ACCEPTED

---

## 7. 老板签字栏

> 老板: **DaSheng OS** &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 日期: **2026-06-15** &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 状态: **ACCEPTED**
