# Day 0 骨架 · 详细架构文档

> **状态**: P0 (骨架) · **老板 2026-06-14 重申架构**
> **关联**: [ADR-047](../docs/adr/ADR-047-ai-workbench-v2-architecture.md) · [ADR-048](../docs/adr/ADR-048-migration-phases.md) · [ADR-049](../docs/adr/ADR-049-capability-matrix.md)

---

## 老板 2026-06-14 修订架构 (P0 骨架重建依据)

```
                    ┌──────────────┐
                    │  用户消息     │
                    └──────┬───────┘
                           │
                           ▼
   ┌─────────────────┐    AG-UI    ┌─────────────────────┐
   │ CopilotKit 前端 │ ──────────▶ │ DeerFlow Lead Agent │
   │ (React)         │             │ (Python · LangGraph) │
   └────────┬────────┘             └──────────┬──────────┘
            │ onSend hook                    │ post-execution hook
            ▼                                 ▼
   ┌──────────────────────────────────────────────────────┐
   │            ConversationStore (单点状态)                │
   │       统一写入 · 多端读取 · 长期记忆底座                │
   └────────────────────────┬─────────────────────────────┘
                            ▼
                  ┌──────────────────┐
                  │     长期记忆      │
                  └────────┬─────────┘
                           │ DeerFlow Memory Sync (单向)
                           ▼
                  ┌──────────────────┐
                  │ CopilotKit Context│
                  │ (前端只读镜像)    │
                  └──────────────────┘
```

---

## 设计原则 (老板 2026-06-14 强调)

1. **AG-UI 是协议层，不是 runtime 层** — CopilotKit 直接用 AG-UI 跟 DeerFlow 通信，**不装 CopilotKit Runtime**（跟 DeerFlow 撞角色）
2. **DeerFlow 是 Lead Agent 唯一入口** — 前端 AG-UI 请求直接到 DeerFlow 的 Lead Agent，不经过任何代理
3. **ConversationStore 是单点状态源** — onSend 钩子 + post-execution 钩子**统一写入**
4. **长期记忆单向同步** — DeerFlow 写、CopilotKit Context 读（**单向镜像**，避免状态冲突）
5. **CopilotKit Context = 长期记忆的只读视图** — 前端用 `useAgentContext` 读，不能写

---

## 数据流 (P0 · hello world)

```
Browser                CopilotKit (3000)         DeerFlow Lead Agent (8002)         ConversationStore
   │                        │                              │                              │
   │  GET /                 │                              │                              │
   ├───────────────────────>│                              │                              │
   │  render React tree     │                              │                              │
   │<───────────────────────┤                              │                              │
   │                        │                              │                              │
   │  type "现在几点了"      │                              │                              │
   ├───────────────────────>│                              │                              │
   │                        │  onSend hook                 │                              │
   │                        ├─────────────────────写入 ───────────────────────────────>│
   │                        │                              │                              │
   │                        │  AG-UI SSE stream            │                              │
   │                        ├─────────────────────────────>│                              │
   │                        │                              │  post-execution hook         │
   │                        │                              ├─────────────写入 ────────────>│
   │                        │                              │                              │
   │                        │  AG-UI events 流回             │                              │
   │                        │<─────────────────────────────┤                              │
   │  看到时间 ◄────────────┤                              │                              │
   │                        │                              │  Memory Sync (单向)         │
   │                        │                              ├─────────────读取 ────────────>│
   │  useAgentContext() ◄───┼──────────────────────────────┼──────────────────────────────┤
   │  读到持久化历史          │                              │                              │
```

---

