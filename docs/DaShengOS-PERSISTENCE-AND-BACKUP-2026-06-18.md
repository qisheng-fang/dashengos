# DaShengOS 持久固态化操作备份文档

> 版本: v0.3 | 日期: 2026-06-18 | 作者: 小爪 (Claw)
> 目的: 确保所有已实现的增强功能在重启/部署后自动恢复，不留运行时状态到内存中

---

## 一、架构全景

### 1.1 系统组件关系图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DaShengOS AI 工作台                          │
├──────────────────────┬──────────────────────────────────────────────┤
│   前端 (apps/web)     │   后端 (packages/backend)                    │
│   React 18 + Vite    │   Fastify 5 + TypeScript                     │
│   :3000 (Vite dev)   │   :8000 (Fastify)                            │
│                      │                                              │
│   ┌────────────────┐ │   ┌──────────────────────────────────────┐  │
│   │  Shell (280px) │ │   │  Harness 框架 (core/harness/)       │  │
│   │  侧边栏导航    │ │   │  ├─ system-prompt.ts (328行)        │  │
│   └────────────────┘ │   │  ├─ memory.ts (655行)                │  │
│   ┌────────────────┐ │   │  ├─ planner.ts (223行)               │  │
│   │ CommandCenter  │ │   │  ├─ reflector.ts (236行)             │  │
│   │ LUI 35%│GUI 65%│ │   │  ├─ skill-discovery.ts (814行)      │  │
│   │ ChatCopilot    │ │   │  └─ index.ts (171行)                 │  │
│   │ (SSE 流式)     │ │   │                                      │  │
│   └────────────────┘ │   │  Agent Runtime (core/agent/)          │  │
│   ┌────────────────┐ │   │  ├─ loop.ts (~419行)                 │  │
│   │ Chat.tsx       │ │   │  └─ 状态机: THINK→TOOL→RESPOND      │  │
│   │ Agent模式切换   │ │   │                                      │  │
│   └────────────────┘ │   │  Tool Registry (core/tools/)          │  │
│   ┌────────────────┐ │   │  └─ registry.ts (~720行) 16个工具    │  │
│   │ BrowserAuto    │ │   │                                      │  │
│   │ Playwright控制  │ │   │  Self-Heal (core/self-heal/)         │  │
│   └────────────────┘ │   │  ├─ diagnostics.ts (9模式+健康检查)  │  │
│   ┌────────────────┐ │   │  └─ gate.ts (写操作确认门)           │  │
│   │ SkillsMarket   │ │   │                                      │  │
│   │ 92个技能       │ │   │  Skill Executor (core/skills/)        │  │
│   └────────────────┘ │   │  └─ executor.ts (指令桥接 140技能)   │  │
│                      │   │                                      │  │
│                      │   │  Providers (providers/)                │  │
│                      │   │  ├─ siliconflow (默认, Qwen2.5-72B)  │  │
│                      │   │  ├─ deepseek                          │  │
│                      │   │  └─ ollama (本地)                     │  │
│                      │   └──────────────────────────────────────┘  │
│                      │   ┌──────────────────────────────────────┐  │
│                      │   │  SQLite (data/dasheng.db)            │  │
│                      │   │  30 张表 (启动时自动建表)            │  │
│                      │   └──────────────────────────────────────┘  │
└──────────────────────┴──────────────────────────────────────────────┘
```

### 1.2 数据流

```
用户消息 → ChatCopilot/Chat.tsx
           │
           ├─ SSE 模式: POST /api/v1/chat/stream
           │   → enhanceStreamMode() → buildSuperSystemPrompt({mode:'stream'})
           │   → provider.chatStream() → SSE token 级推送
           │
           └─ Agent 模式: POST /api/v1/chat/agent
               → prepareAgentMode() → buildSuperSystemPrompt({mode:'agent'})
               → generatePlan() → runAgentLoop() → verifyStepResult()
               → analyzeConversationEnd() → 自动技能发现
