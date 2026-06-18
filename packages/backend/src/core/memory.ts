// packages/backend/src/core/memory.ts · v0.3 Phase A.2
// 三层记忆系统: 长期记忆摘要 (auto/manual) + 关键词搜索 + 上下文注入

import { sqlite } from '../storage/db.js'
import { config } from '../config.js'
import { ulid } from 'ulid'

export interface MemorySummary {
  id: string
  user_id: string
  session_id: string | null
  summary: string
  keywords: string
  embedding: string | null
  importance: number
  source: 'auto' | 'manual'
  created_at: number
}

// ===========================================================================
// 关键词提取 (纯文本, 不用 LLM)
// ===========================================================================
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'again',
  'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
  'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'because', 'but', 'and', 'or', 'if', 'while',
])

export function extractKeywords(text: string, maxKeywords = 5): string[] {
  // 简单中文/英文分词: 按空格和标点分割
  const tokens = text
    .toLowerCase()
    .split(/[\s,，。.!！?？;；:：、""''()（）\[\]【】{}<>《》\n\r\t]+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))

  // 简单频率统计
  const freq = new Map<string, number>()
  for (const t of tokens) {
    freq.set(t, (freq.get(t) ?? 0) + 1)
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([k]) => k)
}

// ===========================================================================
// 自动摘要: 取会话最后 20 条消息 → 调 SiliconFlow LLM 生成摘要
// ===========================================================================
export async function autoSummarize(sessionId: string): Promise<MemorySummary | null> {
  const now = Date.now()

  // 1) 取会话信息
  const session = sqlite
    .prepare('SELECT user_id FROM sessions WHERE id = ?')
    .get(sessionId) as { user_id: string } | undefined
  if (!session) return null

  // 2) 取最后 20 条消息
  const messages = sqlite
    .prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId) as Array<{ role: string; content: string }>
  const recentMessages = messages.slice(-20)

  if (recentMessages.length === 0) return null

  // 3) 构建 LLM 提示
  const conversationText = recentMessages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join('\n')

  const prompt = `请根据以下对话内容，生成一个2-3句话的中文摘要（概括对话的核心主题和关键结论），并列出5个关键词（用逗号分隔）。

对话内容：
${conversationText.slice(0, 8000)}

请严格按照以下JSON格式回复，不要包含其他内容：
{"summary": "你的2-3句中文摘要", "keywords": "关键词1,关键词2,关键词3,关键词4,关键词5"}`

  // 4) 调用 SiliconFlow
  if (!config.SILICONFLOW_API_KEY) {
    // 没有 LLM key → 退化为纯文本关键词提取
    const allText = recentMessages.map((m) => m.content).join(' ')
    const keywords = extractKeywords(allText)
    const fallbackSummary = recentMessages
      .filter((m) => m.role === 'USER')
      .slice(0, 3)
      .map((m) => m.content.slice(0, 100))
      .join('；')

    const id = ulid()
    sqlite
      .prepare(
        `INSERT INTO memory_summaries (id, user_id, session_id, summary, keywords, embedding, importance, source, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0.3, 'auto', ?)`,
      )
      .run(id, session.user_id, sessionId, fallbackSummary || '无内容', keywords.join(','), now)

    return {
      id,
      user_id: session.user_id,
      session_id: sessionId,
      summary: fallbackSummary || '无内容',
      keywords: keywords.join(','),
      embedding: null,
      importance: 0.3,
      source: 'auto',
      created_at: now,
    }
  }

  try {
    const res = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.SILICONFLOW_DEFAULT_MODEL,
        messages: [
          { role: 'user', content: prompt },
        ],
        stream: false,
        temperature: 0.3,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
    })

    if (!res.ok) {
      // LLM 失败 → 退化为关键词提取
      const allText = recentMessages.map((m) => m.content).join(' ')
      const keywords = extractKeywords(allText)
      const fallbackSummary = recentMessages
        .filter((m) => m.role === 'USER')
        .slice(0, 3)
        .map((m) => m.content.slice(0, 100))
        .join('；')

      const id = ulid()
      sqlite
        .prepare(
          `INSERT INTO memory_summaries (id, user_id, session_id, summary, keywords, embedding, importance, source, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, 0.3, 'auto', ?)`,
        )
        .run(id, session.user_id, sessionId, fallbackSummary || '无内容', keywords.join(','), now)

      return {
        id,
        user_id: session.user_id,
        session_id: sessionId,
        summary: fallbackSummary || '无内容',
        keywords: keywords.join(','),
        embedding: null,
        importance: 0.3,
        source: 'auto',
        created_at: now,
      }
    }

    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    const rawContent = json.choices?.[0]?.message?.content ?? ''

    // 5) 解析 JSON 响应
    let summary = '对话摘要'
    let keywordsStr = ''
    const allText = recentMessages.map((m) => m.content).join(' ')
    try {
      // 尝试提取 JSON (可能被 markdown ``` 包裹)
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        summary = parsed.summary || summary
        keywordsStr = parsed.keywords || ''
      } else {
        summary = rawContent || summary
        keywordsStr = extractKeywords(allText || rawContent).join(',')
      }
    } catch {
      summary = rawContent || summary
      keywordsStr = extractKeywords(allText).join(',')
    }

    // 6) 存 DB
    const id = ulid()
    sqlite
      .prepare(
        `INSERT INTO memory_summaries (id, user_id, session_id, summary, keywords, embedding, importance, source, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0.6, 'auto', ?)`,
      )
      .run(id, session.user_id, sessionId, summary, keywordsStr, now)

    return {
      id,
      user_id: session.user_id,
      session_id: sessionId,
      summary,
      keywords: keywordsStr,
      embedding: null,
      importance: 0.6,
      source: 'auto',
      created_at: now,
    }
  } catch {
    // 网络错误 → 返回 null, 不存 (由调用方决定)
    return null
  }
}

