// packages/backend/src/core/memory-consolidator.ts · DaShengOS v8.2
// 自动记忆反思整理 — 对标 Hermes RAG + 反思循环
// Daily/weekly cleanup, auto-summarize, contradiction resolution
// 2026-06-28

import { sqlite } from '../storage/db.js'
import { decayEntities, extractFromConversation } from './memory-graph.js'
import { config } from '../config.js'

// Types
export interface ConsolidationResult {
  timestamp: string
  mode: 'daily' | 'weekly' | 'manual'
  actions: ConsolidationAction[]
  stats: {
    sessionsProcessed: number
    memoriesConsolidated: number
    entitiesExtracted: number
    relationsCreated: number
    staleCleaned: number
    contradictionsFound: number
    contradictionsResolved: number
  }
}

export interface ConsolidationAction {
  type: 'summarize' | 'tag' | 'decay' | 'resolve_contradiction' | 'extract_entities' | 'cleanup'
  detail: string
  affectedIds: string[]
}

// Daily consolidation: process today's sessions into compact memory
export async function dailyConsolidation(userId: string): Promise<ConsolidationResult> {
  const actions: ConsolidationAction[] = []
  let sessionsProcessed = 0
  let memoriesConsolidated = 0
  let entitiesExtracted = 0
  let relationsCreated = 0
  let staleCleaned = 0

  // 1. Find sessions from last 24 hours with > 3 messages
  const recentSessions = sqlite.prepare(`
    SELECT s.id, s.title, COUNT(m.id) as msg_count,
           GROUP_CONCAT(m.content, ' | ') as all_messages
    FROM sessions s
    JOIN messages m ON m.session_id = s.id
    WHERE s.user_id = ? AND s.created_at > datetime('now', '-1 day')
    GROUP BY s.id HAVING msg_count >= 3
    LIMIT 20
  `).all(userId) as any[]

  for (const sess of recentSessions) {
    sessionsProcessed++

    // Extract entities from conversation
    try {
      const text = (sess.all_messages || '').slice(0, 5000)
      if (text.length > 100) {
        const extracted = extractFromConversation(userId, text, 'session:' + sess.id)
        entitiesExtracted += extracted.entities.length
        relationsCreated += extracted.relations.length
        if (extracted.entities.length > 0) {
          actions.push({ type: 'extract_entities', detail: 'Session ' + sess.id + ': ' + extracted.entities.length + ' entities, ' + extracted.relations.length + ' relations', affectedIds: extracted.entities })
        }
      }
    } catch { /* non-critical */ }

    // Generate summary for sessions with many messages
    if (sess.msg_count >= 8) {
      try {
        const summary = await generateSummary(sess.all_messages.slice(0, 3000))
        // Store as memory_summaries
        sqlite.prepare(`
          INSERT OR REPLACE INTO memory_summaries (id, user_id, session_id, summary, keywords, embedding, importance, source, created_at)
          VALUES (?, ?, ?, ?, ?, NULL, ?, 'auto_consolidation', datetime('now'))
        `).run(
          'sum_' + sess.id, userId, sess.id, summary,
          extractKeywords(summary).join(','), Math.min(1, sess.msg_count / 20)
        )
        memoriesConsolidated++
        actions.push({ type: 'summarize', detail: 'Session ' + sess.id + ': ' + sess.msg_count + ' msgs → summary', affectedIds: [sess.id] })
      } catch { /* non-critical */ }
    }
  }

  // 2. Decay old entities
  staleCleaned = decayEntities(userId, 14)
  if (staleCleaned > 0) {
    actions.push({ type: 'decay', detail: staleCleaned + ' stale entities decayed', affectedIds: [] })
  }

  return {
    timestamp: new Date().toISOString(),
    mode: 'daily',
    actions,
    stats: { sessionsProcessed, memoriesConsolidated, entitiesExtracted, relationsCreated, staleCleaned, contradictionsFound: 0, contradictionsResolved: 0 },
  }
}

