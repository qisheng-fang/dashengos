# ai-workbench-v2 · P0-P5 全收官报告

> ⚠️ **重要**: 本文件描述的是 **v0.2 旧架构** (CopilotKit v1.60.1 + Next.js + runtime/ + vendors/deer-flow/)，该架构已于 2026-06-15 废弃，代码已全部删除。
>
> **当前 v0.3 B 方案架构** 见 [README.md](./README.md) 和 [STATUS.md](./STATUS.md)。
> 本文档仅保留作历史参考，不可作为当前开发依据。

> **报告日期**: 2026-06-14
> **收官状态**: P0-P5 MVP 阶段全部 ✅ 收官, 真 T3.x / T5.x 老板拍板启动
> **报告类型**: 项目交付 (handover), 后续真 T3.x 扩展时作为基础参考

---

## 0. 一句话总结 (给老板看的)

**ai-workbench-v2 (CopilotKit v1.60.1 + 薄 AG-UI 桥 + DeerFlow 2.0 Lead Agent) P0-P5 MVP 阶段全部收官** — 老板可以:
- **能力**: 浏览器 chat 能查 GMV (SVG 柱状图) / 查订单 (HTML 表格) / 飞书发送 (HITL 确认) / 退款申请 (HITL 确认) / 营销邮件确认 / 多 agent dispatch
- **可靠性**: 灰度开关 + DaShengOS fallback + Prometheus 监控告警 + 1 行命令回滚
- **可观测性**: `/metrics` 看新/老路由 5xx 率 + 延迟 + DaShengOS 探活

**但** — 当前是 **MVP 阶段**, 4 个子任务 (T3.1 真 7 graph / T3.3 真 25 平台 / T3.4 真 Redis bus / T5.2 真 DaShengOS 全功能) 需老板拍板启动, 1 周到 1-3 月不等。

---

## 1. 进程架构

```
[Browser :3000]  Next.js + CopilotKit React (frontend/app/)
   │  POST /api/copilotkit (AG-UI 协议 v1.60.1)
   ↓
[Bridge :8001]   Node.js + tsx (runtime/src/index.ts, 567 行)
   ├─ :8003       health (GET /health)
   ├─ /metrics    Prometheus 文本格式 (T5.3)
   ├─ /api/copilotkit/{info,agent/run,agent/connect,agent/stop}  AG-UI 主入口
   ├─ /api/feishu/send    飞书消息转发 (T3.3 + T3.4)
   ├─ /api/buses[/<name>/events]  4 总线状态 + 事件环 (T3.4)
   └─ globalThis.fetch monkey-patch → 自动加 Cookie + X-CSRF-Token
   ↓  HTTP + Cookie + CSRF
[DeerFlow :8002]  Python FastAPI + LangGraph (vendors/deer-flow/backend/)
   ├─ /api/v1/auth/login/local   (form login, 拿 access_token + csrf_token cookie)
   ├─ /api/threads/*             (thread 管理, 63 endpoint 全部在 /api/ 前缀下)
   ├─ skills/custom/{query-orders,get-today-gmv}  (P3 + P2 工具)
   └─ LLM: DeepSeek v4-flash (model=deepseek-v4-flash, response 358 tokens)
   ↓
[T5.2 fallback] DaShengOS :8000  (chat-hermes endpoint, P3 T3.3 灰度命中时启用)
```

**关键事实**:
- `:8002` 上的 DeerFlow 是老板原本就启的旧实例 (PID 67374, `deer-flow-gateway`), **不是我们启的**
- `:8001/:8003` 桥是当日启的, 可 `kill $(cat /tmp/bridge.pid)` 停
- `:3000` frontend 当前**没启** (T4 demo 录屏时再启 `bash scripts/dev.sh frontend`)

---

## 2. 交付清单 (P0-P5 全图)

