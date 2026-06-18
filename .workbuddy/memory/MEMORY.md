# DaShengOS 项目记忆

> 项目级长期事实和架构约定。每日工作日志在 YYYY-MM-DD.md。

---

## 项目身份

- **名称**: DaShengOS（大师 OS）
- **定位**: AI 工作台 — 全自动化媒体内容生产 + 品牌营销 + 全域电商
- **品牌**: 爱尤趣（情趣娃娃）

## 技术栈

- **后端**: Fastify 5 + TypeScript + SQLite (better-sqlite3) + Redis (可选)
- **前端**: React 18 + Vite + TanStack Router + Zustand + shadcn/ui + framer-motion
- **LLM**: SiliconFlow (默认) + DeepSeek + Ollama (本地)
- **Monorepo**: pnpm workspace (packages/backend + apps/web)

## 关键端口

- 后端 8000 / 前端 3000 / 8 worker 9101-9112 + 9200-9201

## Agent Runtime (2026-06-18)

### P1: Tool Registry (`core/tools/registry.ts` ~720行)
- 16 个内置工具 (read_file/write_file/edit_file/list_files/search_content/run_command/check_process/check_port/read_logs/db_query/web_fetch/web_search/restart_service/install_pkg/git_op/execute_skill)
- OpenAI function_call 格式, 安全沙箱(路径白名单/命令黑名单/超时)
- executeToolsParallel() 并行执行

### P2: Agent Loop (`core/agent/loop.ts` ~419行)
- 状态机: THINKING → TOOL_CALL → RESPOND → ERROR
- selfHealMode: 连续错误 ≥2 自动触发 diagnostics
- elevatedMode: 跳过确认门
- 最大 25 轮循环, 30s/step 超时

### P3: Self-Heal (`core/self-heal/`)
- diagnostics.ts: 9 个错误模式库 + 健康检查(processes/ports/disk/build)
- gate.ts: ConfirmationGate 写操作确认门(低风险自动批准/高风险挂起)
- API: 7 个端点 (diagnose/quick/pending/approve/reject/config)

### P4: Skill Executor (`core/skills/executor.ts` ~302行)
- 指令桥接: 读取 ~/.workbuddy/skills/*/SKILL.md → 解析步骤 → 给 Agent 执行
- 140 个 WorkBuddy 技能可用
- execute_skill 工具注册到 Tool Registry
- API: GET /available + /available/:name/instructions + POST /available/:name/execute

### P5: Chat Handler 接入 (`api/chat.ts`)
- POST /api/v1/chat/agent 端点
- 返回 status: completed/error/awaiting_confirmation
- POST /api/v1/chat/stream 端点 — **SSE token 级流式输出** (2026-06-18)

## SSE 流式响应架构 (2026-06-18)

### 后端流式引擎 (`providers/streaming.ts` ~250行)
- `openAIStream()` — OpenAI API stream:true → AsyncGenerator<StreamChunk>
- 6 事件: status(动态状态)/token(逐字)/usage(消耗)/tool_call(工具调用)/done(完成)/error(错误)
- STATUS_MAP: WorkBuddy 风格动态文案 ("等待模型响应"/"领导潜台词解码中" 等)
- 非流式 provider 回退: 分块模拟流式效果

### Provider 流式支持
- SiliconFlow + DeepSeek: 新增 `chatStreamImpl()` (AsyncGenerator)
- base.ts: `chatStream?` 可选字段加入 ProviderProfile

### 前端 ChatCopilot v3.0
- `fetch()` + ReadableStream 替代 http.post() (SSE 解析)
- StreamState: statusText/content/tokensUsed/streaming/toolCall/done/error
- 底部状态栏: 动态文字 + ◇ 消耗计数器(Zap图标) + 停止按钮
- 工具调用指示器: CircleDot + 工具名 + 参数
- 光标闪烁动画 + 默认状态轮转(每3秒)

## 前端确认门 UI (`components/ConfirmationGate.tsx`)
- 3 秒轮询 /heal/pending → Radix Dialog 弹窗
- 4 色风险等级 Badge + 参数 JSON 展示
- 集成到 CommandCenter 全局浮层

## Provider 架构 (`providers/`)
- base.ts: ChatRequest/ChatResponse 接口 (支持 tools/tool_calls)
- 插件化: siliconflow/deepseek/ollama 各自 provider.ts
- providers/index.ts: getActiveProvider() 动态选择

## 认证

- JWT: sub 字段存 userId (不是 id)
- 4 平台 OAuth: 微信公众号/飞书/视频号/Shopify (api/oauth.ts)

## Marketplace

- 92+ 个 WorkBuddy 技能映射到 DaShengOS MarketplaceEntry
- 12 个分类: 办公协作/开发工具/社媒运营/视觉设计/数据分析/自动化/内容创作/营销推广/系统集成/商业策略/部署运维/通用工具

## 前端架构

- **路由**: TanStack Router (code-based in main.tsx)
  - `/` → Shell + **CommandCenter** (ChatCopilot SSE + DefaultDashboard)
  - `/chats/$id` → Shell + **Chat** (Agent REST /api/v1/chat)
- **Vite proxy**: `/api` → `http://127.0.0.1:8000`（前端 baseUrl 空串走代理，避开 http_proxy）
- **状态管理**: Zustand + persist
  - `dasheng-auth`: auth-store (accessToken 在 state.accessToken 里)
  - `dasheng-command-center-v2`: AppStore (多会话 conversations[] + activeConversationId)
- **⚠️ ChatCopilot 守卫**: handleSend 必须检查 activeConversationId, null 时调 newConversation()！否则 addChatMessage 静默丢消息
- **Shell(侧栏280px) + CommandCenter(LUI 35% + GUI 65%)**
- ChatCopilot: SSE streaming /api/v1/chat/stream, token 从 useAuthStore 取
- ConfirmationGate: 全局浮层, 轮询确认门
- framer-motion 面板切换动画

## Vite Proxy 架构 (2026-06-18)

- **为什么**: 老板机器有 http_proxy 环境变量 (`http://127.0.0.1:53840`)，浏览器 fetch 直接请求 `http://127.0.0.1:8000` 可能被代理拦截导致 POST 请求挂死
- **方案**: Vite dev server 配置 proxy，前端 fetch 使用相对路径 `/api/v1/...`
- **配置**: `vite.config.ts` → `proxy: { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } }`
- **API base URL**: 所有前端组件的 `VITE_API_URL || ''` — 空串 = 走 Vite proxy
- **生产环境**: 设置 `VITE_API_URL=http://实际域名` (不走 Vite proxy)
- **影响文件**: api.ts, agent-client.ts, ChatCopilot.tsx, documents.tsx, OAuthManager.tsx
- **curl 测试**: 必须用 `--noproxy '*'` 绕过系统代理验证本地 API

## 认证 Token 取法

- **auth-store**: Zustand persist, localStorage key = `dasheng-auth` (JSON)
- **前端取 token**: `useAuthStore.getState().accessToken` (不是 `localStorage.getItem('access_token')`)
