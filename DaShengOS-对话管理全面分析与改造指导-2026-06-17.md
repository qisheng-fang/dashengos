# DaShengOS v0.3 · 对话管理（ConvMgmt）全面分析与改造指导

> **作者**：WorkBuddy (Deepseek-V4-Pro)
> **日期**：2026-06-17 22:56
> **问题**：老板反馈"工作台不像 WorkBuddy / Hermes，每个对话框没有记录，也不会自动归类"
> **结论先行**：DaShengOS v0.3 当前**没有真正的对话管理体系**——数据层、API 层、UI 层三层都不通。

---

## 一、核心数据（来自 SQLite 真实查询）

```
sessions 表：5 条（全部 title="新会话"，全部 status=ACTIVE）
messages 表：0 条    ← 关键证据：用户所有对话都没存进库
dasheng.db  大小：2.3 MB
```

> 老板你在 WorkBuddy / Hermes 上看到的"会话列表 + 自动归类"功能，**DaShengOS 一个都没实现**。

---

## 二、现状解剖（三层断裂）

### 1️⃣ 数据层（`db.ts`）

`sessions` 表有这些列：
```
id, user_id, agent_id, title, model, status,
token_count, parent_session_id, created_at, updated_at
```

**缺这些关键字段**：
- ❌ `category`（行业 / 业务大类）
- ❌ `tags`（用户自定义标签，JSON 数组）
- ❌ `industry` / `brand`（爱尤趣 / 情趣娃娃行业）
- ❌ `task_type`（writing / analysis / research / chat / coding）
- ❌ `is_favorite`（收藏）
- ❌ `is_archived`（独立的归档 boolean）
- ❌ `summary`（会话摘要，用于列表预览）
- ❌ `message_count`（消息计数，避免每次 COUNT）
- ❌ `last_message_at`（快速排序）
- ❌ `cost_usd`（成本追踪）

> 注：`parent_session_id` 已经有（支持分支），这是好的；但**没有 FTS5 全文索引**，没有触发器。

### 2️⃣ API 层（三套互不通信的实现）

| 路由文件 | 状态 | 问题 |
|---|---|---|
| `chat.ts` (442 行) | **完全无状态** | 0 处 `INSERT INTO`，对话全部走完即丢 |
| `sessions.ts` (367 行) | 6 个端点完整 | 没人调它，DB 里只躺着 5 个空壳 |
| `messages.ts` / FTS 路由 | **不存在** | — |

**最讽刺的事实**：
- 老板在 Workspace.tsx 聊天 → 走 `chat.ts` → 0 落库
- 老板点"新会话" → 调 `POST /sessions` → 创建空壳 → 跳进 chat.ts → 0 落库
- `messages` 表 0 条记录，是这个 bug 的直接证据

### 3️⃣ UI 层（`Shell.tsx` + `Chat.tsx` + `Workspace.tsx`）

| 组件 | 行为 | 问题 |
|---|---|---|
| Shell 侧栏"新会话"按钮 | `POST /sessions` 然后跳 `/chats/$id` | 跳进去后对话走 chat.ts 不入库 |
| Shell 侧栏"最近会话" | `recentSessions.slice(0, 8).map()` | 8 条平铺，无搜索无分组无归类 |
| Workspace.tsx | localStorage `dasheng_workspace_msgs` | 单聊全局共用，换设备就丢 |
| Chat.tsx | localStorage `dasheng_chat_history_${id}` | 文件第 3 行注释自承"后端无 messages 路由" |

**结论**：UI 层是"假象式"的多会话——视觉上像有列表，但数据全是空壳 + localStorage。

### 4️⃣ 归类（dispatcher 分类 → 零持久化）

`deerflow/agents/dispatcher.py` 用 LLM 给任务分类到 7 类（simple / web_search / content / data / social / code / complex）：

```python
# dispatcher.py 内部 (未公开)
task_type = classification["task_type"]  # 7 选 1
```

但**分类结果只写进内存事件流**（`t["events"]`），**不入库**。grep 整个 `deerflow/` 目录 `INSERT INTO` 匹配 0 次。