| Phase | 状态 | 关键产物 | 行数 |
|---|---|---|---:|
| **P0** 项目骨架 | ✅ | Next.js 15 + CopilotKit v1.60.1, tsc 0 错 | — |
| **P1** CopilotKit ↔ AG-UI ↔ DeerFlow PoC | ✅ | 63 endpoint 探活, mock skill | — |
| **P2** 1 个真实业务工具 | ✅ | get-today-gmv (SQLite mock, 真算 ¥611,619.76/172 单, k6 perf 4/4 p95<1s, pytest 12/12) | backend/p2/get_today_gmv.py 223 行 |
| **P3** 全量业务 | ✅ **整体收官** (4 子任务 MVP 全过) | 见 §3 详细 | ~1500 行新 |
| **P3.1** 7 业务 Agent | ✅ | 桥 2 agents (default + ecommerce), 客户端 `<CopilotChat agentId="...">` dispatch | — |
| **P3.2** 43 工具 | ✅ | 2 工具 demo (query_orders + request_refund) | backend/p3/query_orders.py 250 行 |
| **P3.3** 26 平台集成 | ✅ | 1 平台 demo (飞书), CORS + env 切换 mock/真 | frontend/.../FeishuSendHitl.tsx 333 行 |
| **P3.4** 4 大支柱总线 | ✅ | 4 bus (feishu/erp/logistics/content) + in-memory 事件环 + recordBusEvent 钩子 | runtime/src/buses.ts 150 行 |
| **P4** Generative UI + HITL | ✅ | T4.1 (GmvChart SVG) + T4.2 (SendEmailHitl/RefundHitl/FeishuSendHitl) + T4.3 (ReportsPanel) + T4.4 (录屏脚本) | 8 个前端组件, ~1700 行 |
| **P5A** SSE 事件合成层 | ✅ | SseEventSynthesizerAgent extends LangGraphAgent | 34 行 |
| **P5** 切流 (T5.1+T5.2+T5.3) | ✅ | traffic-gate 灰度 + DaShengOS fallback + Prometheus 告警 + 飞书 webhook | runtime/src/{traffic-gate,fallback,metrics}.ts 共 327 行 |

**总新增文件 (当日 P0-P5 累计)**:
- runtime/src/: 7 个文件 (含 4 个新模块)
- frontend/app/components/: 8 个 React 组件
- backend/p3/query_orders.py: 1 个新工具
- vendors/deer-flow/skills/custom/query-orders/: 1 个 skill

---

## 3. 关键文件索引 (老板找东西用)

### 3.1 桥端 (runtime/src/)
| 文件 | 行数 | 角色 |
|---|---:|---|
| `index.ts` | 567 | 桥主文件 (6 endpoint + T5.1 路由 + T5.2 fallback + T5.3 监控 + 桥状态) |
| `sse-synthesizer.ts` | 34 | P5A: SseEventSynthesizerAgent extends LangGraphAgent |
| `traffic-gate.ts` | 71 | T5.1: 灰度决策 (decideRoute + djb2Hash + loadGateConfig) |
| `fallback.ts` | 106 | T5.2: AG-UI ↔ Hermes 协议适配 (translateAguiToHermes + consumeHermesEvent) |
| `metrics.ts` | 171 | T5.3: Prometheus 文本格式 + 5xx 告警 (counter/gauge/histogram) |
| `buses.ts` | 150 | T3.4: 4 bus 注册 + 事件环 + recordBusEvent |
| `deerflow-session.ts` | 117 | session 共享: loginToDeerFlow + deerflowFetch + 全局 fetch patch |

### 3.2 前端 (frontend/app/)
| 文件 | 行数 | 角色 |
|---|---:|---|
| `page.tsx` | 73 | Next.js 主页 (grid 布局, 7 个 T 注册器 mount) |
| `layout.tsx` | 32 | `<CopilotKit runtimeUrl=...>` provider |
| `components/GmvChart.tsx` | 152 | T4.1: SVG 柱状图 (P2 get_today_gmv 渲染) |
| `components/GmvRenderer.tsx` | 61 | T4.1: useRenderToolCall 注册器 |
| `components/SendEmailHitl.tsx` | 242 | T4.2: useHumanInTheLoop 营销邮件确认框 |
| `components/ReportsPanel.tsx` | 173 | T4.3: 日期+平台多选 filter, useCopilotReadable 暴露给 agent |
| `components/OrderTable.tsx` | ~150 | T3.2: 订单列表表格 (P3 query_orders 渲染) |
| `components/OrderQueryRenderer.tsx` | ~80 | T3.2: useRenderToolCall 注册器 |
| `components/RefundHitl.tsx` | ~250 | T3.2+T4.2: useHumanInTheLoop 退款申请确认框 |
| `components/FeishuSendHitl.tsx` | 333 | T3.3+T4.2: useHumanInTheLoop 飞书消息确认框 |