## 进程拓扑 (P0)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser  http://localhost:3000                                       │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ (Next.js client + CopilotKit React)
                               │ 走 AG-UI 直接到 DeerFlow Lead Agent
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  frontend/  Next.js 15 + CopilotKit 1.60.1  (:3000)                  │
│  ─ app/layout.tsx     CopilotKit provider (不挂 Runtime, 直连 8002)   │
│  ─ app/page.tsx       <CopilotChat> + <CopilotSidebar> + useAgentContext│
│  ─ app/globals.css    minimal dark theme                              │
│  ─ 自定义 transport  AG-UI over HTTP → http://localhost:8002          │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ (AG-UI over HTTP/SSE, port 8002)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  backend/   DeerFlow 2.0-rc-1 (vendors/deer-flow)  (:8002)            │
│  ─ Lead Agent        LangGraph state machine (Python)                │
│  ─ onSend hook      接收 AG-UI → 写 ConversationStore                 │
│  ─ post-execution    工具调用后 → 写 ConversationStore                 │
│  ─ Memory Sync       单向同步到 CopilotKit Context                    │
│  ─ Skills            extensible (替代 DaShengOS WorkBuddy)            │
│  ─ Sandboxes         Python sandbox (替代 DaShengOS bash_safe)         │
│  ─ MCP servers       filesystem/github/postgres/...                   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ (read/write 共享)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ConversationStore  (DeerFlow MemorySaver 底座)                       │
│  ─ LangGraph MemorySaver (in-memory + SQLite dump)                   │
│  ─ 统一写入端: onSend hook + post-execution hook                      │
│  ─ 读取端: DeerFlow Memory Sync → CopilotKit Context                  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 端口分配 (P0)

| 进程 | 端口 | URL |
|---|---|---|
| frontend (Next.js) | **3000** | http://localhost:3000 |
| backend (DeerFlow) | **8002** | http://localhost:8002 |
| ~~runtime (CopilotKit Runtime)~~ | ~~8001~~ | **取消** (老板 2026-06-14 修正) |

> ⚠️ P0 阶段不再有 `runtime/` 目录 — CopilotKit 不装 Runtime, AG-UI 直连 DeerFlow

---

## P0 → P1 升级路径

| 改动 | 文件 | 验收 |
|---|---|---|
| 1. 启动 vendors/deer-flow/backend (Lead Agent) | `vendors/deer-flow/backend/` | 端口 8002 能起 |
| 2. frontend 自定义 transport 直连 :8002 | `frontend/app/layout.tsx` | AG-UI 请求不经过任何代理 |
| 3. ConversationStore 初始化 (DeerFlow MemorySaver) | `vendors/deer-flow/backend/app/` | Lead Agent 写状态后能从 SQLite 读回 |
| 4. 注册 1 mock tool ("get_current_time") | `vendors/deer-flow/skills/` | 浏览器输入"现在几点了" → tool 调用 → 返回时间 |
| 5. E2E 验收 | `scripts/smoke.sh` + k6 perf baseline | 跑通 |

---

## 与初版 P0 差异 (老板 2026-06-14 修正)

| 项目 | 老板修订前 (我初版) | 老板修订后 (现版) |
|---|---|---|
| 进程数 | 3 (frontend + runtime + backend) | **2** (frontend + backend) |
| AG-UI 协议载体 | CopilotKit Runtime (Node.js) | **DeerFlow Lead Agent (Python)** |
| 状态写入 | 分散 (前端 onSend 直写 + 后端 post-exec) | **统一写入 ConversationStore** |
| 长期记忆同步 | 无 (localStorage 兜底) | **DeerFlow Memory Sync → CopilotKit Context (单向)** |
| 代码目录 | 多一层 `runtime/` | **取消 `runtime/`, DeerFlow 是后端** |

---

## 安全注意事项 (P0)

- **不要在生产暴露**: AG-UI endpoint P1 加 API key
- **OPENAI_API_KEY 必传**: P1 阶段 DeerFlow Lead Agent 需要真 LLM
- **CORS 白名单**: `localhost:3000` (frontend) 调 `localhost:8002` (DeerFlow)
- **DeerFlow 2.0 是 rc**: 不建议直接挂老板生产, 先在 P1 PoC 环境跑
- **ConversationStore 备份**: LangGraph MemorySaver 默认 in-memory, 配定期 SQLite dump 防止状态丢失