**对比 Hermes**：Hermes 的 `task_type` 字段在 `agent_learnings` 表（v0.3 已有），但那只是"学习记录"，**不是会话归类**。

---

## 三、与 WorkBuddy / Hermes 的差距

| 能力 | WorkBuddy | Hermes | DaShengOS v0.3 | 紧迫度 |
|---|---|---|---|---|
| 会话列表 + 时间分组 | ✅ | ✅ | ⚠️ 8 条平铺 | P0 |
| 全文搜索 | ❌ | ✅ FTS5 + trigram | ❌ | P1 |
| 自动生成标题 | ⚠️ auto-rename | ❌ | ❌ 全是"新会话" | P0 |
| 标签 / 收藏 | ⚠️ custom_title | ❌ | ❌ | P1 |
| **多分支对话** | ❌ | ✅ parent_session_id | ⚠️ 字段在但无 UI | P2 |
| 行业 / 品牌自动归类 | ❌ | ❌ | ❌ | **P0**（老板刚需） |
| 工具调用轨迹 | ✅ | ✅ | ❌ | P2 |
| Token / 成本追踪 | ✅ session_usage | ✅ 8 字段 | ❌ | P1 |
| 跨设备同步 | ❌ | ❌ | ❌（localStorage 为主）| P1 |

**P0（老板立刻能用上）**：
1. 会话标题自动生成（解决"5 条全叫新会话"问题）
2. 行业/品牌自动归类（情趣娃娃 / 爱尤趣 / 市场分析 / 内容创作 ...）
3. 真正的 messages 落库（解决"换设备就丢"问题）

**P1（一个月内）**：FTS5 搜索、标签、收藏、成本追踪

**P2（季度级）**：多分支对话、跨平台同步

---

## 四、详细改造指导（Roadmap）

### Phase 1：数据层 + API 补齐（**1 周**，P0）

#### 1.1 数据库 Schema 升级
```sql
-- migrations/2026-06-17-convmgmt.sql
ALTER TABLE sessions ADD COLUMN category TEXT;          -- 'content' | 'analysis' | 'research' | 'chat' | 'code'
ALTER TABLE sessions ADD COLUMN tags TEXT;              -- JSON: ["爱尤趣", "Q3市场", "PPT"]
ALTER TABLE sessions ADD COLUMN industry TEXT;          -- '情趣娃娃' | '美妆' | ...
ALTER TABLE sessions ADD COLUMN brand TEXT;             -- '爱尤趣' | '其他'
ALTER TABLE sessions ADD COLUMN is_favorite INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN is_archived INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN summary TEXT;           -- 一句话摘要
ALTER TABLE sessions ADD COLUMN message_count INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_message_at INTEGER;

-- 新表：FTS5 全文搜索
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, role UNINDEXED, session_id UNINDEXED, message_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- 触发器：自动同步
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (rowid, content, role, session_id, message_id)
  VALUES (new.rowid, new.content, new.role, new.session_id, new.id);
  UPDATE sessions SET message_count = message_count + 1, last_message_at = new.created_at
    WHERE id = new.session_id;
END;
```

#### 1.2 API 升级

**新增端点**：
```typescript
// 1) 真正落库的 chat 端点
POST /api/v1/chat                   // 当前：不落库 → 改成：INSERT user + assistant
GET  /api/v1/sessions               // 当前：全表 → 改成：?category=  ?brand=  ?favorite=true  ?archived=false
GET  /api/v1/sessions/search?q=xx   // 全文搜索（FTS5 + snippet 高亮）
PATCH /api/v1/sessions/:id          // 更新 title / category / tags / is_favorite
POST /api/v1/sessions/:id/star
POST /api/v1/sessions/:id/archive
POST /api/v1/sessions/:id/branch    // 多分支：从某条 message 拉新分支
GET  /api/v1/sessions/:id/messages  // 替代 localStorage
GET  /api/v1/sessions/categories    // 行业 / 品牌 聚合统计
```