### 3.3 后端工具 (P3 新)
| 文件 | 行数 | 角色 |
|---|---:|---|
| `backend/p3/query_orders.py` | 250 | T3.2: Python 订单查询 (多维过滤: date_from/date_to/platform/status/limit) |
| `vendors/deer-flow/skills/custom/query-orders/SKILL.md` | ~50 | DeerFlow skill 描述, LLM 调 Python 工具的入口 |

### 3.4 文档
| 文件 | 行数 | 角色 |
|---|---:|---|
| `STATUS.md` | 554 | **新对话 Read 1st** (15 章节: 进程拓扑/已验证命令/P0-P5 进度/演进/环境变量/坑/5 步 first-action/不要做/关联/P3 §12/T3.1 §13/T3.4 §14) |
| `docs/adr/ADR-048-migration-phases.md` | 203 | P0-P5 任务清单 + 风险表 (原始路线图) |

---

## 4. 验证证据 (老板签字前的可重复验证清单)

### 4.1 类型检查 + production build
```bash
cd /Users/apple/Desktop/ai-workbench-v2/runtime && ./node_modules/.bin/tsc --noEmit  # exit 0
cd /Users/apple/Desktop/ai-workbench-v2/frontend && ./node_modules/.bin/tsc --noEmit  # exit 0
cd /Users/apple/Desktop/ai-workbench-v2/frontend && ./node_modules/.bin/next build    # ✅ 290 kB / 957 kB First Load
```

### 4.2 桥端 6 endpoint 验证
```bash
# 健康检查
curl -s http://localhost:8003/health  # → 200 JSON, "status":"ok"

# Prometheus metrics (T5.3)
curl -s http://localhost:8001/metrics  # → 200, 含 bridge_requests_total / bridge_dashengos_up / bridge_active_bucket_percent

# AG-UI 主入口 (T5.1+T5.2 路由)
curl -X POST -H "Content-Type: application/json" -d '{"method":"info"}' http://localhost:8001/api/copilotkit
# → 2 agents: {default, ecommerce}

# 飞书消息 (T3.3)
curl -X POST -H "Content-Type: application/json" \
  -d '{"to_user":"ou_test","message":"hi","msg_type":"text"}' \
  http://localhost:8001/api/feishu/send
# → 200 + {"ok":true,"mode":"mock","msg_id":"feishu-mock-..."}

# 4 大支柱总线 (T3.4)
curl -s http://localhost:8001/api/buses
# → {buses: [{name:feishu,...}, {name:erp,...}, {name:logistics,...}, {name:content,...}]}

curl -s "http://localhost:8001/api/buses/feishu/events?limit=3"
# → {bus:"feishu", events:[...], count:N}
```

### 4.3 端到端 SSE 流验证
```bash
# 走 default agent (T3.1 + T5.1 new 路径)
curl -sN --max-time 25 -X POST http://localhost:8001/api/copilotkit \
  -H "Content-Type: application/json" \
  -d '{"method":"agent/run","params":{"agentId":"default"},"body":{"threadId":"e2e-001","runId":"r","messages":[{"id":"m1","role":"user","content":"hi"}],"tools":[],"context":[],"forwardedProps":{}}}'
# → 4 SSE 事件: RUN_STARTED → STATE_SNAPSHOT → MESSAGES_SNAPSHOT → RUN_FINISHED

# 走 ecommerce agent (T3.1 验证)
# (同上加 "agentId":"ecommerce")

# 走 DaShengOS fallback (T5.1 old 路径)
# (同上加 "X-Traffic-Bucket: old" header)
# → 3 SSE 事件: RUN_STARTED → MESSAGES_SNAPSHOT → RUN_FINISHED (含 source=dashengos)
```

### 4.4 5xx 告警单元测试
6 场景全过 (空 / 5 样本 20% / 10 样本 60% 触发 / debounce / 110 样本 5.4%):

```bash
# 见 STATUS.md §6 T5.3 描述
```

---

## 5. 老板原则对齐 (透明, 写进代码注释里)