```

---

## 二、持久化清单 — 按层级

### 2.1 数据库层 (SQLite — 启动时自动建表)

**数据库位置**: `packages/backend/data/dasheng.db`
**初始化函数**: `initSchema()` in `packages/backend/src/storage/db.ts`
**调用时机**: `buildServer()` → 第 75 行 `initSchema()`

| # | 表名 | 建表方式 | 用途 |
|---|------|---------|------|
| 1 | users | initSchema() | 用户表 |
| 2 | agents | initSchema() | Agent 定义 |
| 3 | sessions | initSchema() | 会话表 |
| 4 | messages | initSchema() | 消息表 |
| 5 | skills | initSchema() | 技能定义 |
| 6 | agent_skills | initSchema() | Agent-Skill 多对多 |
| 7 | mcp_servers | initSchema() | MCP 服务端 |
| 8 | mcp_tools | initSchema() | MCP 工具 |
| 9 | tool_permissions | initSchema() | 工具权限 |
| 10 | file_objects | initSchema() | 文件对象 |
| 11 | audit_logs | initSchema() | 审计日志 |
| 12 | secrets | initSchema() | 加密密钥 |
| 13 | settings | initSchema() | 全局设置 |
| 14 | sso_sessions | initSchema() | SSO 会话 |
| 15 | sso_links | initSchema() | SSO 身份映射 |
| 16 | api_keys | initSchema() | API Key |
| 17 | marketplace_installs | initSchema() | 市场安装记录 |
| 18 | skill_installs | initSchema() | Skill 安装追踪 |
| 19 | billing_usage | initSchema() | 计费用量 |
| 20 | billing_tier | initSchema() | 计费层级 |
| 21 | refresh_tokens | initSchema() | JWT Refresh Token |
| 22 | user_settings | initSchema() | 用户设置 |
| 23 | login_attempts | initSchema() | 登录尝试 |
| 24 | social_cookies | initSchema() | 社媒 Cookie |
| 25 | automations | initSchema() | 定时任务 |
| 26 | memory_summaries | initSchema() | 长期记忆摘要 |
| 27 | agent_learnings | initSchema() | 自我改进学习 |
| **28** | **context** | **initSchema() ★** | **上下文管理(会话内决策/结论)** |
| **29** | **cross_session_memory** | **initSchema() ★** | **跨对话记忆(持久化关键信息)** |
| **30** | **skill_patterns** | **initSchema() ★** | **技能模式(重复工具序列)** |

> ★ 标记 = 2026-06-18 新增，已从惰性建表提升到启动时即时建表

**回滚保障**: 所有 `CREATE TABLE IF NOT EXISTS`，重复执行不会报错，幂等性保证。

### 2.2 文件系统层

| 路径 | 用途 | 持久化方式 |
|------|------|-----------|
| `~/.workbuddy/skills/*/SKILL.md` | 140 个 WorkBuddy 技能 + 自动发现技能 | 文件系统 (磁盘) |
| `~/.workbuddy/memory/MEMORY.md` | 跨项目用户偏好 | 文件系统 |
| `{workspace}/.workbuddy/memory/MEMORY.md` | 项目级长期记忆 | 文件系统 |
| `{workspace}/.workbuddy/memory/YYYY-MM-DD.md` | 项目级每日工作日志 | 文件系统 |
| `packages/backend/.env` | 环境变量配置 | 文件系统 |
| `packages/backend/data/dasheng.db` | 主数据库 | 文件系统 |
| `packages/backend/data/dasheng.db-wal` | WAL 日志 | 文件系统 (自动) |
| `packages/backend/data/dasheng.db-shm` | 共享内存 | 文件系统 (自动) |
| `/tmp/dasheng-docs/` | 生成的文档临时目录 | 文件系统 (临时) |

### 2.3 配置层

| 配置项 | 文件 | 当前值 | 说明 |
|--------|------|--------|------|
| LLM_PROVIDER | `.env` | `siliconflow` | ⚠️ 不要改回 agnes_ai (降智) |
| SILICONFLOW_API_KEY | `.env` | `sk-gycmi...hskn` | 已填 |
| SILICONFLOW_DEFAULT_MODEL | `.env` | `Qwen/Qwen2.5-72B-Instruct` | 推理型模型 |
| DASHENG_JWT_SECRET | `.env` | 64字符 hex | 认证密钥 |
| DASHENG_JWT_ACCESS_TTL_SEC | `.env` | 900 (15分钟) | Access Token TTL |
| DASHENG_JWT_REFRESH_TTL_SEC | `.env` | 604800 (7天) | Refresh Token TTL |
| DATABASE_URL | `.env` | `file:...dasheng.db` | SQLite 路径 |
| RATE_LIMIT_PER_MINUTE | `.env` | 60 | 限流 |

### 2.4 前端状态持久化

| localStorage Key | 内容 | 对应 Zustand Store |
|-------------------|------|--------------------|
| `dasheng-auth` | `{ accessToken, user, isAuthenticated }` | `useAuthStore` |
| `dasheng-command-center-v2` | `{ conversations[], activeConversationId }` | `useAppStore` |
| `dasheng-ui` | `{ rightPanelOpen, sidebarCollapsed }` | `useUIStore` |

---

## 三、启动时自动初始化流程

```
server.ts:main()
  │
  ├─ buildServer()
  │   │
  │   ├─ initSchema()            ← 30 张表自动建表 (幂等)
  │   │   ├─ users, sessions, messages ...
  │   │   ├─ context             ← 新增: 会话上下文
  │   │   ├─ cross_session_memory← 新增: 跨对话记忆
  │   │   └─ skill_patterns      ← 新增: 技能模式
  │   │
  │   ├─ 注册 30+ 路由组 (prefix: /api/v1)
  │   │   ├─ /auth, /sessions, /agents, /skills ...
  │   │   ├─ /chat (含 /stream, /agent, /skills/*)  ← 新增: 3个技能发现 API
  │   │   └─ /self-heal (7个端点)
  │   │
  │   ├─ setupGateway()          ← JWT 认证网关
  │   ├─ initConfirmationGate()  ← 写操作确认门
  │   └─ 加载 Provider 插件 (siliconflow/deepseek/ollama)
  │
  ├─ app.listen(:8000)
  └─ loadAutomations()           ← 定时任务加载
```

**关键保证**: 所有 Harness 能力在 `initSchema()` 之后立即可用，无需额外手动操作。

---

## 四、Harness 框架 — 完整功能清单

### 4.1 System Prompt (`system-prompt.ts`, 328行)

| 功能 | 注入方式 | 持久化 |
|------|---------|--------|
| 品牌知识 (爱尤趣) | `BRAND_KNOWLEDGE` 常量 | 源码内嵌 |
| 角色定位 (全能AI超级助手) | `buildSuperSystemPrompt()` | 源码内嵌 |
| 6大核心能力 | system prompt 文本 | 源码内嵌 |
| 8条强制规则 | system prompt 文本 | 源码内嵌 |
| Skill Creation Protocol | system prompt 文本 | 源码内嵌 |
| Self-Heal 指令 | system prompt 文本 | 源码内嵌 |
| 动态任务模式增强 | `taskType` 参数 | 运行时 |
| 跨对话记忆注入 | `memory.crossSessionMemory` | **数据库** ★ |
| Wiki 知识库注入 | `wikiPages` 参数 | 数据库+文件 |
| 用户信息注入 | `user` 参数 | 数据库 |

### 4.2 Memory (`memory.ts`, 655行)

| 功能 | 函数 | 持久化 |
|------|------|--------|
| 会话上下文 | `saveContextEntry()` / `loadContextWindow()` | **context 表** ★ |
| 跨对话记忆 | `loadCrossSessionMemory()` | **cross_session_memory 表** ★ |
| 跨对话搜索 | `searchCrossSessionMemory()` | **cross_session_memory 表** ★ |
| 跨对话保存 | `saveCrossSessionMemory()` | **cross_session_memory 表** ★ |
| 自动提取保存 | `extractAndSaveCrossSessionMemory()` | **cross_session_memory 表** ★ |
| Wiki 页面 | `loadWikiPages()` | 数据库 wiki 表 → .workbuddy/memory/MEMORY.md |
| 品牌知识 | `BRAND_FACTS` 常量 | 源码内嵌 |

### 4.3 Planner (`planner.ts`, 223行)

| 功能 | 函数 | 持久化 |
|------|------|--------|
| 复杂度评估 | `assessComplexity()` | 运行时 |
| LLM 辅助规划 | `generatePlan()` | 运行时 (每次) |
| 静态回退 | fallback 规划 | 源码内嵌 |

### 4.4 Reflector (`reflector.ts`, 236行)

| 功能 | 函数 | 持久化 |
|------|------|--------|
| 幻觉检测 | `verifyResult()` | 运行时 |
| 反思日志 | `createReflectionLog()` | 运行时 |
| 重试策略 | `buildReflectionPrompt()` | 运行时 |
| 错误模式库 | `HALLUCINATION_PATTERNS` | 源码内嵌 |

### 4.5 Skill Discovery (`skill-discovery.ts`, 814行)

| 功能 | 函数 | 持久化 |
|------|------|--------|
| 模式检测 | `detectPatterns()` | **skill_patterns 表** ★ |
| 已有匹配 | `matchExistingSkill()` | **~/.workbuddy/skills/** ★ |
| 自动生成 SKILL.md | `generateSkillFromPattern/Context()` | **~/.workbuddy/skills/NAME/SKILL.md** ★ |
| 工作流编排 | `buildWorkflowFromPattern()` | 运行时 |
| 批量发现 | `discoverAndGenerateSkills()` | **skill_patterns + skills 目录** ★ |
| 对话结束检测 | `analyzeConversationEnd()` | **cross_session_memory** ★ |
| 列出已发现 | `listDiscoveredSkills()` | **~/.workbuddy/skills/** ★ |

### 4.6 编排器 (`index.ts`, 171行)

| 功能 | 函数 | 调用者 |
|------|------|--------|
| Stream 增强 | `enhanceStreamMode()` | `/chat/stream` |
| Agent 完整编排 | `prepareAgentMode()` | `/chat/agent` |
| 步骤验证 | `verifyStepResult()` | Agent Loop |
| 工具推荐 | `recommendToolSequence()` | Agent Loop |
| 任务类型检测 | `detectTaskType()` | 内部 |

---

## 五、关键 API 端点清单

### 5.1 Chat 相关 ( Harness 注入)

| 方法 | 路径 | 功能 | Harness 模式 |
|------|------|------|-------------|
| POST | `/api/v1/chat/stream` | SSE token 级流式 | enhanceStreamMode() |
| POST | `/api/v1/chat/agent` | Agent Loop 自主执行 | prepareAgentMode() + analyzeConversationEnd() |
| POST | `/api/v1/chat` | REST 直接对话 | enhanceStreamMode() |

### 5.2 Skill Discovery API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/chat/skills/discovered` | 列出所有已发现的 skill |
| POST | `/api/v1/chat/skills/discover` | 手动触发批量模式发现 |
| POST | `/api/v1/chat/skills/generate` | 手动从上下文生成 skill |

### 5.3 Self-Heal API

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/v1/health/diagnose` | 全量诊断 |
| GET | `/api/v1/health/quick` | 快速健康检查 |
| GET | `/api/v1/heal/pending` | 获取待确认操作 |
| POST | `/api/v1/heal/approve` | 批准操作 |
| POST | `/api/v1/heal/reject` | 拒绝操作 |
| GET | `/api/v1/heal/config` | 获取确认门配置 |
| POST | `/api/v1/heal/config` | 更新确认门配置 |

### 5.4 Skill Executor API

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/v1/skills/available` | 140 个技能列表 |
| GET | `/api/v1/skills/available/:name/instructions` | 获取技能指令 |
| POST | `/api/v1/skills/available/:name/execute` | 执行技能 |

---

## 六、运行时依赖 — 启动检查清单

### 6.1 后端启动

```bash
# 1. 确认环境
cd /Users/apple/Desktop/ai-workbench-v2/packages/backend

# 2. 检查 .env
cat .env | grep -E "^(LLM_PROVIDER|DATABASE_URL|DASHENG_JWT_SECRET)"

# 期望输出:
# LLM_PROVIDER=siliconflow              ← 不能是 agnes_ai!
# DATABASE_URL=file:.../dasheng.db
# DASHENG_JWT_SECRET=daaaa...a9

# 3. 编译
npx tsc --noEmit  # 应该零错误

# 4. 启动 (开发模式)
npx tsx src/server.ts

# 5. 验证
curl --noproxy '*' http://127.0.0.1:8000/health
curl --noproxy '*' -X POST http://127.0.0.1:8000/api/v1/chat/stream \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"你好"}'
```

### 6.2 前端启动

```bash
cd /Users/apple/Desktop/ai-workbench-v2/apps/web

# Vite 开发服务器 (含 /api 代理)
npx vite --port 3000 --strictPort
```

### 6.3 依赖服务

| 服务 | 端口 | 启动方式 |
|------|------|---------|
| Redis | 6379 | `redis-server` (可选, 不启动时 Redis 功能降级) |
| Python Workers | 9101-9112 + 9200-9201 | `source .venv/bin/activate && python3 -m agent.daemon` |
| DeerFlow | Unix Socket `/tmp/dasheng/deerflow.sock` | `python3 -m deerflow.daemon` (可选) |

---

## 七、故障恢复方案

### 7.1 数据库损坏

```bash
# 1. 停止后端
kill $(lsof -t -i:8000)

# 2. 备份当前 DB
cp packages/backend/data/dasheng.db packages/backend/data/dasheng.db.bak.$(date +%Y%m%d%H%M)

# 3. 尝试恢复
sqlite3 packages/backend/data/dasheng.db ".recover" | sqlite3 packages/backend/data/dasheng_recovered.db

# 4. 替换
mv packages/backend/data/dasheng_recovered.db packages/backend/data/dasheng.db

# 5. 重启后端 — initSchema() 会自动补建缺失的表
npx tsx src/server.ts
```

### 7.2 跨对话记忆丢失

跨对话记忆存储在 `cross_session_memory` 表中。如果丢失：
1. 重启后端 → `initSchema()` 重建空表
2. 新对话会重新积累记忆
3. 项目级记忆在 `.workbuddy/memory/MEMORY.md` 中仍有副本

### 7.3 自动发现的技能丢失

技能文件在 `~/.workbuddy/skills/*/SKILL.md`。如果丢失：
1. 140 个 WorkBuddy 内置技能需重新安装
2. 自动发现的技能 (auto_discovered: true) 可通过 `POST /api/v1/chat/skills/discover` 重新生成

### 7.4 LLM 降智

**症状**: AI 回复质量明显下降，回答简短无深度

**排查清单**:
1. `cat .env | grep LLM_PROVIDER` — 必须是 `siliconflow`，不能是 `agnes_ai`
2. `cat .env | grep SILICONFLOW_DEFAULT_MODEL` — 应该是 `Qwen/Qwen2.5-72B-Instruct`
3. 检查 API Key 是否过期: `curl https://api.siliconflow.cn/v1/models -H "Authorization: Bearer $KEY"`
4. 检查 rate limit: `cat .env | grep RATE_LIMIT`