**改 chat.ts 核心逻辑**：
```typescript
// 当前 chat.ts:179 纯生成 threadId
const threadId = clientThreadId ?? `th_${Date.now().toString(36)}`

// 改成：自动归档 + 落库
app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
  // 1. 创建/复用 session
  const session = await getOrCreateSession(threadId, userId)
  
  // 2. 落库 user 消息
  await db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)')
    .run(newId(), session.id, 'user', message)
  
  // 3. 调 LLM
  const report = await directLLM(message, history)
  
  // 4. 落库 assistant 消息
  await db.prepare('INSERT INTO messages (id, session_id, role, content, model, token_out) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), session.id, 'assistant', report, model, tokens)
  
  // 5. 自动归类（异步）
  scheduleAutoClassify(session.id, message, report)  // ← 关键
  
  // 6. 自动生成标题
  scheduleAutoTitle(session.id, message)             // ← 关键
  
  return reply.send({ threadId: session.id, status: 'completed', report })
})
```

#### 1.3 自动归类（**核心亮点**）

```typescript
// packages/backend/src/core/conversation-classifier.ts
export async function classifySession(message: string, report: string): Promise<{
  category: string
  industry: string | null
  brand: string | null
  tags: string[]
}> {
  const apiKey = process.env.SILICONFLOW_API_KEY
  
  const prompt = `分析以下对话，输出 JSON（不要 markdown）：

用户消息: ${message.slice(0, 200)}
AI 回答: ${report.slice(0, 300)}

输出 schema:
{
  "category": "<content|analysis|research|chat|code|design|ops>",
  "industry": "<行业名，没有则 null>",
  "brand": "<品牌名，没有则 null>",
  "tags": ["<tag1>", "<tag2>", ...]
}`
  
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'Qwen/Qwen2.5-7B-Instruct',  // 轻量模型，省钱
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      response_format: { type: 'json_object' }
    })
  })
  
  const json = JSON.parse((await resp.json()).choices[0].message.content)
  return json
}
```

**触发时机**：在 `INSERT assistant 消息` 后异步调用，不阻塞主流程。

**成本**：Qwen 2.5 7B 每千 token ¥0.00035，一次分类约 0.001 元。1000 次对话 ¥1。

#### 1.4 自动标题生成

```typescript
export async function autoTitle(message: string, report: string): Promise<string> {
  const prompt = `用 8-15 个中文字概括以下对话的标题：\n\n用户: ${message.slice(0, 100)}\nAI: ${report.slice(0, 200)}\n\n只输出标题，不要标点符号。`
  
  const resp = await callLLM(prompt, { max_tokens: 50 })
  return resp.trim().slice(0, 30) || '新会话'
}
```

**触发时机**：第一条 user 消息入库后异步调。

---

### Phase 2：UI 重做（**2 周**，P0）

#### 2.1 会话列表组件

```typescript
// apps/web/src/components/sidebar/ConversationList.tsx
export function ConversationList() {
  const [filter, setFilter] = useState<{ category?: string; brand?: string; favorite?: boolean }>({})
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Session[]>([])
  
  useEffect(() => {
    const params = new URLSearchParams()
    if (filter.category) params.set('category', filter.category)
    if (filter.brand) params.set('brand', filter.brand)
    if (filter.favorite) params.set('favorite', 'true')
    if (search) params.set('q', search)
    http.get(`/api/v1/sessions?${params}`).then(setConversations)
  }, [filter, search])
  
  // 按行业 / 品牌 / 时间分组
  const grouped = useMemo(() => {
    const today = conversations.filter(c => isToday(c.last_message_at))
    const yesterday = conversations.filter(c => isYesterday(c.last_message_at))
    const thisWeek = conversations.filter(c => isThisWeek(c.last_message_at))
    const byBrand = groupBy(conversations, 'brand')
    return { today, yesterday, thisWeek, byBrand }
  }, [conversations])
  
  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <SearchBox value={search} onChange={setSearch} />
      
      {/* 快捷筛选 chips */}
      <div className="flex gap-2 flex-wrap">
        <Chip active={!filter.category} onClick={() => setFilter({})}>全部</Chip>
        <Chip onClick={() => setFilter({ category: 'content' })}>✍️ 内容</Chip>
        <Chip onClick={() => setFilter({ category: 'analysis' })}>📊 分析</Chip>
        <Chip onClick={() => setFilter({ brand: '爱尤趣' })}>🏷️ 爱尤趣</Chip>
        <Chip active={filter.favorite} onClick={() => setFilter(f => ({ ...f, favorite: !f.favorite }))}>⭐ 收藏</Chip>
      </div>
      
      {/* 行业分组列表 */}
      {Object.entries(grouped.byBrand).map(([brand, list]) => (
        <div key={brand}>
          <div className="text-xs text-neutral-500 px-2 py-1">🏷️ {brand} · {list.length}</div>
          {list.map(s => <SessionItem key={s.id} session={s} />)}
        </div>
      ))}
      
      {/* 时间分组列表 */}
      <div>
        <div className="text-xs text-neutral-500 px-2 py-1">📅 今天</div>
        {grouped.today.map(s => <SessionItem key={s.id} session={s} />)}
      </div>
    </div>
  )
}
```