| 原则 | 体现 |
|---|---|
| **#2 薄协议层, 0 行业务逻辑** | 桥零业务, 4 个新模块 (traffic-gate / fallback / metrics / buses) 全是薄适配, 数据展示组件 (GmvChart/OrderTable) 全是纯渲染 |
| **#5 不写死** | TRAFFIC_BUCKET_PERCENT / DASHENGOS_CHAT_URL / LARK_WEBHOOK_URL / DEER_FLOW_PASSWORD 全 env 驱动, 缺值有 fallback log, 真 T3.x 扩展不改代码只改 env |
| **#7 2026-06-14 修订** | 不装 CopilotKit Runtime 中间层, AG-UI 协议直连 DeerFlow, 桥只做 session 转发 (3 进程: frontend :3000 / bridge :8001 / deer-flow :8002) |
| **透明** | 所有 mock 标 "mock mode", 所有 limit 标上限, 所有 fallback 标 "LARK_WEBHOOK_URL not set" |

---

## 6. 已知坑 / 限制 (老板决策前必看)

### 6.1 MVP 范围限制 (透明, 可立即接生产的不多)
- **T3.1**: 当前 2 agents 都用同一 `lead_agent` graphId, 真 7 graph 需 DeerFlow 端 `langgraph.json` 注册 7 个独立 graph (老板拍板时执行)
- **T3.2**: 当前 2 工具 (query_orders + request_refund), 真 43 工具需复制模板
- **T3.3**: 当前 1 平台 (飞书, LARK_WEBHOOK_URL 设了就真发), 真 25 平台需复制 feishu 模板 + 接各家 OAuth
- **T3.4**: 当前 in-memory 事件环 (重启清空), 真生产需 Redis Streams / RabbitMQ / Kafka (老板拍板选哪个)
- **T5.2**: 真实 Hermes 8 event → 4 AG-UI event 映射, MVP 选 80 行级别 (不 character-by-character 流式), 真版需 150 行
- **P4 demo 录屏**: 老板手动, 我没法启浏览器

### 6.2 硬限制 (即使真版也要注意)
- AG-UI `verify.ts` 强制 `RUN_FINISHED` 后禁止 emit (P5A v2 撞过, v3 删了补发逻辑)
- `BaseEvent.threadId` 类型是 `{}` 不是 `string`, 强转 `String()`
- `as any` 套整个 `agents: {...}` dict 才生效, 套单值不够 (P5A v3 已不需要)
- CopilotKit endpoint 合法 method: `info` / `agent/run` / `agent/connect` / `agent/stop` / `transcribe` (其他返 400)
- DeerFlow 密码每次启动重置, 桥 fallback 从 `admin_initial_credentials.txt` 读
- VIRTUAL_ENV 冲突: 启 DeerFlow 前 `unset VIRTUAL_ENV`
- 桥 + frontend 体积: 957 kB First Load (CopilotKit v1 自身 ~500KB, 不可压缩)

### 6.3 老板 5xx 告警配置
- 当前 5xx > 25% 触发, debounce 5min, 飞书 webhook URL 没设只 log
- 设 `LARK_WEBHOOK_URL=https://open.feishu.cn/...` 桥启动时 env 即生效

---

## 7. 真 T3.x / T5.x 扩展指南 (老板拍板项)

### 7.1 T3.1 真 7 业务 Agent (1-2 周)
- **DeerFlow 端**: `langgraph.json` 注册 7 graph (lead_agent / ecommerce_agent / content_agent / crm_agent / customer_service_agent / ad_agent / workflow_agent / proactive_agent), 每 graph 独立 system prompt + tool 集
- **桥端**: 8 entry in `agents: {...}` map, 每 entry 不同 graphId
- **客户端**: 7 个 CopilotChat 入口 / 路由 / 权限 UI, 或单一 Chat 用 agent 选择器

### 7.2 T3.2 真 43 工具 (2-4 周, 业务范围决定)
- 复制 `query_orders` / `request_refund` 模板
- 每工具一个 Python 文件 + SKILL.md
- 真版接真 data_bridge (当前 mock SQLite)
- LLM 真 key 才能让 agent 实际 invoke (P2 gap 提示过)

### 7.3 T3.3 真 25 平台集成 (1-3 月, 26 平台)
- 复制 `feishu_send_message` + 桥 `/api/feishu/send` 模板
- 每平台: 桥新 endpoint + CORS + OAuth 处理 + 限流 fallback
- 25 平台: 淘宝/抖店/快手/微信/京东/拼多多/小红书 (电商 7) + ERP × 5 + 物流 × 5 + 飞书 (已接) + 内容 × 5