### 7.5 前端对话无法使用

**排查清单**:
1. Vite dev server 是否运行: `lsof -i:3000`
2. 后端是否运行: `curl --noproxy '*' http://127.0.0.1:8000/health`
3. Vite proxy 是否配置: `cat apps/web/vite.config.ts | grep proxy`
4. Token 是否有效: `useAuthStore.getState().accessToken` 在浏览器 console 执行
5. 强制刷新: `Cmd+Shift+R`

---

## 八、升级/迁移保障

### 8.1 数据库 Schema 变更规则

1. **只加不改删**: 新增表/列用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ADD COLUMN`
2. **ALTER 容错**: `try { ALTER TABLE } catch { /* 已存在 */ }`
3. **幂等 initSchema()**: 每次 `buildServer()` 都执行，重复执行安全
4. **惰性建表双保险**: `memory.ts` 和 `skill-discovery.ts` 仍保留 `ensureXxxTable()`，即使 initSchema 没跑也不崩

### 8.2 新版本部署步骤

```bash
# 1. 拉取代码
git pull origin main

# 2. 安装依赖
pnpm install

# 3. 编译检查
cd packages/backend && npx tsc --noEmit
cd ../.. && cd apps/web && npx tsc --noEmit

# 4. 重启后端 (initSchema 自动迁移)
kill $(lsof -t -i:8000) && cd packages/backend && npx tsx src/server.ts &