#### 2.2 会话项设计（**关键交互**）

```typescript
// SessionItem.tsx
function SessionItem({ session }: { session: Session }) {
  return (
    <div className="group relative flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-neutral-800/50">
      <span className="text-base flex-shrink-0 mt-0.5">
        {categoryEmoji[session.category]}  {/* ✍️ 📊 🔍 💬 🎨 ⚙️ */}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm truncate flex-1">{session.title}</span>
          {session.is_favorite && <Star size={12} className="text-yellow-400" />}
        </div>
        <div className="text-xs text-neutral-500 truncate">{session.summary}</div>
        <div className="flex items-center gap-1 mt-1">
          {session.tags?.slice(0, 2).map(t => (
            <span className="text-[10px] px-1 rounded bg-neutral-800 text-neutral-400">{t}</span>
          ))}
          <span className="text-[10px] text-neutral-600">· {formatTime(session.last_message_at)}</span>
        </div>
      </div>
      <button className="opacity-0 group-hover:opacity-100">
        <MoreVertical size={14} />
      </button>
    </div>
  )
}
```

#### 2.3 顶部面包屑 + 元数据条

```typescript
// WorkspaceHeader.tsx
<header className="border-b px-4 py-2 flex items-center gap-3">
  <span>{categoryEmoji[session.category]} {session.title}</span>
  {session.brand && <Chip>🏷️ {session.brand}</Chip>}
  {session.tags?.map(t => <Chip>{t}</Chip>)}
  <div className="ml-auto flex gap-2">
    <button onClick={toggleFavorite}>⭐</button>
    <button onClick={openTagsEditor}>🏷️ 编辑标签</button>
    <button onClick={branchFromHere}>🌿 从这里分支</button>
    <button onClick={exportToMD}>📥 导出</button>
  </div>
</header>
```

---

### Phase 3：智能能力补齐（**1 月**，P1）

#### 3.1 全文搜索（FTS5）
- 已通过 schema 升级自带
- 前端：在 SessionList 顶部加搜索框，`?q=xxx` 调 `/api/v1/sessions/search`
- 后端：返回 snippet 高亮

#### 3.2 跨会话知识沉淀
- 用户在某会话里发现一段重要分析 → 按钮"📌 沉淀到知识库"
- 写入 `kb_documents` 表，挂到 `kb_id` 之下
- 下次搜索知识库能调出来

#### 3.3 行业 / 品牌维度统计
- `GET /api/v1/sessions/categories` 返回：
```json
{
  "industries": [
    { "name": "情趣娃娃", "count": 12, "last_active": 1781700000000 },
    { "name": "美妆", "count": 3, "last_active": 1781690000000 }
  ],
  "brands": [
    { "name": "爱尤趣", "count": 15 },
    { "name": "其他", "count": 8 }
  ],
  "tags": [
    { "name": "Q3市场", "count": 4 }
  ]
}
```

