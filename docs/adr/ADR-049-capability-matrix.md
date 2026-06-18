# ADR-049 · 能力对比 (DaShengOS 现状 vs ai-workbench-v2 目标)

> **日期**: 2026-06-14
> **关联**: ADR-047 §4 影响

---

## 能力矩阵

✅ 保留/提升 · 🆕 新增 · ❌ 失去 · 🔄 需重建 · 🟡 部分覆盖

| 维度 | DaShengOS 现状 | ai-workbench-v2 目标 | 状态 | 备注 |
|---|---|---|---|---|
| **前端框架** | Next.js 14 + 自写 React 组件 (chat-v2) | Next.js 15 + CopilotKit 1.60.1 | 🆕 升级 | |
| **前端 chat UI** | 手写 chat-v2 (PlanTree + EventStream + InputBarV2) | <CopilotChat> + <CopilotSidebar> | 🆕 替换 | |
| **Generative UI** | ❌ 无 (tool 结果全文本) | ✅ inline 渲染 React 组件 | 🆕 新能力 | CopilotKit 强项 |
| **前端 Tool** | ❌ 无 | ✅ useFrontendTool 浏览器侧 handler | 🆕 新能力 | CopilotKit 强项 |
| **Shared State** | ❌ 无 | ✅ useAgentContext + useCoAgentStateRender | 🆕 新能力 | CopilotKit 强项 |
| **Human-in-the-Loop** | ❌ 无 (Critic 0 步自动放行) | ✅ useHumanInTheLoop 老板拍板 | 🆕 新能力 | 解决老板原则 #2 |
| **多 Agent 引擎** | Hermes-V2 自研 (Planner→Executor→Critic) | DeerFlow 2.0 (LangGraph) | 🆕 替换 | Sub-Agents 概念 |
| **0 步检测** | Hermes-V2 关键词扫描 | DeerFlow planner 0 步 + 0 tool | ✅ 提升 | |
| **LLM 兜底带历史** | ✅ Hermes-V2 LLM 兜底带 history | ✅ LangGraph checkpointing | ✅ 提升 | |
| **SSE 协议** | 自研 8 事件协议 | AG-UI 协议 (行业标准) | 🆕 升级 | Google/LangChain/AWS 采纳 |
| **外部工具接入** | 自研 worker (15+ 个) | MCP servers (filesystem/github/postgres/...) | 🆕 升级 | |
| **LLM Provider** | 1 个统一 gateway | 8+ provider (Volcengine/OpenAI/DeepSeek/...) | 🆕 升级 | Multi-provider fallback |
| **Sandbox** | bash_safe 3 级 (in-process subprocess) | DeerFlow sandbox (Python 代码沙盒) | 🆕 升级 | 隔离更彻底 |
| **Skills** | WorkBuddy 189+ skills | DeerFlow Skills (extensible) | 🔄 重建 | 跟 DaShengOS 不兼容 |
| **Master Agent dispatch** | Master Agent + SkillBridge | DeerFlow Sub-Agents dispatch | 🔄 重建 | |
| **多渠道** | 只 web | web + Slack + Telegram + Discord + Feishu | 🆕 新能力 | DeerFlow 自带 |
| **长期记忆** | localStorage + SQL 短期 | LangGraph SQLite + Redis | 🆕 升级 | |
| **监控** | Prometheus + Langfuse | LangSmith + Langfuse | ✅ 提升 | |
| **链路追踪** | OpenTelemetry + Langfuse | LangSmith + Langfuse | ✅ 提升 | |
| **Trace 可视化** | 无 (raw log) | LangSmith UI | 🆕 新能力 | |
| **业务 Agent 7 个** | Ecommerce/Content/CRM/CustomerService/Ad/Proactive/Workflow | (待 P3 重建) | 🔄 重建 | |
| **业务工具 43 个** | 已实现 | (待 P3 重建) | 🔄 重建 | |
| **26 平台集成** | 淘宝/抖店/快手/微信/... | (待 P3 重建) | 🔄 重建 | |
| **4 大支柱** | feishu/erp/logistics/content/file | (待 P3 重建) | 🔄 重建 | |
| **凭证库** | `~/.workbuddy/credentials/` | (待 P3 重建) | 🔄 重建 | |
| **L0/L1 性能** | p95 0.16s (cache hit 稳态) | (待重新 benchmark) | 🟡 重测 | 不能丢 |
| **Plan/Critic cache** | 内存 LRU (default) | LangGraph MemorySaver + Redis | 🆕 升级 | |
| **硬刷新不丢历史** | localStorage 兜底 | LangGraph checkpointing | 🆕 升级 | |
| **7 业务领域知识** | 淘宝 GMV/抖音销量/... 集成 | (无 — DeerFlow 通用) | ❌ 失去 | 全新项目无法继承 |
| **爱尤趣/情趣娃娃 行业 know-how** | 沉淀在 7 Agent + 43 工具 | ❌ 失去 | ❌ | 全新项目从零 |
| **dev 团队积累** | 76 天迭代, 几千文件 | ❌ 失去 | ❌ | 全新项目从零 |
| **社区贡献** | ❌ 无 | ✅ DeerFlow 6+ 月活跃 (GitHub Trending #1) | 🆕 新能力 | |
| **协议标准化** | 自研 | AG-UI (Google/LangChain/AWS) | 🆕 升级 | 外部 Agent 可对接 |
| **可视化调试** | EventStream 面板 (15 事件滚动) | LangSmith UI + CopilotKit DevTools | 🆕 升级 | |
| **A/B 测试** | 无 | LangSmith experiments | 🆕 新能力 | |
| **评估 (Evals)** | pytest 47/47 PASS | LangSmith Evals | 🆕 升级 | |

---

## 失去清单 (老板决策 #1 "全新项目孤立" 直接导致)

> 老板决策 = 100% 失去。如要保留, 需回到 ADR 重新讨论 "新项目跟 DaShengOS 平行" 模式。

1. **爱尤趣/情趣娃娃 7 业务 Agent 领域知识** — 26 平台集成是几年沉淀
2. **WorkBuddy 189+ skills** — DeerFlow Skills 体系不兼容
3. **bash_safe 3 级安全模型** — 需要重新适配 DeerFlow sandbox
4. **Master Agent dispatch** — 需要重新设计成 DeerFlow Sub-Agents
5. **L0/L1 性能优化** (p95 0.16s, 6 周调出来) — 重新 benchmark
6. **76 天 6+ Phase 迭代的所有 dev 经验**

---

## 获得清单 (老板决策 #1/#2/#3 共同导致)

1. **AG-UI 协议** — 行业标准, 外部工具/Agent 可对接
2. **Generative UI** — 解决 Day 4 多轮修复中暴露的 tool 结果纯文本痛点
3. **Human-in-the-loop** — 解决老板原则 #2 (Critic 自动放行)
4. **Shared state** — Agent 实时看前端上下文
5. **8+ LLM provider fallback** — 不再卡单 gateway
6. **6+ 渠道** — Slack/Telegram/Discord/Feishu
7. **LangSmith 链路追踪 + Evals** — 比 Prometheus 维度更细
8. **社区贡献** — DeerFlow 6+ 月活跃, GitHub Trending #1
9. **MCP servers** — 标准化工具接入 (filesystem/github/postgres)
10. **Long-Term Memory** — 跨 session 记忆

---

## 总结

**v2 是"加法"大于"减法"**，但**加法在能力维度, 减法在领域维度**。

老板如果想保留 DaShengOS 7 业务 Agent 领域知识, 走"新项目跟 DaShengOS 平行"模式:
- 业务资产 (7 Agent / 43 工具 / 26 集成) 通过 DeerFlow Skills 接口包装, 平迁到 v2
- DaShengOS 旧 Hermes-V2 路由降级为 fallback
- 工期: 6 周 (vs 全新孤立 6-12 个月)

**建议老板重新拍 P3 范围**: 是「重零建业务」还是「平迁业务 + 加 Generative UI/HITL 等新能力」。

> 本 ADR 待老板基于 P3 范围决策后, 再更新 §P3 任务列表。
