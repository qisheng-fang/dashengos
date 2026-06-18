# ADR-047 · AI Workbench v2 全新架构决策 (CopilotKit + DeerFlow 2.0)

> **状态**: PROPOSED (待老板签字)
> **日期**: 2026-06-14
> **作者**: 小爪 (整理)
> **决策者**: 老板
> **关联**: 老板原则 #4 「改前先 ADR」+ #5 「先复检再解释」

---

## 1. 背景

DaShengOS 经过 76 天迭代已成长为：
- 7 业务 Agent (Ecommerce/Content/CRM/CustomerService/Ad/Proactive/Workflow) + 43 工具
- Master Agent + WorkBuddy 189+ skills + bash_safe 3 级安全
- Hermes-V2 多 Agent 编排引擎 (Planner→Executor→Critic + 0 步检测 + LLM 兜底)
- chat-v2 自研 React 组件 (PlanTree + EventStream + InputBarV2)
- 26 平台集成 + 4 大支柱 (Feishu/ERP/Logistics/Content) + L0/L1 性能 (p95 0.16s)

老板痛点：
1. Hermes-V2 是 Py 自研，**新人上手慢 / 无外部社区贡献**
2. chat-v2 **手写 React 组件，Generative UI 缺失** (tool 结果全文本)
3. **没有 Human-in-the-loop** (Critic 0 步自动放行，老板原则 #2 抱怨过)
4. **没有 Shared state** (agent 看不到前端页面上下文)
5. **自定义 8 事件 SSE 协议**，外部工具/Agent 接不进来
6. **单 LLM gateway**，没有 multi-provider fallback
7. **状态管理分散** (前端 localStorage + 后端 SQL 短期) — 没有单点状态源

---

## 2. 决策 (老板 2026-06-14)

**采用「CopilotKit + DeerFlow 2.0」双开源项目组合**，作为 v2 的技术栈基础。
**新建独立项目** `/Users/apple/Desktop/ai-workbench-v2/`，跟 DaShengOS 物理隔离。

### 2.1 三个子决策

| 子决策 | 方案 | 理由 |
|---|---|---|
| **A. 范围** | 全新项目 (孤立)，不接 DaShengOS 任何代码/数据 | 老板决策 2026-06-14 |
| **B. 引擎** | 前端 CopilotKit + 后端 DeerFlow 2.0-rc-1 (等 stable 升级版本号) | DeerFlow 2.0 stable 未知何时，rc-1 用 pin 死法 |
| **C. 位置** | `/Users/apple/Desktop/ai-workbench-v2/` 独立目录 | 老板决策 |

### 2.2 老板 2026-06-14 重申架构 (P0 骨架重建依据)

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
                           │ DeerFlow Memory Sync
                           ▼
                  ┌──────────────────┐
                  │ CopilotKit Context│
                  │ (前端可读镜像)    │
                  └──────────────────┘
```

### 2.3 关键设计原则 (老板 2026-06-14 强调)

1. **AG-UI 是协议层，不是 runtime 层** — CopilotKit 直接用 AG-UI 跟 DeerFlow 通信，**不装 CopilotKit Runtime**（Runtime 跟 DeerFlow 撞角色）
2. **DeerFlow 是 Lead Agent 唯一入口** — 前端 AG-UI 请求直接到 DeerFlow 的 Lead Agent，不经过任何代理
3. **ConversationStore 是单点状态源** — onSend 钩子 + post-execution 钩子**统一写入**，避免前端 localStorage 跟后端 SQL 不一致（这是 Day 4 多轮修复中暴露的问题，老板原则 #5 透明列出）
4. **长期记忆双向同步** — DeerFlow 写、CopilotKit Context 读（**单向镜像**，不是双向复制 — 避免状态冲突）
5. **CopilotKit Context = 长期记忆的只读视图** — 前端用 `useAgentContext` 读，不能写（防 race condition）

---

## 3. 老板原则合规性

| 老板原则 | 合规性 | 说明 |
|---|---|---|
| #1 0 步 = 信号 | ✅ | DeerFlow planner 0 步 + 0 tool = unfulfillable 信号 |
| #2 CRITIC 默认满足 = 放行 bug | ✅ | 改用 `useHumanInTheLoop` 让老板真正拍板 |
| #3 LLM 兜底必须带历史 | ✅ | LangGraph checkpointing + ConversationStore 天然带 |
| #4 改前先 ADR | ✅ | 本 ADR |
| #5 先复检再解释 | ✅ | 已用 git ls-remote / sparse clone 验证两个项目真存在 |
| #6 禁止复读机 | ✅ | UI 用 CopilotKit 组件不再手写 |
| #7 单次工具失败立刻换工具 | ✅ | DeerFlow sub-agents 内置 retry 链 |

---

## 4. 影响

### 4.1 失去 (Losses)

- ❌ DaShengOS 7 业务 Agent 的领域知识（电商垂类）— 全新项目孤立，不接
- ❌ DaShengOS 43 工具的具体实现 — 重新建
- ❌ DaShengOS 26 平台集成 (淘宝/抖店/...) — 重新建
- ❌ DaShengOS 4 大支柱 (Feishu/ERP/Logistics/Content) — 重新建
- ❌ DaShengOS WorkBuddy 189 skills — 重新建 (DeerFlow Skills 系统不同)
- ❌ DaShengOS L0/L1 性能 (p95 0.16s) — 重新 benchmark
- ❌ DaShengOS 76 天 6+ Phase 迭代的所有 dev 经验

### 4.2 获得 (Gains)

- ✅ **AG-UI 协议** (Google/LangChain/AWS/MS 采纳) — 外部 Agent/工具可对接
- ✅ **Generative UI** (tool 结果 inline 渲染 React 组件) — 解决 Day 4 痛点
- ✅ **Human-in-the-loop** (老板真正拍板，不是 Critic 自动放行)
- ✅ **Shared state** (agent 实时看前端页面上下文)
- ✅ **8+ LLM provider** (多 provider fallback, 不再卡单一 gateway)
- ✅ **Sandbox** (Python 代码安全执行环境，bash_safe 升级版)
- ✅ **Long-Term Memory** (跨 session 记忆, localStorage 升级版)
- ✅ **MCP servers** (filesystem/github/postgres 标准化工具接入)
- ✅ **6+ 渠道** (web/Slack/Telegram/Discord/Feishu — DaShengOS 只有 web)
- ✅ **社区** (DeerFlow 2026-02-28 GitHub Trending #1 · 6+ 月活跃开发)
- ✅ **单点状态源** (ConversationStore) — 解决 Day 4 多轮修复中暴露的 localStorage 跟后端不一致问题

### 4.3 工作量估算 (全新项目)

| 阶段 | 内容 | 工期 | 风险 |
|---|---|---|---|
| **P0 骨架** | 目录 + ADR + frontend hello world + backend stub | 1-2 天 | 低 |
| **P1 PoC** | CopilotKit ↔ DeerFlow ↔ 1 mock tool (e.g. get_current_time) | 1 周 | 🟡 中 |
| **P2 业务工具** | 1 个真实业务工具端到端 | 2 周 | 🟡 中 |
| **P3 全量业务** | 7 Agent + 43 工具 + 26 集成 (如果要做) | 2-3 个月 | 🔴 高 |
| **P4 Generative UI** | Tool 结果 inline 渲染 + HITL 弹框 | 2 周 | 🟢 低 |
| **P5 切流** | 灰度 10% → 50% → 100% | 1 周 | — |

> ⚠️ 重要: 跟 DaShengOS **完全脱钩**意味着 P3 不是迁移, 是**重零建业务**。如果老板原意是迁移, 需要回到 ADR 重新讨论。

---

## 5. 风险 (透明 — 老板原则 #2)

| ID | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| R1 | DeerFlow 2.0 还不稳定 (rc 阶段) | 🔴 高 | pin 死 `release/2.0-rc-1`，stable 出来 swap |
| R2 | CopilotKit 不装 Runtime，transport 层要自己接 | 🟡 中 | 用 CopilotKit 的 `custom transport` 或 headless 模式 |
| R3 | "全新项目孤立" = 6+ 月业务资产丢失 | 🔴 高 | 已记入"失去"列表，老板签字前请确认 |
| R4 | 网络抽风 DeerFlow 源码拉不到 | 🟡 中 | sparse-checkout fallback (已验证 v2.0-m0 能拉 18 文件) |
| R5 | AG-UI 协议 v0 还在演进，可能 breaking change | 🟡 中 | 封装在 ConversationStore 后面，AG-UI 变化只动 DeerFlow 端 |
| R6 | 性能回归 (DaShengOS 0.16s p95 是 6 周调出来的) | 🔴 高 | P1 PoC 必跑 k6 baseline |
| R7 | LangGraph 学习曲线 | 🟢 低 | DeerFlow 文档化 + 内部培训 |
| R8 | ConversationStore 单点失败风险 | 🟡 中 | 用 LangGraph MemorySaver (DeerFlow 自带) + 定期 SQLite dump |

---

## 6. 老板签字栏

> **✅ 老板 2026-06-14 拍板: "可以开干"** — 5 项全部确认, 进入 P0 → P1 实施

- [x] 老板确认 "全新项目 (孤立)" 范围 (老板决策 #1)
- [x] 老板确认 "DeerFlow 2.0-rc-1 当 dev 版本" 路径 (老板决策 #2)
- [x] **老板确认"不装 CopilotKit Runtime, AG-UI 直接到 DeerFlow"** (2026-06-14 关键修正)
- [x] **老板确认"ConversationStore 是单点状态源"** (2026-06-14 关键修正)
- [x] **老板确认"长期记忆单向同步到 CopilotKit Context"** (2026-06-14 关键修正)
- [x] 老板确认位置 `/Users/apple/Desktop/ai-workbench-v2/` (老板决策 #3)

---

## 7. 关联文档

- **ADR-048**: 详细迁移路径 / Phase 拆分 / 任务列表
- **ADR-049**: 能力对比表 (DaShengOS 现状 vs ai-workbench-v2 目标)
- **README.md**: 项目根目录速查
- **docs/architecture.md**: 详细架构图 + 部署