# 5. 重启前端
cd apps/web && npx vite --port 3000 --strictPort &

# 6. 验证
curl --noproxy '*' http://127.0.0.1:8000/health
```

---

## 九、备份策略建议

### 9.1 每日自动备份 (推荐)

```bash
# 添加到 crontab: 每天凌晨 3 点
0 3 * * * cp /Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db /Users/apple/Dropbox/backup/dasheng-$(date +\%Y\%m\%d).db
```

### 9.2 关键文件备份清单

| 优先级 | 文件 | 备份频率 |
|--------|------|---------|
| P0 | `packages/backend/data/dasheng.db` | 每日 |
| P0 | `packages/backend/.env` | 每次修改后 |
| P1 | `~/.workbuddy/skills/` | 每周 |
| P1 | `.workbuddy/memory/MEMORY.md` | 每周 |
| P2 | `packages/backend/src/core/harness/` | git 已管理 |
| P2 | `apps/web/src/` | git 已管理 |

### 9.3 数据库导出 (人工)

```bash
# 导出完整 SQL dump
sqlite3 packages/backend/data/dasheng.db .dump > /tmp/dasheng-full-backup.sql

# 只导出记忆相关表
sqlite3 packages/backend/data/dasheng.db ".dump cross_session_memory context skill_patterns" > /tmp/dasheng-memory-backup.sql

