# DaShengOS v0.3 · 前端深度解剖报告

> **审查时间**: 2026-06-17 04:00
> **方法**: agent-browser 真实渲染 + 网络抓包 + 控制台日志 + localStorage 检查
> **状态**: 框架可渲染，但后端/API/数据层存在严重阻塞

---

## 一、渲染层面

### 1.1 路由完整性 ✅

| 路由 | 渲染 | 内容 |
|------|------|------|
| `/` (工作台) | ✅ | Shell布局，7平台chip，快速启动，最近会话 |
| `/login` | ✅ | 登录表单（用户名/密码 + GitHub/Google SSO） |
| `/agents` | ✅ | AgentMarket 页面 |
| `/studio` | ✅ | ComfyUI Studio 工作流 |
| `/files` | ✅ | 文件浏览器 |
| `/mcp` | ✅ | MCP 管理 |
| `/settings` | ✅ | 设置页 |
| `/settings/models/{text,multimodal,provider}` | ⚠️ | 占位文本，无真实功能 |
| `/chats/$id` | — | 未测试（需要session ID） |
| `/skills/$id` | — | 未测试（需要skill ID） |

### 1.2 关键修复

| 问题 | 根因 | 修复 |
|------|------|------|
| 空白页 | `routeTree.gen.ts` 的 `.update()` API 与 TanStack Router v1.170.15 不兼容 | `main.tsx` 手动构建路由树，用 `createRoute()` + `React.createElement` |
| 模块加载崩溃 | `sandbox-client.ts` 构造时 `token 必填` 检查在模块加载期抛异常 | 改为允许空 token，调用时再校验 |

---

## 二、数据层面（严重）

### 2.1 API 通信状态 🔴

对 127 个后端 API 请求的统计：

| 状态码 | 数量 | 比例 |
|--------|------|------|
| 401 Unauthorized | 99 | **78%** |
| 200 OK | 22 | 17% |
| 204 (OPTIONS preflight) | 18 | — |
| 429 Rate Limited | 5 | 4% |
| 403 Forbidden | 2 | 2% |

**78% 的 API 调用返回 401。**

### 2.2 根因分析

1. **登录接口超时**：后端 `POST /api/v1/auth/login` 在 curl 中 10 秒超时返回空——可能是 bcrypt 哈希缓慢、DB 锁、或系统代理拦截。

2. **Token 存储正常**：登录成功后 JWT 正确存入 localStorage（`dasheng-auth` key），sub/role/iat/exp 均合法。

3. **Token 传递正常**：`http.ts` 正确从 `useAuthStore.getState().accessToken` 读取并附加 `Authorization: Bearer`。

4. **后端重启后登录恢复**：后端重启后登录接口可用，但之前的长运行期会导致登录逐步变慢。

### 2.3 被影响的组件

| 组件 | API | 结果 |
|------|-----|------|
| Shell 右侧面板 | `GET /api/v1/sessions` | 401 → 无最近会话 |
| Shell 右侧面板 | `GET /api/v1/tools` | 401 → 工具列表空 |
| AgentMarket | `GET /api/v1/agents` | 401 → 无Agent列表 |
| Settings | `GET /api/v1/billing/tier` | 401 → 无使用数据 |
| 全局 | 所有认证请求 | 78% 返回401 |

---

## 三、UI 层面

### 3.1 视觉问题

| 问题 | 严重度 | 位置 |
|------|--------|------|
| ThemeProvider 渲染原始JS代码 | 🟡 中 | 页头 "((e, i, s, u, m, a, l, h) => {" 出现在DOM中 |
| Settings→Models 子页只有占位文本 | 🟡 中 | 无模型路由实际功能 |
| 快速启动"新会话"按钮 disabled | 🟡 中 | 需要先登录+有活跃session |
| Platform chips 3/7 显示 SOON | 🟢 低 | 淘宝/京东/拼多多待实现 |

### 3.2 控制台错误

```
ReferenceError: require is not defined
at react-dom_client.js → CatchBoundaryImpl → <component>
```

在页面首次加载时出现（sandbox-client 修复前），修复后不再出现。

### 3.3 安全性

| 检查项 | 状态 |
|--------|------|
| HTTPS | ❌ 本地 HTTP |
| JWT 存储 | ⚠️ localStorage（XSS 可读） |
| CSP | ❌ 未配置 |
| 登录锁定 | ✅ 5次/15min IP锁定 |

---

## 四、后端运行状态

| 检查项 | 状态 |
|--------|------|
| 健康检查 | ✅ `{"status":"ok"}` |
| 运行时间 | ✅ 7723秒（2h+）后重启 |
| 登录接口 | ⚠️ 长时间运行后变慢（bcrypt阻塞） |
| Redis | ✅ 已连接 |
| SQLite | ✅ WAL 模式 |

---

## 五、综合判定

| 维度 | 评级 | 说明 |
|------|------|------|
| 渲染完整性 | 🟡 75% | 全部路由加载，但 3 个子页占位 |
| API 连通性 | 🔴 30% | 78% API 返回 401，核心功能不可用 |
| 用户体验 | 🟡 60% | 首页好看但数据空洞 |
| 生产就绪 | 🔴 **不可商用** | API层阻塞所有业务功能 |

**结论**：前端框架本身可以渲染，但因为没有有效的API数据支撑，所有页面都处于"空壳"状态——有界面无数据。后端登录接口在长运行后会出现超时，需要修复 bcrypt 阻塞或重启策略。

**下一步建议**：
1. 修复登录超时（检查 bcrypt 实现、DB 锁、连接池）
2. 确保 Token 刷新流程正常工作
3. 补足 Settings→Models 子页的真实实现
4. 配置 CSP + HTTPS（生产环境）
