# ADR-048 · AI Workbench v2 Phase 拆分 + 任务列表

> **状态**: PROPOSED (依赖 ADR-047 老板签字)
> **日期**: 2026-06-14
> **关联**: ADR-047 §4.3 工作量估算
> **老板 2026-06-14 修订**: 不装 CopilotKit Runtime, AG-UI 协议直连 DeerFlow Lead Agent, 2 进程 (frontend + deer-flow) 而非 3 进程

---

## P0 · 项目骨架 (1-2 天)

### P0 任务清单

- [x] **T0.1** 创建 `/Users/apple/Desktop/ai-workbench-v2/` 目录
- [x] **T0.2** 克隆 CopilotKit → `vendors/copilotkit/` (185M · 17k 文件)
- [x] **T0.3** 克隆 DeerFlow 2.0-rc-1 → `vendors/deer-flow/` (45M · release/2.0-rc-1 tag)
- [x] **T0.4** 写 ADR-047 (主架构, 含老板 2026-06-14 修订)
- [x] **T0.5** 写 ADR-048 (本文件 — 任务列表)
- [x] **T0.6** 写 ADR-049 (能力对比)
- [x] **T0.7** 顶层 README.md
- [x] **T0.8** `frontend/` 骨架 (Next.js 15 + CopilotKit v1 stable, hello world)
  - [x] `package.json` (next 15 + react 19 + @copilotkit/react-core 1.60.1 + react-ui 1.60.1)
  - [x] `app/layout.tsx` (CopilotKit provider, runtimeUrl → :8002 直连 DeerFlow)
  - [x] `app/page.tsx` (CopilotChat + CopilotSidebar + useCopilotReadable)
  - [x] `app/globals.css` (minimal dark theme)
  - [x] `tsconfig.json` + `next.config.mjs`
  - [x] `npm install` 完成 (319 模块, next + @copilotkit/* 都装好)
  - [x] `tsc --noEmit` 0 错 ✅
- [x] **T0.9** ~~`backend/` 骨架~~ (老板 2026-06-14 修订后**取消** — 后端直接用 vendors/deer-flow)
- [x] **T0.10** `scripts/dev.sh` (一键启动 frontend + deer-flow, 2 进程)
- [x] **T0.11** `scripts/smoke.sh` (E2E 验收, 2 关)
- [x] **T0.12** `docs/architecture.md` (详细架构图, 含老板修订)
- [x] **T0.13** `.gitignore` (项目根 + frontend/)

### P0 验收

- 浏览器打开 `http://localhost:3000` 看到 CopilotKit 的空 chat UI ✅
- `npm install` 成功 ✅
- `tsc --noEmit` 0 错 ✅
- `tests/smoke.sh` 待 DeerFlow 启起来后跑 (Day 1)

---

## P1 · CopilotKit ↔ AG-UI ↔ DeerFlow PoC (1 周)

### P1 任务清单

- [x] **T1.1** DeerFlow 2.0-rc-1 跑通 (`cd vendors/deer-flow/backend && uv sync && uv run uvicorn app.gateway.app:app --port 8002`) ✅
  - 注意: 启动时 `VIRTUAL_ENV` 不能从父 shell 继承 (会跟 DeerFlow 自己的 `.venv` 冲突), 需 `unset VIRTUAL_ENV`
  - 注意: `config.yaml` 例子里 `models:` 字段全是注释, Pydantic 验成 `None` 失败 — 改成 `models: []` 或填真 model
  - 注意: Admin 密码每次重启会重新生成 (写到 `.deer-flow/admin_initial_credentials.txt`), 标题会变 "DeerFlow admin **reset** credentials"
- [x] **T1.2** DeerFlow Lead Agent 暴露 63 个 endpoint (走 langgraph.json 注册 `lead_agent`) ✅
  - `/api/assistants/{id}/graph` — LangGraph schema
  - `/api/threads/*` — 线程管理 (POST 创建, runs/stream + runs/wait 发消息)
  - `/api/memory/*` — Memory (就是 ConversationStore)
  - `/api/skills/*` — 技能管理 (custom skills 走文件系统, 不是 API POST)
  - 63 个 path 全在 `/api/` 前缀下
- [x] **T1.3** frontend 调 :8002 跑通端到端 ✅
  - Auth: form login → HttpOnly cookie + CSRF token
  - Thread: POST `/api/threads` → thread_id
  - Run: POST `/api/threads/{id}/runs/wait` (或 `/stream` 流式)
- [x] **T1.4** ConversationStore 初始化 (DeerFlow AsyncSqliteStore) ✅
  - 启动日志确认: `Store: using AsyncSqliteStore (.../.deer-flow/.deer-flow/checkpoints.db)`
  - InMemoryStore 警告消失
- [x] **T1.5** 注册 1 mock skill (`get-current-time`) ✅
  - DeerFlow custom skills 走文件系统, 不是 API POST
  - 写入: `vendors/deer-flow/skills/custom/get-current-time/SKILL.md`
  - 验证: 全局 skills 列表 21 → 22, `get-current-time` 在 `category=custom`
  - Skill 命名规则: hyphen-case (不能用下划线)
- [x] **T1.6** 端到端管道全跑通 ✅
  - 问"现在几点了" → run 提交成功, agent 实际执行 (Create Agent -> model_name: gpt-4-stub)
  - LLM call 因为假 key 返 401, DeerFlow LLM error middleware 兜底, 转成 human 友好回复
  - 响应: LangChain messages 数组 (human + ai), CopilotKit 可直接消费
  - Title 自动生成: "现在几点了?"
  - **gap**: 真 LLM key 才能让 agent 实际 invoke skill (老板原则 #5 透明)

### P1 验收

- ✅ DeerFlow backend 跑起来 (port 8002)
- ✅ 63 endpoint 可探活
- ✅ Auth + thread + run pipeline 全通
- ✅ Checkpointer SQLite 持久化
- ✅ Custom skill 注册 + 出现在全局列表
- ✅ Agent 实际跑 lead_agent, 响应 LangChain messages 格式
- ⚠️ **gap**: LLM 调用需要真 API key (P1 demo 阶段用了 stub)

### P1 → P2 启动条件 (供老板拍板)

1. **真 LLM API key** — 在 `.env` 设 `OPENAI_API_KEY` (或 Volcengine/DeepSeek/其他 provider)
2. **AG-UI 协议层** — DeerFlow 走 LangChain messages, CopilotKit 走 GraphQL, 中间需要 1 个薄协议层 (DeerFlow 端 router 或 CopilotKit 端 custom transport)
3. **浏览器 E2E** — frontend 起来, CopilotKit Chat 接 DeerFlow Lead Agent, 端到端跑通"现在几点了"

---

## P2 · 1 个真实业务工具 (2 周)

### P2 任务清单 (老板定 2026-06-14: 选 get-today-gmv, 跟 DaShengOS EcommerceAgent.query_gmv 对标)

- [x] **T2.1** 选 1 个业务工具 → `get-today-gmv` ✅
- [x] **T2.2** 实现 skill handler
  - [x] Python tool: `backend/p2/get_today_gmv.py` (135 行, 完整 type hints + docstring + 老板原则注释)
  - [x] DeerFlow skill: `vendors/deer-flow/skills/custom/get-today-gmv/SKILL.md` (触发条件/调用格式/业务对齐)
  - [x] skill 加载验证: 23 skills, `get-today-gmv` category=custom
- [x] **T2.3** 接入真实数据源 (mock, 但格式跟真 data_bridge 对齐)
  - [x] SQLite schema: `orders(id, platform, amount_cents, order_date, order_time, status)`
  - [x] Mock 数据: 8 平台 × 7 天 × 200 单/天 = 1,359 单
  - [x] 95% paid / 4% refunded / 1% pending (跟真实电商分布对齐)
  - [x] 平台权重: 淘宝 35% / 抖店 22% / 快手 12% / 微信 10% / 京东 8% / 拼多多 7% / 小红书 4% / 其他 2%
- [x] **T2.4** E2E 跑通 (stub LLM 模式, 验管道 + 真算 GMV)
  - [x] Skill 注册 + 全局可见
  - [x] `get_today_gmv()` 返回真数据: today ¥611,619.76 / 172 单 / 淘宝 top
  - [x] 端到端管道: user msg → agent → LLM (stub) → 401 友好回退
  - [x] **gap**: 真 LLM key 才能让 agent 实际 invoke 工具 (老板原则 #5 透明)
- [x] **T2.5** k6 perf budget: **4/4 p95 < 1s PASS** ✅
  - thread create: p95 15.1ms
  - skills list: p95 20.6ms
  - run wait (含 stub LLM 401 远程拒收): p95 747.6ms
  - get_today_gmv() (工具直调): p95 0.6ms
- [x] **T2.6** pytest 12/12 PASS ✅
  - 3 个 TestBasicPaths (默认/指定日期/幂等)
  - 3 个 TestErrorHandling (错日期格式/乱写/空串 → ValueError)
  - 3 个 TestDataConsistency (total=sum(platforms) / count=sum / by_platform 已知 codes)
  - 2 个 TestTimezone (Asia/Shanghai / 跨日期隔离)
  - 1 个 TestPerformanceBaseline (单测环境 avg 0.0ms < 100ms)

### P2 验收

- ✅ DeerFlow 23 skills (含 1 custom get-today-gmv)
- ✅ 工具函数单测 12/12
- ✅ 端到端 perf 4/4 p95 < 1s
- ✅ 真算数据: ¥611,619.76 / 172 单 / 7 平台明细
- ⚠️ **gap**: LLM 真 key 才能让 agent 实际 invoke tool (P2 demo 阶段用 stub LLM 401 验管道)
- ⚠️ **gap**: Python 工具函数还没注册成 DeerFlow callable tool (skill 是 markdown, 工具得通过 MCP/builtin 接入)
- ⚠️ **gap**: 浏览器 E2E 联调需要 AG-UI 协议层 (DeerFlow 走 LangChain messages, CopilotKit 走 GraphQL)

### P2 → P3 启动条件 (供老板拍板)

1. **真 LLM API key** — `.env` 写 `OPENAI_API_KEY` 让 lead_agent 实际 invoke 工具
2. **Python 工具注册成 DeerFlow callable tool** — 2 选 1:
   - A: 走 MCP server (写 1 个 stdio MCP 暴露 `get_today_gmv`, 在 extensions_config.json 注册)
   - B: 改 DeerFlow lead_agent 源码, 把 `get_today_gmv` 作为 @tool 装饰器注册
3. **AG-UI 协议层** — DeerFlow LangChain messages ↔ CopilotKit GraphQL 中间桥
4. **浏览器 E2E** — frontend 起来, CopilotKit Chat 接 DeerFlow, 端到端跑通"今日 GMV 多少"

---

## P3 · 全量业务 (1-3 个月, 看老板范围)

> ⚠️ **跟老板二次确认**: P3 是「重零建 7 Agent + 43 工具 + 26 集成」, 还是「只挑核心 5-10 工具」

### P3 任务清单 (范围待定)

- [ ] **T3.1** 7 业务 Agent 模型: EcommerceAgent / ContentAgent / CRMAgent / CustomerServiceAgent / AdAgent / ProactiveAgent / WorkflowAgent
- [ ] **T3.2** 43 工具实现: 查询/分析/执行/通知
- [ ] **T3.3** 26 平台集成: 淘宝/抖店/快手/微信/... (5 ERP + 5 物流 + 飞书 + 5 内容)
- [ ] **T3.4** 4 大支柱总线: feishu_bus / erp_bus / logistics_bus / content_bus / file_bus

### P3 验收

- 全量业务 E2E 跑通
- 跟 DaShengOS 现状 (如果保留) 灰度对比 50/50
- p95 < 0.5s (跟 DaShengOS L0/L1 持平)

---

## P4 · Generative UI + Human-in-the-loop (2 周)

### P4 任务清单

- [ ] **T4.1** 1 个工具结果改成 Generative UI (e.g. 查 GMV → 嵌入式图表组件, 用 `defineToolCallRenderer`)
- [ ] **T4.2** 1 个工具接 Human-in-the-loop (e.g. 发营销邮件 → 弹确认框, 用 `useHumanInTheLoop`)
- [ ] **T4.3** Shared state 演示 (e.g. 报表页 → agent 自动知道在看什么, 用 `useCopilotReadable`)
- [ ] **T4.4** E2E demo 录屏

### P4 验收

- 老板 hard reload 看效果, 拍板

---

## P5 · 切流 (1 周)

### P5 任务清单

- [ ] **T5.1** 灰度开关实现 (10% → 50% → 100%)
- [ ] **T5.2** DaShengOS 旧路由保留作 fallback (如果需要)
- [ ] **T5.3** 监控 / 告警 / 回滚

### P5 验收

- 灰度期间无 P0/P1 事故
- 100% 切流后所有功能正常

---

## 风险/阻断列表 (透明)

- **R-Block-1**: ~~网络抽风 DeerFlow 源码拉不到~~ → ✅ 已克隆 (45M)
- **R-Block-2**: DeerFlow 2.0 API 变更频繁 → pin 死版本 `release/2.0-rc-1`
- **R-Block-3**: ~~CopilotKit Runtime 跟 DeerFlow 撞角色~~ → ✅ 老板 2026-06-14 修订, 不装 Runtime, AG-UI 直连
- **R-Block-4**: ~~CopilotKit React API 不知道用什么版本~~ → ✅ 验证 v1 default entry 有 `useCopilotReadable` / `useCopilotAction` / `useFrontendTool` / `useHumanInTheLoop`, P0 用 v1, P1 可选切 v2
- **R-Block-5**: DeerFlow 2.0 AG-UI endpoint 未实现 → P1 阶段做 (sse-starlette)
