# DaShengOS 端到端功能完整性检查报告

> 检查日期: 2026-06-18
> 检查范围: 前端路由 / 后端 API / Shell 导航 / 功能入口重复与冗余
> 版本: v0.3-p2

---

## 一、前端路由全景 (24 个有效路由)

| 路由 | 页面组件 | 侧边栏入口 | 后端 API 对应 | 完整性 |
|------|---------|-----------|--------------|--------|
| `/` | CommandCenter (ChatCopilot + Dashboard) | 工作台 | `/api/v1/chat/stream`, `/api/v1/dashboard` | 完整 |
| `/agents` | AgentMarket | Agent | `/api/v1/agents` | 完整 |
| `/chats/$id` | Chat (REST + social agent) | 无 | `/api/v1/chat`, `/api/v1/social` | 完整 |
| `/studio` | Studio (ComfyUI 编辑器) | Studio | 无 (纯前端) | 完整 |
| `/files` | FileBrowser (沙箱文件) | 文件 | `/api/v1/files` (stub) | 部分 |
| `/mcp` | McpManager | MCP | `/api/v1/mcp/servers` | 完整 |
| `/settings` | Settings (Layout + 套餐用量) | 设置(齿轮) | `/api/v1/settings`, `/api/v1/billing/*` | 完整 |
| `/settings/models/text` | TextModelsPage | Settings 子菜单 | `/api/v1/settings/models/text` | 完整 |
| `/settings/models/multimodal` | MultimodalModelsPage | Settings 子菜单 | 无 (静态页面) | 部分 |
| `/settings/models/provider` | ProviderPage | Settings 子菜单 | `/api/v1/settings/provider/:id/test` | 完整 |
| `/settings/oauth` | OAuthManager | Settings 子菜单 | `/api/v1/oauth/*`, `/api/v1/dashboard` | 完整 |
| `/settings/social-cookies` | SocialCookiesPage | Settings 子菜单 | `/api/v1/social/cookies` | 完整 |
| `/settings/automations` | AutomationPage | Settings 子菜单 | `/api/v1/automations` | 完整 |
| `/settings/memory` | MemoryPage | Settings 子菜单 | `/api/v1/memory` | 完整 |
| `/settings/learnings` | LearningsPage | Settings 子菜单 | `/api/v1/learnings` | 完整 |
| `/skills` | SkillsMarket | Skills | `/api/v1/skills/marketplace` | 完整 |
| `/skills/$id` | SkillDetail | 无 (从 SkillsMarket 进入) | `/api/v1/skills/:id` | 完整 |
| `/documents` | Documents | 文档 | `/api/v1/documents/*` | 完整 |
| `/visualizations` | VisualizationsPage | 可视化 | `/api/v1/visualizations/*` | 完整 |
| `/workflows` | Workflows (模板执行) | 工作流 | `/api/v1/orchestrator/*` | 完整 |
| `/diagnostics` | DiagnosticsPage | 无 (Settings 子菜单外链) | `/api/doctor` | 完整 |
| `/login` | Login | 无 | `/api/v1/auth/*` | 完整 |
| `/error/$code` | ErrorPage | 无 | 无 | 完整 |
| `/sso/callback` | SsoCallback | 无 | `/api/v1/auth/sso/*` | 完整 |

---

## 二、后端 API 全景 (30+ 端点组)

### 有前端对应页面的 API (已接通)
- `/api/v1/auth/*` — 登录/注册/SSO/OAuth
- `/api/v1/sessions/*` — 会话管理
- `/api/v1/agents/*` — Agent 列表/创建
- `/api/v1/skills/*` — Skill 市场/安装
- `/api/v1/mcp/*` — MCP 服务器管理
- `/api/v1/settings/*` — 用户设置/模型路由/provider 凭证
- `/api/v1/social/*` — 社媒 cookie/发布
- `/api/v1/automations/*` — 定时任务 CRUD
- `/api/v1/memory/*` — 三层记忆系统
- `/api/v1/learnings/*` — 自我改进学习记录
- `/api/v1/documents/*` — 文档生成 PPTX/DOCX/PDF/XLSX
- `/api/v1/visualizations/*` — 图表/SVG 配置验证
- `/api/v1/orchestrator/*` — 多 Agent 工作流编排
- `/api/v1/chat/*` — 聊天/Agent Runtime/SSE 流式
- `/api/v1/dashboard` — 聚合状态元数据
- `/api/doctor` — 系统诊断
- `/api/status` — SidebarStatusStrip 数据