// ===========================================================================
// 搜索记忆: 关键词匹配 (summary + keywords LIKE)
// ===========================================================================
export function searchMemory(
  userId: string,
  query: string,
  limit = 10,
): MemorySummary[] {
  const likePattern = `%${query}%`
  return sqlite
    .prepare(
      `SELECT * FROM memory_summaries
       WHERE user_id = ?
         AND (summary LIKE ? OR keywords LIKE ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(userId, likePattern, likePattern, limit) as MemorySummary[]
}

// ===========================================================================
// 构建上下文: 注入到新会话的 system prompt
// ===========================================================================
export function getContext(
  userId: string,
  currentTopic?: string,
  maxMemories = 5,
): string {
  let rows: MemorySummary[]

  if (currentTopic) {
    // 话题相关记忆: 关键词匹配
    rows = searchMemory(userId, currentTopic, maxMemories)
  } else {
    // 最近的高重要性记忆
    rows = sqlite
      .prepare(
        `SELECT * FROM memory_summaries
         WHERE user_id = ?
         ORDER BY importance DESC, created_at DESC
         LIMIT ?`,
      )
      .all(userId, maxMemories) as MemorySummary[]
  }

  if (rows.length === 0) return ''

  const lines = rows.map(
    (r) => `- [${new Date(r.created_at).toLocaleDateString('zh-CN')}] ${r.summary} (关键词: ${r.keywords})`,
  )
  return `## 历史记忆\n以下是你与该用户之前的对话摘要，可参考这些上下文来理解用户意图：\n${lines.join('\n')}`
}

// ===========================================================================
// 清理旧记忆: 删除过旧或低重要性的记忆
// ===========================================================================
export function pruneOldMemories(
  userId: string,
  maxAgeMs = 90 * 24 * 60 * 60 * 1000, // 默认 90 天
): number {
  const cutoff = Date.now() - maxAgeMs
  const res = sqlite
    .prepare(
      `DELETE FROM memory_summaries
       WHERE user_id = ?
         AND (created_at < ? OR importance < 0.1)`,
    )
    .run(userId, cutoff)
  return res.changes
}

// ===========================================================================
// 列出用户所有记忆
// ===========================================================================
export function listMemories(
  userId: string,
  limit = 50,
  offset = 0,
): MemorySummary[] {
  return sqlite
    .prepare(
      `SELECT * FROM memory_summaries
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, limit, offset) as MemorySummary[]
}

// ===========================================================================
// 创建手动记忆
// ===========================================================================
export function createManualMemory(
  userId: string,
  sessionId: string | null,
  summary: string,
  keywords: string,
  importance = 0.5,
): MemorySummary {
  const id = ulid()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO memory_summaries (id, user_id, session_id, summary, keywords, embedding, importance, source, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'manual', ?)`,
    )
    .run(id, userId, sessionId, summary, keywords, importance, now)

  return {
    id,
    user_id: userId,
    session_id: sessionId,
    summary,
    keywords,
    embedding: null,
    importance,
    source: 'manual',
    created_at: now,
  }
}

// ===========================================================================
// 删除记忆
// ===========================================================================
export function deleteMemory(memoryId: string, userId: string): boolean {
  const res = sqlite
    .prepare('DELETE FROM memory_summaries WHERE id = ? AND user_id = ?')
    .run(memoryId, userId)
  return res.changes > 0
}