# 恢复
cat /tmp/dasheng-full-backup.sql | sqlite3 packages/backend/data/dasheng_new.db
```

---

## 十、性能固化保障

### 10.1 启动自检项

| 检查项 | 期望值 | 失败后果 |
|--------|--------|---------|
| `initSchema()` 执行 | 30 张表创建成功 | 基础功能不可用 |
| LLM_PROVIDER | `siliconflow` | AI 降智 (agnes_ai=flash模型) |
| SILICONFLOW_API_KEY | 非空 | AI 无法回复 |
| JWT Secret | 非 `dev-only-` 前缀 | 生产不安全 |
| Provider 加载 | ≥1 个 provider | AI 无法回复 |

### 10.2 运行时监测

| 监测项 | 频率 | 方式 |
|--------|------|------|
| 后端存活 | 每 10s | `curl /health` |
| AI 回复质量 | 每次对话 | Reflector 幻觉检测 |
| 跨对话记忆积累 | 每次对话结束 | `analyzeConversationEnd()` |
| 技能发现 | 每次对话结束 | `analyzeConversationEnd()` |
| 磁盘空间 | 每小时 | `df -h` |

---

## 附录 A: Harness 模块源码位置

```
packages/backend/src/core/harness/
├── index.ts              # 编排器 (171行)
├── system-prompt.ts      # 超级 System Prompt (328行)
├── memory.ts             # 记忆注入 (655行)
├── planner.ts            # 规划分解 (223行)
├── reflector.ts          # 反思验证 (236行)
└── skill-discovery.ts    # 技能发现引擎 (814行)
```

## 附录 B: 关键接口调用链

### SSE 流式对话
```
ChatCopilot.tsx:fetch('/api/v1/chat/stream')
  → chat.ts:/stream handler
    → enhanceStreamMode(userId, user)
      → loadLightMemory(userId) → loadCrossSessionMemory()
      → buildSuperSystemPrompt({memory, mode:'stream'})
        → 注入跨对话记忆 (decisions/preferences/insights/patterns/facts)
        → 注入品牌知识 + Wiki + 用户信息
    → provider.chatStream(messages) → SSE 逐字输出
