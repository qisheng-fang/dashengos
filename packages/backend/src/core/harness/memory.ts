// packages/backend/src/core/harness/memory.ts · DaShengOS Harness — Memory Injection v3
// 2026-06-18 · 长期记忆 + 短期工作记忆 + 品牌知识 + 上下文管理 + Wiki 知识库 + 跨对话记忆
// 数据源: SQLite (learnings/memory/context/wiki/cross_session 表) + 品牌知识硬编码 + 最近对话摘要

import { sqlite } from '../../storage/db.js'
import { BRAND_KNOWLEDGE } from './system-prompt.js'
import { semanticSearch, indexMemoryEmbedding, hybridSearch } from './vector-memory.js'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

// ─── Types ─────────────────────────────────────────────────

export interface UserProfile {
  username: string
  role: string
  tier: string
  preferences?: Record<string, string>
}

export interface BrandKnowledge {
  brandName: string
  brandNameEn: string
  industry: string
  positioning: string
  targetAudience: string
  coreValues: string[]
  priceRange: string
  competitors: string[]
  distributionChannels: string[]
  keySellingPoints: string[]
  industryFacts: string[]
  brandTone: string
}

export interface MemoryEntry {
  category: 'fact' | 'preference' | 'insight' | 'task' | 'brand' | 'context' | 'decision' | 'wiki' | 'cross_session'
  content: string
  relevance: number // 0-1
  createdAt: string
  source?: string // 来源标识 (memory/learning/context/wiki)
}

export interface ConversationMemory {
  entries: MemoryEntry[]
  brandContext: BrandKnowledge
  recentTopics: string[]
  /** 上下文窗口: 最近 N 轮对话的摘要/决策 */
  contextWindow: ContextEntry[]
  /** Wiki 知识库页面 */
  wikiPages: WikiPage[]
  /** 跨对话记忆: 从历史对话提取的关键事实/结论 */
  crossSessionMemory: CrossSessionEntry[]
}

/** 上下文管理 — 会话内状态 */
export interface ContextEntry {
  sessionId: string
  topic: string           // 本轮对话的主题
  keyDecisions: string[]  // 已作出的关键决策/结论
  pendingItems: string[]  // 未完成的事项
  timestamp: number
}

/** Wiki 知识库页面 */
export interface WikiPage {
  title: string
  content: string
  source: string // 来源标识
  updatedAt: string
}

/** 跨对话记忆 — 从历史对话中提取的持久化关键信息 */
export interface CrossSessionEntry {
  id: number
  sessionId: string
  category: 'fact' | 'decision' | 'preference' | 'insight' | 'task_pattern' | 'skill_candidate'
  summary: string       // 精炼摘要 (≤200 字)
  keywords: string[]    // 关键词 (用于语义匹配)
  toolSequence?: string[] // 用到的工具序列 (用于 skill 发现)
  createdAt: number
  accessCount: number   // 被检索次数 (用于热度衰减)
  lastAccessedAt: number
}

// ─── 品牌知识: 从 DB 加载 (回退硬编码) ─────────────────────

/**
 * 从 brand_settings 表加载可配置的品牌知识。
 * 如果表中无记录，回退到 system-prompt.ts 中的硬编码 BRAND_KNOWLEDGE。
 */
export function loadBrandKnowledgeFromDB(): BrandKnowledge {
  try {
    const row = sqlite.prepare('SELECT key, value FROM brand_settings').all() as Array<{ key: string; value: string }>
    if (!row || row.length === 0) return BRAND_KNOWLEDGE

    const settings: Record<string, string> = {}
    for (const r of row) settings[r.key] = r.value

    return {
      brandName: settings.brandName || BRAND_KNOWLEDGE.brandName,
      brandNameEn: settings.brandNameEn || BRAND_KNOWLEDGE.brandNameEn,
      industry: settings.industry || BRAND_KNOWLEDGE.industry,
      positioning: settings.positioning || BRAND_KNOWLEDGE.positioning,
      targetAudience: settings.targetAudience || BRAND_KNOWLEDGE.targetAudience,
      coreValues: JSON.parse(settings.coreValues || '[]').length ? JSON.parse(settings.coreValues) : BRAND_KNOWLEDGE.coreValues,
      priceRange: settings.priceRange || BRAND_KNOWLEDGE.priceRange,
      competitors: JSON.parse(settings.competitors || '[]').length ? JSON.parse(settings.competitors) : BRAND_KNOWLEDGE.competitors,
      distributionChannels: JSON.parse(settings.distributionChannels || '[]').length ? JSON.parse(settings.distributionChannels) : BRAND_KNOWLEDGE.distributionChannels,
      keySellingPoints: JSON.parse(settings.keySellingPoints || '[]').length ? JSON.parse(settings.keySellingPoints) : BRAND_KNOWLEDGE.keySellingPoints,
      industryFacts: JSON.parse(settings.industryFacts || '[]').length ? JSON.parse(settings.industryFacts) : BRAND_KNOWLEDGE.industryFacts,
      brandTone: settings.brandTone || BRAND_KNOWLEDGE.brandTone,
    }
  } catch {
    return BRAND_KNOWLEDGE
  }
}