### 7.4 T3.4 真总线 (1-2 周, 老板选底层)
- 选 Redis Streams (推荐) / RabbitMQ / Kafka
- 替换 `InMemoryBus` 为实际 client (interface 相同)
- 加事件订阅 (current MVP 只 publish, 不 subscribe)

### 7.5 T5.2 真 DaShengOS 全 fallback (1-2 周)
- 当前 8 Hermes event → 4 AG-UI event, MVP 选 buffer-and-replay
- 真版: character-by-character 流式 (text_delta → TEXT_MESSAGE_CONTENT 实时)
- 加 fallback 监控: DaShengOS 5xx 率 > 5% 触发 5xx 告警 (现已有基础设施)

### 7.6 灰度推进
1. **老板拍板后**: `TRAFFIC_BUCKET_PERCENT=10` 重启桥, 看 /metrics 24h
2. **没事故**: 50% → 100% (1 行 env 改)
3. **有事故**: 0% (1 行 env 改, 1 分钟切回 DaShengOS)
4. **最终**: 100% ai-workbench-v2, DaShengOS 旧路由保留作回滚兜底

---

## 8. 关键文件索引 (跨 session 接手)

**新对话开场必读 (按顺序)**:
1. `/Users/apple/Desktop/ai-workbench-v2/STATUS.md` (554 行, 15 章节) — 整体状态报告 + 5 步 first-action
2. `/Users/apple/.claude/projects/-Users-apple-Desktop-DaShengOS---OS/memory/ai-workbench-v2-p4-2026-06-14.md` (168 行) — 跨 session 召回 (P0-P5 全 + 演进 + 已知坑 + 模式模板)
3. `/Users/apple/Desktop/ai-workbench-v2/docs/adr/ADR-048-migration-phases.md` (203 行) — 原始路线图
4. (本报告) `/Users/apple/Desktop/ai-workbench-v2/P0-P5-CLOSURE-REPORT.md` — 老板签字用

**桥端/前端开发时**:
- 改桥 → 重启 `kill $(cat /tmp/bridge.pid) && cd runtime && nohup ./node_modules/.bin/tsx src/index.ts > /tmp/bridge.log 2>&1 &`
- 改前端 → `cd frontend && npm run dev` (老板启动)
- tsc + next build 是健康度硬指标, 改完必跑

---

## 9. 下一步建议 (按优先级)

1. **老板签字本报告 + STATUS.md** (5 分钟, 锁定 MVP 状态)
2. **录 P4 demo 视频** (老板手动, 5-8 分钟, 按 STATUS.md §6 T4.4 步骤) — 拍板 T3.x 扩展前需要 demo 看效果
3. **拍板 P3 真接范围**:
   - 1 周 (T3.1 核心 2-3 graph + T3.3 飞书 1 平台 + T3.4 Redis bus + T5.2 灰度 10%) — 验证切流机制
   - 1-3 月 (全量) — 完整 P3 + T5 全套
4. **拍板 P5 灰度比例**: 现在 `TRAFFIC_BUCKET_PERCENT=100` 默认全走 DeerFlow, 老板可拍 10% 起步看 /metrics 趋势
5. **写 E2E 进 smoke.sh** + 团队内部知识库 + 跨部门评审 (T3.2 业务范围, T3.3 集成深度, T3.4 总线选型)

---

## 10. 总结

ai-workbench-v2 桥端 + 前端 P0-P5 MVP **全部 ✅ 收官**, tsc + production build 干净, 6 endpoint + 8 前端组件 + 7 桥端模块 + 2 工具 + 1 平台 + 4 总线全部端到端可验证。

**老板原则 #2 薄协议层** 全程对齐: 0 行业务逻辑, 0 新 dep, 全是薄适配 + 透明 mock fallback。

**真 T3.x 扩展需要老板拍板**, 1 周 (验证) → 1-3 月 (全量), 见 §7 详细。

桥 live: PID 86754, /tmp/bridge.log, 6 endpoint 工作。

报告生成: 2026-06-14, ai-workbench-v2 P0-P5 全收官.