#### 3.4 会话自动摘要
- 用 Qwen 2.5 7B 给每个会话生成 50 字摘要
- 用于列表预览，不需要点进会话也能回忆

#### 3.5 工具调用轨迹
- `messages` 表已经有 `tool_calls_json` 字段
- 前端渲染：`role=tool` 消息显示为折叠卡片"调用了 web_search / docgen"

---

### Phase 4：高级能力（**季度级**，P2）

#### 4.1 多分支对话
- 已有 `parent_session_id` 字段
- 在 Workspace 顶部加"分支"按钮：从当前 user 消息拉新分支
- `POST /api/v1/sessions/:id/branch` body=`{from_message_id: 'xxx'}`
- 返回 `{ newSessionId, newThreadId }`
- 侧栏显示树状结构

#### 4.2 跨平台同步
- Web + 桌面 + 移动（如果做）
- 用 JWT + 服务端 sessions 表为 single source of truth
- 彻底告别 localStorage 主存

#### 4.3 协作 / 分享
- `POST /api/v1/sessions/:id/share` 生成只读链接
- 对方点开看到完整对话 + 自动生成的报告

---

## 五、立即可动手的最小可用版（**1 天交付**）

如果老板想今天就看到效果，建议先做**最小闭环**：

### 5.1 改 1 个文件：让 chat.ts 落库
```typescript
// chat.ts 新增 helper
async function persistMessage(sessionId: string, role: 'user' | 'assistant', content: string, opts: { model?: string; tokens?: number; finishReason?: string } = {}) {
  const id = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  await db.prepare(`INSERT INTO messages (id, session_id, role, content, model, token_out, finish_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sessionId, role, content, opts.model ?? null, opts.tokens ?? null, opts.finishReason ?? 'stop', Date.now())
  return id
}

async function autoTitleAndClassify(sessionId: string, userMsg: string, aiMsg: string) {
  // 1. 标题
  const title = await autoTitle(userMsg, aiMsg).catch(() => null)
  // 2. 分类
  const cls = await classifySession(userMsg, aiMsg).catch(() => null)
  
  await db.prepare(`UPDATE sessions SET title = COALESCE(?, title), category = COALESCE(?, category), industry = COALESCE(?, industry), brand = COALESCE(?, brand), tags = COALESCE(?, tags), summary = ?, last_message_at = ? WHERE id = ?`)
    .run(
      title, cls?.category ?? null, cls?.industry ?? null, cls?.brand ?? null,
      cls?.tags ? JSON.stringify(cls.tags) : null,
      aiMsg.slice(0, 100),
      Date.now(),
      sessionId
    )
}