```

### Agent 自主执行
```
Chat.tsx → backendChat() → POST /api/v1/chat/agent
  → chat.ts:/agent handler
    → prepareAgentMode(message, history, userId, user)
      → loadMemoryContext(userId) → 会话记忆+跨对话记忆+Wiki
      → buildSuperSystemPrompt({memory, mode:'agent'})
      → generatePlan(message, history) → 任务分解
    → runAgentLoop(message, history, {systemPrompt})
      → THINK → TOOL_CALL(parallel) → RESPOND → 验证 → 迭代
    → analyzeConversationEnd({toolCalls})
      → 保存 tool_sequence 到 cross_session_memory
      → 匹配已有 skill / 自动生成新 skill
```

## 附录 C: 配置红线 (不要改)

| 配置项 | 当前值 | 为什么不能改 |
|--------|--------|-------------|
| LLM_PROVIDER | `siliconflow` | agnes-2.0-flash 是轻量模型，无推理能力 |
| 前端 baseUrl | `''` (空串) | 走 Vite proxy，避开 http_proxy 环境变量 |
| Vite proxy target | `http://127.0.0.1:8000` | 代理转发到后端 |
| Auth store key | `dasheng-auth` | Zustand persist key，改了令牌丢失 |
| App store key | `dasheng-command-center-v2` | 多会话状态，改了对话列表丢失 |
| confirmGate elevatedMode | `false` | 生产环境必须人工确认高风险操作 |

---

> **文档维护**: 每次架构变更后更新此文档。最后更新: 2026-06-18