/**
 * 更新品牌配置到数据库（管理 API 使用）
 */
export function saveBrandSetting(key: string, value: string): void {
  try {
    sqlite.prepare(`
      INSERT INTO brand_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, Date.now())
  } catch (e) {
    console.error('[Brand] saveBrandSetting failed:', e)
  }
}

/**
 * 从数据库批量初始化品牌配置（首次安装时调用）
 */
export function seedBrandSettings(): void {
  try {
    const exists = sqlite.prepare('SELECT COUNT(*) as c FROM brand_settings').get() as { c: number }
    if (exists && exists.c > 0) return // 已有配置，不覆盖

    const settings: Record<string, string> = {
      brandName: BRAND_KNOWLEDGE.brandName,
      brandNameEn: BRAND_KNOWLEDGE.brandNameEn,
      industry: BRAND_KNOWLEDGE.industry,
      positioning: BRAND_KNOWLEDGE.positioning,
      targetAudience: BRAND_KNOWLEDGE.targetAudience,
      coreValues: JSON.stringify(BRAND_KNOWLEDGE.coreValues),
      priceRange: BRAND_KNOWLEDGE.priceRange,
      competitors: JSON.stringify(BRAND_KNOWLEDGE.competitors),
      distributionChannels: JSON.stringify(BRAND_KNOWLEDGE.distributionChannels),
      keySellingPoints: JSON.stringify(BRAND_KNOWLEDGE.keySellingPoints),
      industryFacts: JSON.stringify(BRAND_KNOWLEDGE.industryFacts),
      brandTone: BRAND_KNOWLEDGE.brandTone,
    }
    for (const [key, value] of Object.entries(settings)) {
      saveBrandSetting(key, value)
    }
    console.log('[Brand] 品牌配置已初始化到数据库')
  } catch (e) {
    console.error('[Brand] seedBrandSettings failed:', e)
  }
}

// ─── 完整记忆加载 (Agent 模式) ────────────────────────────

/**
 * 加载用户相关的完整记忆上下文
 * - 品牌知识: 硬编码核心事实
 * - 长期记忆: learnings + memory 表
 * - 上下文管理: 最近会话的决策/结论/待办 (context 表)
 * - 最近话题: sessions/messages 提取
 * - Wiki 知识库: wiki 表
 */
export function loadMemoryContext(userId: string): ConversationMemory {
  const entries: MemoryEntry[] = []

  // 1. 品牌知识 (从数据库加载, 回退硬编码)
  const brandContext = loadBrandKnowledgeFromDB()

  entries.push({
    category: 'brand',
    content: `品牌: ${brandContext.brandName} | 行业: ${brandContext.industry} | 定位: ${brandContext.positioning} | 目标受众: ${brandContext.targetAudience} | 调性: ${brandContext.brandTone}`,
    relevance: 1.0,
    createdAt: new Date().toISOString(),
    source: 'brand',
  })

  entries.push({
    category: 'brand',
    content: `核心卖点: ${brandContext.keySellingPoints.join(' / ')}`,
    relevance: 0.95,
    createdAt: new Date().toISOString(),
    source: 'brand',
  })

  entries.push({
    category: 'brand',
    content: `行业数据: ${brandContext.industryFacts.join('; ')}`,
    relevance: 0.85,
    createdAt: new Date().toISOString(),
    source: 'brand',
  })

  entries.push({
    category: 'brand',
    content: `销售渠道: ${brandContext.distributionChannels.join(', ')} | 竞品: ${brandContext.competitors.join(', ')} | 价位: ${brandContext.priceRange}`,
    relevance: 0.8,
    createdAt: new Date().toISOString(),
    source: 'brand',
  })

  // 2. 用户学习记录 (从 learnings 表)
  try {
    const learnings = sqlite
      .prepare('SELECT content, category, created_at FROM learnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
      .all(userId) as Array<{ content: string; category: string; created_at: string }>

    for (const l of learnings) {
      entries.push({
        category: mapCategory(l.category),
        content: l.content,
        relevance: 0.7,
        createdAt: l.created_at,
        source: 'learning',
      })
    }
  } catch { /* learnings 表可能不存在 */ }

  // 3. 用户记忆 (从 memory 表)
  try {
    const memories = sqlite
      .prepare('SELECT key, value, updated_at FROM memory WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10')
      .all(userId) as Array<{ key: string; value: string; updated_at: string }>

    for (const m of memories) {
      entries.push({
        category: 'fact',
        content: `${m.key}: ${m.value}`,
        relevance: 0.75,
        createdAt: m.updated_at,
        source: 'memory',
      })
    }
  } catch { /* memory 表可能不存在 */ }

  // 4. 上下文管理 (从 context 表 — 会话内决策/结论)
  const contextWindow = loadContextWindow(userId)

  // 5. 最近对话话题 (从 messages 表提取)
  const recentTopics = extractRecentTopics(userId)

  // 6. Wiki 知识库 (从 wiki 表)
  const wikiPages = loadWikiPages(recentTopics[0])

  // 7. 跨对话记忆 (从 cross_session_memory 表)
  const crossSessionMemory = loadCrossSessionMemory(userId, 8, recentTopics[0] || '')

  return {
    entries,
    brandContext: brandContext,
    recentTopics,
    contextWindow,
    wikiPages,
    crossSessionMemory,
  }
}

// ─── 轻量版 (Stream 模式, 省 tokens) ─────────────────────

export function loadLightMemory(userId: string): ConversationMemory {
  const brandCtx = loadBrandKnowledgeFromDB()
  const entries: MemoryEntry[] = [
    {
      category: 'brand',
      content: `品牌: ${brandCtx.brandName} | ${brandCtx.positioning} | ${brandCtx.brandTone}`,
      relevance: 1.0,
      createdAt: new Date().toISOString(),
      source: 'brand',
    },
  ]

  try {
    const top3 = sqlite
      .prepare('SELECT content, category FROM learnings WHERE user_id = ? ORDER BY created_at DESC LIMIT 3')
      .all(userId) as Array<{ content: string; category: string }>

    for (const l of top3) {
      entries.push({
        category: mapCategory(l.category),
        content: l.content,
        relevance: 0.6,
        createdAt: '',
        source: 'learning',
      })
    }
  } catch { /* ok */ }

  // 轻量版也加载最近 1 个上下文 (保持对话连贯性)
  const contextWindow = loadContextWindow(userId, 1)

  return { entries, brandContext: BRAND_KNOWLEDGE, recentTopics: [], contextWindow, wikiPages: [], crossSessionMemory: [] }
}

// ─── 上下文管理 ────────────────────────────────────────────

/**
 * 加载上下文窗口 — 最近会话的关键决策/结论/待办
 * 数据源: context 表 (如果不存在则从 messages 反推)
 */
function loadContextWindow(userId: string, maxEntries = 3): ContextEntry[] {
  const results: ContextEntry[] = []

  // 尝试从 context 表读
  try {
    const rows = sqlite
      .prepare('SELECT session_id, topic, key_decisions, pending_items, timestamp FROM context WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?')
      .all(userId, maxEntries) as Array<{
        session_id: string
        topic: string
        key_decisions: string  // JSON string
        pending_items: string  // JSON string
        timestamp: number
      }>

    for (const r of rows) {
      let decisions: string[] = []
      let pending: string[] = []
      try { decisions = JSON.parse(r.key_decisions) } catch { /* ok */ }
      try { pending = JSON.parse(r.pending_items) } catch { /* ok */ }
      results.push({
        sessionId: r.session_id,
        topic: r.topic,
        keyDecisions: decisions,
        pendingItems: pending,
        timestamp: r.timestamp,
      })
    }
  } catch {
    // context 表不存在 — 从最近 messages 反推上下文
    try {
      const recent = sqlite
        .prepare(`
          SELECT s.id as session_id, GROUP_CONCAT(m.content, ' | ') as content
          FROM sessions s
          JOIN messages m ON m.session_id = s.id
          WHERE s.user_id = ? AND m.role = 'user'
          GROUP BY s.id
          ORDER BY MAX(m.created_at) DESC LIMIT ?
        `)
        .all(userId, maxEntries) as Array<{ session_id: string; content: string }>

      for (const r of recent) {
        // 粗提取: 取前50字作为 topic
        const topic = r.content.split(' | ')[0]?.slice(0, 50) || '对话'
        results.push({
          sessionId: r.session_id,
          topic,
          keyDecisions: [],
          pendingItems: [],
          timestamp: Date.now(),
        })
      }
    } catch { /* ok */ }
  }

  return results
}

/**
 * 保存上下文 — 在对话过程中更新决策/结论
 * 写入 context 表 (upsert)
 */
export function saveContextEntry(opts: {
  userId: string
  sessionId: string
  topic: string
  keyDecisions: string[]
  pendingItems: string[]
}): void {
  try {
    // 确保 context 表存在
    sqlite.prepare(`CREATE TABLE IF NOT EXISTS context (
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      topic TEXT DEFAULT '',
      key_decisions TEXT DEFAULT '[]',
      pending_items TEXT DEFAULT '[]',
      timestamp INTEGER DEFAULT 0,
      PRIMARY KEY (user_id, session_id)
    )`).run()

    sqlite.prepare(`
      INSERT INTO context (user_id, session_id, topic, key_decisions, pending_items, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, session_id) DO UPDATE SET
        topic = excluded.topic,
        key_decisions = excluded.key_decisions,
        pending_items = excluded.pending_items,
        timestamp = excluded.timestamp
    `).run(
      opts.userId,
      opts.sessionId,
      opts.topic,
      JSON.stringify(opts.keyDecisions),
      JSON.stringify(opts.pendingItems),
      Date.now(),
    )
  } catch { /* non-critical */ }
}

// ─── Wiki 知识库 ──────────────────────────────────────────

/**
 * 加载 Wiki 知识库页面
 * 数据源: wiki 表 + 文件系统 wiki 目录
 */
function loadWikiPages(topic?: string): WikiPage[] {
  const pages: WikiPage[] = []

  // 1. 从 wiki 表读取 (SQLite)
  try {
    const rows = sqlite
      .prepare('SELECT title, content, source, updated_at FROM wiki ORDER BY updated_at DESC LIMIT 10')
      .all() as Array<{ title: string; content: string; source: string; updated_at: string }>

    for (const r of rows) {
      pages.push({
        title: r.title,
        content: topic ? extractRelevantSections(r.content, topic) : r.content.slice(0, 8000),
        source: r.source || 'wiki_db',
        updatedAt: r.updated_at,
      })
    }
  } catch {
    // wiki 表不存在, 继续从文件系统读取
  }

  // 2. 从文件系统读取所有 .md 文件 (.workbuddy/memory/)
  try {
    const wikiDir = '/Users/apple/Desktop/ai-workbench-v2/.workbuddy/memory'
    if (existsSync(wikiDir)) {
      const files = readdirSync(wikiDir)
        .filter(f => f.endsWith('.md'))
        .sort()
        .reverse()

      for (const file of files) {
        const filePath = wikiDir + '/' + file
        try {
          const raw = readFileSync(filePath, 'utf-8')
          if (!raw.trim()) continue

          let selected = raw
          if (topic && raw.length > 3000) {
            selected = extractRelevantSections(raw, topic)
          }
          if (selected.length > 8000) {
            const head = raw.slice(0, 3000)
            const tail = raw.slice(-2000)
            selected = topic ? extractRelevantSections(raw, topic) : head + '\n\n...\n\n' + tail
          }

          pages.push({
            title: file.replace('.md', ''),
            content: selected,
            source: 'file:' + file,
            updatedAt: new Date().toISOString(),
          })
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* ok */ }

  return pages
}

// ─── 关键词匹配 ───
function extractRelevantSections(text: string, topic: string): string {
  const keywords = topic
    .toLowerCase()
    .split(/[\s,，、。；;]+/)
    .filter((k) => k.length > 1)
    .slice(0, 8)

  if (keywords.length === 0) return text.slice(0, 8000)

  const sections = text.split(/^## /m)
  if (sections.length <= 1) return text.slice(0, 8000)

  const relevant = []
  if (sections[0].trim()) {
    relevant.push(sections[0].slice(0, 1000))
  }

  for (let i = 1; i < sections.length; i++) {
    const section = sections[i]
    const headerLine = section.split('\n')[0] || ''
    const sectionLower = (headerLine + ' ' + section.slice(0, 500)).toLowerCase()

    const hits = keywords.filter(k => sectionLower.includes(k))
    if (hits.length >= 1 || headerLine.length < 3) {
      relevant.push('## ' + section.slice(0, 2000))
    }
  }

  let result = relevant.join('\n\n')
  if (result.length > 8000) {
    result = result.slice(0, 8000) + '\n\n...(truncated)'
  }
  return result || text.slice(0, 5000)
}


// ─── 辅助 ──────────────────────────────────────────────────

function mapCategory(cat: string): MemoryEntry['category'] {
  switch (cat) {
    case 'fact': case 'preference': case 'insight': case 'task': case 'brand': case 'context': case 'decision': case 'wiki':
      return cat as MemoryEntry['category']
    default:
      return 'fact'
  }
}

function extractRecentTopics(userId: string): string[] {
  try {
    const recent = sqlite
      .prepare(`
        SELECT m.content FROM messages m
        JOIN sessions s ON m.session_id = s.id
        WHERE s.user_id = ? AND m.role = 'user'
        ORDER BY m.created_at DESC LIMIT 5
      `)
      .all(userId) as Array<{ content: string }>

    return recent
      .map((r) => {
        const cleaned = r.content
          .replace(/^(帮我|请|我想|能不能|可以|什么|怎么|如何|为什么|那个)/, '')
          .slice(0, 30)
          .trim()
        return cleaned
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

// ─── 跨对话记忆 (Cross-Session Memory) ────────────────────

/**
 * 加载跨对话记忆 — 从历史对话中提取的持久化关键信息
 * 语义匹配: 关键词重叠 + 时间衰减 + 访问热度
 */
function loadCrossSessionMemory(userId: string, limit = 8, query?: string): CrossSessionEntry[] {
  ensureCrossSessionTable()

  try {
    // Vector semantic search for relevance boosting
    let vectorBoost: Map<number, number> = new Map()
    if (query && query.length > 2) {
      try {
        const results = semanticSearch(query, userId, 20)
        for (const r of results) vectorBoost.set(r.memoryId, r.score)
      } catch { /* vector search non-critical */ }
    }

    const now = Date.now()
    const rows = sqlite
      .prepare(`
        SELECT id, session_id, category, summary, keywords, tool_sequence,
               created_at, access_count, last_accessed_at
        FROM cross_session_memory
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `)
      .all(userId, Math.max(limit * 5, 40)) as Array<{
        id: number
        session_id: string
        category: string
        summary: string
        keywords: string       // JSON string
        tool_sequence: string  // JSON string | null
        created_at: number
        access_count: number
        last_accessed_at: number
      }>

    const entries = rows.map((r) => {
      const vs = vectorBoost.get(r.id) || 0
      // Time decay + access frequency + vector relevance
      const timeDecay = 1.0 / (1 + (now - r.created_at) / (7 * 86400000))
      const score = (r.access_count * 0.3 + timeDecay * 0.4 + vs * 0.3)
      return {
        id: r.id,
        sessionId: r.session_id,
        category: r.category as CrossSessionEntry['category'],
        summary: r.summary,
        keywords: JSON.parse(r.keywords || '[]'),
        toolSequence: r.tool_sequence ? JSON.parse(r.tool_sequence) : undefined,
        createdAt: r.created_at,
        accessCount: r.access_count,
        lastAccessedAt: r.last_accessed_at,
        _score: score,
      }
    })
    entries.sort((a, b) => (b._score || 0) - (a._score || 0))
    return entries.slice(0, limit).map(({ _score, ...rest }) => rest)
  } catch {
    return []
  }
}

/**
 * 按关键词检索跨对话记忆 (语义匹配)
 * 当前实现: 关键词重叠度 + 时间衰减
 */
export function searchCrossSessionMemory(userId: string, query: string, limit = 5): CrossSessionEntry[] {
  ensureCrossSessionTable()

  const queryKeywords = extractKeywords(query)
  if (queryKeywords.length === 0) return []

  try {
    // 加载所有，内存中做关键词匹配 (SQLite 不支持 JSON 数组查询)
    const rows = sqlite
      .prepare(`
        SELECT id, session_id, category, summary, keywords, tool_sequence,
               created_at, access_count, last_accessed_at
        FROM cross_session_memory
        WHERE user_id = ?
        ORDER BY created_at DESC LIMIT 50
      `)
      .all(userId) as Array<{
        id: number
        session_id: string
        category: string
        summary: string
        keywords: string
        tool_sequence: string | null
        created_at: number
        access_count: number
        last_accessed_at: number
      }>

    const scored = rows.map((r) => {
      const memKeywords: string[] = JSON.parse(r.keywords || '[]')
      const overlap = queryKeywords.filter(k => memKeywords.some(mk => mk.includes(k) || k.includes(mk))).length
      const timeDecay = 1 / ((Date.now() - r.created_at) / 86400000 + 1)
      const score = overlap * 10 + timeDecay
      return { row: r, score }
    }).filter(s => s.score > 0)

    scored.sort((a, b) => b.score - a.score)

    // 更新 access_count
    for (const s of scored.slice(0, limit)) {
      try {
        sqlite.prepare('UPDATE cross_session_memory SET access_count = access_count + 1, last_accessed_at = ? WHERE id = ?')
          .run(Date.now(), s.row.id)
      } catch { /* non-critical */ }
    }

    // ★ Vector Memory: 混合搜索 (关键词 + 语义)
    const keywordResults = scored.slice(0, limit).map(s => ({
      id: s.row.id,
      sessionId: s.row.session_id,
      category: s.row.category as CrossSessionEntry['category'],
      summary: s.row.summary,
      keywords: JSON.parse(s.row.keywords || '[]'),
      toolSequence: s.row.tool_sequence ? JSON.parse(s.row.tool_sequence) : undefined,
      createdAt: s.row.created_at,
      accessCount: s.row.access_count,
      lastAccessedAt: s.row.last_accessed_at,
      keywordScore: s.score,
    }))

    // 语义增强
    try {
      const keywordForHybrid = scored.slice(0, 20).map(s => ({
        id: s.row.id, summary: s.row.summary, category: s.row.category,
        keywords: JSON.parse(s.row.keywords || '[]'), score: s.score
      }))
      const hybrid = hybridSearch(query, userId, keywordForHybrid, limit)
      if (hybrid.length > 0 && hybrid[0].semanticScore > 0.3) {
        // 语义搜索结果替换/补充关键词结果
        const hybridMap = new Map(hybrid.map(h => [h.id, h]))
        for (const kr of keywordResults) {
          const h = hybridMap.get(kr.id)
          if (h) (kr as any).semanticScore = h.semanticScore
        }
        keywordResults.sort((a: any, b: any) => 
          ((b.keywordScore || 0) + (b.semanticScore || 0) * 15) - 
          ((a.keywordScore || 0) + (a.semanticScore || 0) * 15)
        )
      }
    } catch { /* semantic search is non-critical */ }

    return keywordResults
  } catch {
    return []
  }
}

/**
 * 保存跨对话记忆 — 对话结束时从 LLM 输出中提取关键信息
 * 自动去重: 相同 category + 相同 keywords 视为重复，只保留最新
 */
export function saveCrossSessionMemory(opts: {
  userId: string
  sessionId: string
  category: CrossSessionEntry['category']
  summary: string
  keywords: string[]
  toolSequence?: string[]
}): void {
  ensureCrossSessionTable()

  try {
    // 去重: 同 category + 关键词重叠 > 50% 视为更新
    const existing = sqlite
      .prepare('SELECT id, keywords FROM cross_session_memory WHERE user_id = ? AND category = ?')
      .all(opts.userId, opts.category) as Array<{ id: number; keywords: string }>

    for (const e of existing) {
      const existingKeywords: string[] = JSON.parse(e.keywords || '[]')
      const overlap = opts.keywords.filter(k => existingKeywords.includes(k)).length
      if (overlap > existingKeywords.length * 0.5) {
        // 更新已有记录
        sqlite.prepare(`
          UPDATE cross_session_memory
          SET summary = ?, keywords = ?, tool_sequence = ?, session_id = ?, created_at = ?
          WHERE id = ?
        `).run(
          opts.summary,
          JSON.stringify(opts.keywords),
          opts.toolSequence ? JSON.stringify(opts.toolSequence) : null,
          opts.sessionId,
          Date.now(),
          e.id,
        )
        return
      }
    }

    // 新增
    const insertResult = sqlite.prepare(`
      INSERT INTO cross_session_memory (user_id, session_id, category, summary, keywords, tool_sequence, created_at, access_count, last_accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      opts.userId,
      opts.sessionId,
      opts.category,
      opts.summary,
      JSON.stringify(opts.keywords),
      opts.toolSequence ? JSON.stringify(opts.toolSequence) : null,
      Date.now(),
      Date.now(),
    )
    // ★ Vector Memory: 自动嵌入并索引
    try {
      const newId = (insertResult as any).lastInsertRowid as number
      if (newId) indexMemoryEmbedding(newId, opts.summary + ' ' + opts.keywords.join(' '))
    } catch { /* vector indexing is non-critical */ }
  } catch { /* non-critical */ }
}

/**
 * 从对话结束后的上下文自动提取跨对话记忆
 * 调用时机: 对话结束 / Agent 完成任务后
 */
export function extractAndSaveCrossSessionMemory(opts: {
  userId: string
  sessionId: string
  userMessage: string
  assistantResponse: string
  toolCalls?: string[] // 用到的工具序列
}): void {
  const { userId, sessionId, userMessage, assistantResponse, toolCalls } = opts

  // 1. 提取关键词
  const keywords = extractKeywords(userMessage + ' ' + assistantResponse.slice(0, 500))

  // 2. 分类
  let category: CrossSessionEntry['category'] = 'fact'
  if (/决定|选择|确认|方案|采用/.test(assistantResponse)) category = 'decision'
  else if (/喜欢|偏好|习惯|想要/.test(userMessage)) category = 'preference'
  else if (/发现|规律|关键|本质|根因/.test(assistantResponse)) category = 'insight'
  else if (toolCalls && toolCalls.length >= 3) category = 'task_pattern'
  else if (toolCalls && toolCalls.length >= 2 && /重复|每次|经常|再|又/.test(userMessage)) category = 'skill_candidate'

  // 3. 生成摘要 (取 assistant 回复的前 200 字)
  const summary = assistantResponse.replace(/\n/g, ' ').slice(0, 200).trim()

  // 4. 保存
  saveCrossSessionMemory({
    userId,
    sessionId,
    category,
    summary,
    keywords,
    toolSequence: toolCalls,
  })
}

/** 确保 cross_session_memory 表存在 */
function ensureCrossSessionTable(): void {
  try {
    sqlite.prepare(`CREATE TABLE IF NOT EXISTS cross_session_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'fact',
      summary TEXT NOT NULL,
      keywords TEXT DEFAULT '[]',
      tool_sequence TEXT,
      created_at INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed_at INTEGER DEFAULT 0
    )`).run()

    sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_csm_user ON cross_session_memory(user_id)').run()
    sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_csm_category ON cross_session_memory(user_id, category)').run()
  } catch { /* already exists */ }
}

/** 关键词提取 (复用 reflector 的逻辑) */
function extractKeywords(text: string): string[] {
  const stopwords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '吗', '那', '什么', '怎么', '如何', '为什么', '帮我', '请', '可以', '能不能', 'the', 'is', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'for', 'it', 'on', 'with'])

  const words: string[] = []
  const segments = text.split(/[，。！？、；：""''（）\s,.\-!?;:()[\]{}]+/)
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 8 && !stopwords.has(seg)) {
      words.push(seg)
    }
  }
  return [...new Set(words)].slice(0, 10)
}