### 无前端对应页面的 API (孤儿端点)
| 端点 | 说明 | 风险 |
|------|------|------|
| `/api/v1/browser/*` | Playwright 浏览器自动化 | 高 — 功能已完成但前端无入口 |
| `/api/v1/audit/*` | 审计日志 (admin only) | 中 — 仅 admin 需要，可延后 |
| `/api/v1/secrets/*` | Secret 管理 (admin only) | 中 — 仅 admin 需要，可延后 |
| `/api/v1/workspace/*` | 工作空间文件 | 高 — 全是 stub 返回空，无实际功能 |
| `/api/v1/files/*` | 文件上传/下载/搜索 | 高 — upload/download/search 都是 501/404 stub |
| `/api/v1/models/:id/chat` | 模型直接对话 | 中 — 前端走 /chat/stream，此端点冗余 |
| `/api/v1/models/:id/embed` | Embedding | 低 — 暂未使用场景 |
| `/api/v1/chat/agent` | Agent Runtime (tool_call 循环) | 高 — 后端完整但前端只调 /chat/stream |
| `/api/v1/chat/health` | DeerFlow 健康检查 | 低 — 内部用 |
| `/api/v1/tools/permissions` | 工具权限查询 | 低 — 内部用 |
| `/api/v1/self-heal/*` | 自我诊断修复 | 中 — ConfirmationGate 调用部分端点 |

---

## 三、功能入口重复 / 冗余问题 (10 项)

### P0 — 严重重复 (需立即处理)

#### 1. 双聊天入口 — CommandCenter vs Chat 页面
- **问题**: `/` (CommandCenter) 和 `/chats/$id` (Chat) 都是聊天功能
  - CommandCenter.ChatCopilot: SSE 流式输出 (`/api/v1/chat/stream`)
  - Chat: REST 非流式 (`/api/v1/chat/`) + social agent 切换
- **影响**: 用户困惑"该在哪里聊天"，代码维护两份聊天逻辑
- **建议**: 统一到一个聊天入口。推荐保留 CommandCenter 的 SSE 流式作为主入口，将 Chat 页面的 social agent 能力合并进去；或让 `/chats/$id` 跳转回 `/` 并带上 session id。

#### 2. Chat 页面 Agent 切换器双重渲染
- **问题**: Chat.tsx 中同时存在两套 agent 切换 UI:
  1. 自定义 `agentOptions` 数组渲染的 4 个 tab 按钮 (default + 3 社媒)
  2. `AgentTabBar` 组件 (号称支持 10 agent)
- **影响**: 头部两排 tab 同时显示，高度占用且功能重叠
- **建议**: 移除自定义的 `agentOptions` 按钮组，统一使用 `AgentTabBar`；或反过来移除 `AgentTabBar` 只保留自定义按钮。

#### 3. Studio vs Workflows — "工作流"概念混淆
- **问题**: 
  - `/studio` — ComfyUI 式**可视化工作流编辑器** (拖拽节点)
  - `/workflows` — **工作流模板执行器** (选模板 → 输入 → 执行)
- **影响**: 侧边栏同时有 "Studio" 和 "工作流"，用户不清楚区别
- **建议**: 重命名区分概念。如 Studio → "画布编排"，Workflows → "工作流市场"；或合并为一个入口，Studio 做编辑、Workflows 做执行，用子 tab 切换。

### P1 — 中度冗余 (建议本迭代处理)

#### 4. `/diagnostics` 导航体验不一致
- **问题**: Settings 子菜单中"系统诊断"标记为 `external: true`，用 `<a href>` 跳转，但 `/diagnostics` 是内部路由
- **影响**: 页面会完全刷新而不是客户端路由切换
- **建议**: 改为 `<Link to="/diagnostics">`，移除 `external: true`

#### 5. 文件入口重复 — FileBrowser vs RightPanel.FilesTab
- **问题**: 
  - `/files` — 沙箱文件浏览器 (操作文件)
  - Shell RightPanel FilesTab — 显示当前 session 关联的文件列表