// Weekly reflection: find contradictions, resolve stale memories
export async function weeklyConsolidation(userId: string): Promise<ConsolidationResult> {
  const actions: ConsolidationAction[] = []
  let contradictionsFound = 0
  let contradictionsResolved = 0

  // 1. Find contradictory memories (same keyword, different sentiment/value)
  const mems = sqlite.prepare(`
    SELECT id, summary, keywords FROM memory_summaries 
    WHERE user_id = ? AND created_at > datetime('now', '-7 days')
    ORDER BY created_at DESC LIMIT 100
  `).all(userId) as any[]

  // Group by keyword overlap → detect contradictions
  const keywordMap = new Map<string, Array<{ id: string; summary: string }>>()
  for (const m of mems) {
    const kws = (m.keywords || '').split(',').map((k: string) => k.trim()).filter(Boolean)
    for (const kw of kws) {
      if (!keywordMap.has(kw)) keywordMap.set(kw, [])
      keywordMap.get(kw)!.push({ id: m.id, summary: m.summary })
    }
  }

  // Check each keyword group for contradictions
  for (const [kw, entries] of keywordMap) {
    if (entries.length < 2) continue
    contradictionsFound++

    // Try to resolve via LLM
    try {
      const resolution = await resolveContradiction(kw, entries.map(e => e.summary))
      if (resolution.resolved) {
        // Keep the most recent, mark others as superseded
        for (let i = 1; i < entries.length; i++) {
          sqlite.prepare('UPDATE memory_summaries SET importance = importance * 0.3 WHERE id = ?').run(entries[i].id)
        }
        contradictionsResolved++
        actions.push({ type: 'resolve_contradiction', detail: 'Keyword "' + kw + '": ' + entries.length + ' entries → resolved', affectedIds: entries.map(e => e.id) })
      }
    } catch { /* non-critical */ }
  }

  // 2. Aggressive decay for old memories
  const staleCleaned = decayEntities(userId, 30)
  if (staleCleaned > 0) {
    actions.push({ type: 'decay', detail: staleCleaned + ' old entities decayed (30d)', affectedIds: [] })
  }

  // 3. Clean up very old memory_summaries (keep important ones)
  void sqlite.prepare(`
    DELETE FROM memory_summaries 
    WHERE user_id = ? AND created_at < datetime('now', '-30 days') AND importance < 0.3
  `).run(userId)

  return {
    timestamp: new Date().toISOString(),
    mode: 'weekly',
    actions,
    stats: { sessionsProcessed: 0, memoriesConsolidated: 0, entitiesExtracted: 0, relationsCreated: 0, staleCleaned, contradictionsFound, contradictionsResolved },
  }
}

// Manual trigger: run full consolidation
export async function fullConsolidation(userId: string): Promise<ConsolidationResult> {
  const daily = await dailyConsolidation(userId)
  const weekly = await weeklyConsolidation(userId)

  return {
    timestamp: new Date().toISOString(),
    mode: 'manual',
    actions: [...daily.actions, ...weekly.actions],
    stats: {
      sessionsProcessed: daily.stats.sessionsProcessed,
      memoriesConsolidated: daily.stats.memoriesConsolidated,
      entitiesExtracted: daily.stats.entitiesExtracted,
      relationsCreated: daily.stats.relationsCreated,
      staleCleaned: daily.stats.staleCleaned + weekly.stats.staleCleaned,
      contradictionsFound: weekly.stats.contradictionsFound,
      contradictionsResolved: weekly.stats.contradictionsResolved,
    },
  }
}

// LLM-powered summary generation
async function generateSummary(text: string): Promise<string> {
  const apiKey = config.SILICONFLOW_API_KEY
  if (!apiKey) return extractKeywords(text).join(', ')

  try {
    const resp = await fetch(config.SILICONFLOW_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'Summarize the following conversation into 2-3 sentences. Extract key facts, decisions, and action items. Output ONLY the summary text.' },
          { role: 'user', content: text.slice(0, 3000) },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return extractKeywords(text).join(', ')
    const data = await resp.json() as any
    return data.choices?.[0]?.message?.content || extractKeywords(text).join(', ')
  } catch {
    return extractKeywords(text).join(', ')
  }
}

// LLM-powered contradiction resolution
async function resolveContradiction(keyword: string, summaries: string[]): Promise<{ resolved: boolean; reasoning: string }> {
  const apiKey = config.SILICONFLOW_API_KEY
  if (!apiKey || summaries.length < 2) return { resolved: false, reasoning: 'No API key or insufficient entries' }

  try {
    const resp = await fetch(config.SILICONFLOW_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'You are checking for contradictions between memory entries about the same topic. If the entries genuinely contradict each other, respond "CONTRADICTION: <explanation>". If they are different perspectives or time periods, respond "COMPATIBLE: <explanation>".' },
          { role: 'user', content: 'Topic: ' + keyword + '\n\n' + summaries.map((s, i) => 'Entry ' + (i + 1) + ': ' + s).join('\n\n') },
        ],
        max_tokens: 200,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return { resolved: false, reasoning: 'API error' }
    const data = await resp.json() as any
    const answer = data.choices?.[0]?.message?.content || ''
    return { resolved: answer.startsWith('CONTRADICTION'), reasoning: answer }
  } catch {
    return { resolved: false, reasoning: 'LLM call failed' }
  }
}

function extractKeywords(text: string): string[] {
  const words = text.split(/[\s,，。！？、；：""''（）]+/)
    .filter(w => w.length >= 2 && w.length <= 10)
    .filter(w => !['the', 'and', 'for', 'this', 'that', 'with', 'from', 'have', 'been', 'were', 'would', 'could', 'should', 'about', '也是', '一个', '这个', '那个', '我们', '他们'].includes(w.toLowerCase()))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([w]) => w)
}

// Initialize consolidation tables
export function initConsolidationTables(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS consolidation_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      stats TEXT DEFAULT '{}',
      actions TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_consolidation_user ON consolidation_log(user_id);
  `)
}

// Log consolidation result
export function logConsolidation(userId: string, result: ConsolidationResult): void {
  initConsolidationTables()
  sqlite.prepare(`
    INSERT INTO consolidation_log (id, user_id, mode, stats, actions, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(
    'con_' + Date.now().toString(36), userId, result.mode,
    JSON.stringify(result.stats), JSON.stringify(result.actions)
  )
}

console.log('[MemoryConsolidator] Auto-consolidation module loaded (daily + weekly + contradiction resolution)')