// 在 chat.ts 主路由里：
app.post('/', async (req, reply) => {
  // ... 现有 LLM 调用逻辑 ...
  
  // 1. 创建/复用 session
  let session = threadId ? await getSessionById(threadId) : null
  if (!session) {
    const sessionId = `s_${Date.now().toString(36)}`
    await db.prepare(`INSERT INTO sessions (id, user_id, agent_id, title, model, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(sessionId, userId, 'default', '新会话', 'Qwen2.5-72B', Date.now(), Date.now(), Date.now())
    session = { id: sessionId, title: '新会话' }
    threadId = sessionId
  }
  
  // 2. 落库
  await persistMessage(session.id, 'user', message)
  await persistMessage(session.id, 'assistant', report, { model, tokens })
  
  // 3. 异步自动归类 + 标题（fire-and-forget，不阻塞响应）
  setImmediate(() => autoTitleAndClassify(session.id, message, report).catch(err => req.log.warn({ err }, 'classify failed')))
  
  return reply.send({ threadId: session.id, status: 'completed', report, sources })
})
```

### 5.2 改 1 个文件：Shell 侧栏用真数据 + 行业分组
```typescript
// Shell.tsx
const [filter, setFilter] = useState<'all' | 'favorite' | 'brand:爱尤趣'>('all')

useEffect(() => {
  const params = new URLSearchParams()
  if (filter.startsWith('brand:')) params.set('brand', filter.slice(6))
  if (filter === 'favorite') params.set('favorite', 'true')
  http.get(`/api/v1/sessions?${params}`).then(setRecentSessions)
}, [filter])

// 渲染
{recentSessions.length === 0 ? (
  <EmptyState />
) : (
  <div>
    <div className="flex gap-1 px-2 mb-2">
      <Chip active={filter==='all'} onClick={()=>setFilter('all')}>全部</Chip>
      <Chip active={filter==='favorite'} onClick={()=>setFilter('favorite')}>⭐</Chip>
      <Chip active={filter==='brand:爱尤趣'} onClick={()=>setFilter('brand:爱尤趣')}>🏷️ 爱尤趣</Chip>
    </div>
    {recentSessions.map(s => <SessionItem key={s.id} session={s} />)}
  </div>
)}
```

**做完这两步的效果**：
- 你点"新会话" → 自动在 sessions 表建记录
- 你发消息 → 自动写入 messages 表（不再丢）
- 第一条消息发出 1-2 秒后 → 标题自动从"新会话"变成"精雕娃娃行业市场报告"（自动归类）
- 侧栏按品牌/收藏筛选有效果
- 换设备/重装浏览器，**对话全在**

**预计 1 天（实际 4-6 小时）能完成**。

---

## 六、长期愿景

参考 Hermes 的设计，3 个月后 DaShengOS 应该长这样：

```
┌──────────────────────────────────────────────────────────────────┐
│  DaShengOS · 私人 AI 工作台                                        │
├──────────┬───────────────────────────────────────────────────────┤
│ 侧栏       │ 工作区                                                 │
│          │                                                       │
│ 🔍 搜索     │  ✍️ 精雕娃娃行业市场报告  [爱尤趣] [Q3市场] [分析]  ⭐ │
│          │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ [全部]    │  AI: 报告内容预览（带 iframe 渲染的 HTML 报告卡片）         │
│ [⭐收藏]  │                                                       │
│ [爱尤趣]  │  [输入框] [发送]                                       │
│ [PPT/报告] │                                                       │
│          │                                                       │
│ 📁 爱尤趣 (15)│                                                     │
│  • 精雕娃娃...  │                                                     │
│  • 双11方案...  │                                                     │
│  • 主播话术...  │                                                     │
│          │                                                       │
│ 📁 美妆 (3)   │                                                     │
│  • 抖音美妆分析│                                                     │
│          │                                                       │
│ 📅 今天 (5)   │                                                     │
│  • 帮我做一份...│                                                     │
│  ...       │                                                     │
└──────────┴───────────────────────────────────────────────────────┘
```

---

## 七、风险与权衡

| 风险 | 应对 |
|---|---|
| 自动归类调用 LLM 增成本 | 用 Qwen2.5 7B（最便宜）异步 fire-and-forget |
| 改 chat.ts 落库可能影响性能 | 用 `setImmediate` 异步分类，主流程 INSERT 同步（毫秒级）|
| 加列需要迁移老数据 | ALTER TABLE ADD COLUMN 都是 NULL 友好，老数据不受影响 |
| 改动量大怕引入 bug | Phase 1 只动 chat.ts 的 INSERT 部分，其他暂不动 |
| 多分支 UI 复杂 | 推到 Phase 4，本季度不做 |

---

## 八、下一步行动

**请老板决定**：

1. **今天就做最小可用版**（1 天，4-6 小时）
   - 改 `chat.ts` 加 60 行（落库 + 异步归类 + 标题）
   - 改 `Shell.tsx` 加 30 行（品牌筛选 chip）
   - ALTER TABLE 加 5 列
   - 效果：对话不丢、自动标题、按品牌分组

2. **做完整 Phase 1+2**（2-3 周）
   - 上述 + FTS5 搜索 + 完整 UI 重做
   - 接近 WorkBuddy/Hermes 体验

3. **先列 TODO 等下次集中做**
   - 把这份报告存为 ticket

我推荐**方案 1**（今天就做）——老板能立刻看到效果，验证方向对了再做完整版。