- **影响**: 两个地方都显示"文件"，但数据来源和用途不同
- **建议**: 在 FileBrowser 页面增加说明"沙箱文件"，RightPanel 改为"Session 文件"，消除歧义。

#### 6. `/api/v1/workspace/*` 全 stub 无意义
- **问题**: workspaceRoutes 两个端点都返回空数组 `{ root: '/', entries: [] }`
- **影响**: 占用了路由命名空间，前端无对应页面
- **建议**: 要么实现真正的 workspace 文件树功能，要么移除这些 stub 端点。

#### 7. `/api/v1/files/*` 全 stub
- **问题**: upload=501, get=404, download=404, search 返回空数组
- **影响**: FileBrowser 前端页面存在但后端无实际能力
- **建议**: 实现真正的文件上传/下载/存储，或暂时隐藏 FileBrowser 侧边栏入口。

#### 8. `/api/v1/browser/*` 无前端入口
- **问题**: Playwright 浏览器自动化 API 完整，但前端没有 Browser 页面
- **影响**: 功能开发完成但用户无法使用
- **建议**: 新增 "浏览器" 页面，或将其能力集成到 Studio/Workflows 中作为节点。

### P2 — 轻度问题 (可延后)

#### 9. Settings 子菜单中 `/diagnostics` 不是子路由
- **问题**: `/diagnostics` 是独立路由，不在 `/settings/*` 层级下，但在 Settings 子菜单中展示
- **建议**: 保持现状亦可，或将其移到侧边栏独立入口。

#### 10. `/api/v1/models/:id/chat` 与 `/api/v1/chat/stream` 功能重叠
- **问题**: models.ts 里的 chat 端点支持 Ollama/SiliconFlow/DeepSeek，但前端不走这里
- **建议**: 评估是否废弃 `/models/:id/chat`，统一走 `/chat/stream` + provider 插件化。

---

## 四、缺失的功能入口 (前端无页面)

| 功能 | 后端 API | 优先级 | 建议 |
|------|---------|--------|------|
| 浏览器自动化 | `/api/v1/browser/*` | P1 | 新增 Browser 页面或集成到 Studio |
| 审计日志 (admin) | `/api/v1/audit/*` | P2 | 新增 Admin 面板子页面 |
| Secret 管理 (admin) | `/api/v1/secrets/*` | P2 | 新增 Admin 面板子页面 |
| Agent Runtime (tool_call) | `/api/v1/chat/agent` | P1 | 前端 ChatCopilot 增加模式切换 |

---

## 五、路由树 vs 文件路由不一致

- `routeTree.gen.ts` (TanStack 文件路由生成) 中**没有** `/skills` 列表路由，但有 `/skills/$id`
- `main.tsx` 中手动补了 `/skills` → SkillsMarket
- `routeTree.gen.ts` 中**没有** `/settings/oauth`, `/settings/social-cookies` 等子路由
- 这些子路由是在 `main.tsx` 中手动创建的，未使用 `createFileRoute`
- **风险**: 混合使用文件路由和手动路由，维护时容易遗漏
- **建议**: 统一路由创建方式，或将所有手动路由改为文件路由 (`_workspace.skills.tsx`, `_workspace.settings.oauth.tsx` 等)

---

## 六、总结与建议优先级

### 立即处理 (本周)
1. 统一聊天入口 — 合并 CommandCenter 和 Chat 的聊天能力
2. 移除 Chat 页面双重 Agent 切换器
3. Studio/Workflows 概念重命名或合并

### 本迭代处理
4. 实现 `/api/v1/files/*` 真正功能 或 隐藏 FileBrowser 入口
5. 新增 Browser 自动化前端页面
6. 修复 `/diagnostics` 导航用 `<Link>` 而非 `<a>`
7. 移除或实现 `/api/v1/workspace/*` stub

### 后续迭代
8. Admin 面板 (审计日志 + Secret 管理)
9. 统一路由创建方式 (全文件路由化)
10. 评估废弃 `/api/v1/models/:id/chat`

---

*报告生成完毕。共检查 24 个前端路由、30+ 后端端点组，发现 10 项重复/冗余问题，3 项缺失入口。*
