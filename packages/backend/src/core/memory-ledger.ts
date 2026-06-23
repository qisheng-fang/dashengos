// packages/backend/src/core/memory-ledger.ts · DaShengOS v6.0
// Ledger-Views-Policy — 记忆治理三层架构
// 2026-06-23

import { sqlite } from '../storage/db.js'

// ═══════════════════════════════════════════════════════════
// LAYER 1: LEDGER — 不可变变更账本
// ═══════════════════════════════════════════════════════════

export interface LedgerEntry {
  id: number
  userId: string
  operation: 'create' | 'update' | 'delete' | 'decay' | 'merge' | 'promote'
  targetType: 'memory' | 'profile' | 'preference' | 'fact' | 'decision'
  targetId: string
  oldValue: string | null
  newValue: string | null
  source: string        // 来源: 'user_input' | 'llm_infer' | 'tool_result' | 'auto_decay'
  timestamp: number
}

function ensureLedgerTable(): void {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS memory_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      source TEXT NOT NULL DEFAULT 'system',
      timestamp INTEGER NOT NULL
    )
  `).run()
  sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_ledger_user ON memory_ledger(user_id, timestamp)').run()
  sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_ledger_target ON memory_ledger(target_type, target_id)').run()
}

export function appendLedger(opts: {
  userId: string; operation: LedgerEntry['operation']; targetType: LedgerEntry['targetType']
  targetId: string; oldValue?: string | null; newValue?: string | null; source?: string
}): void {
  ensureLedgerTable()
  sqlite.prepare(`
    INSERT INTO memory_ledger (user_id, operation, target_type, target_id, old_value, new_value, source, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(opts.userId, opts.operation, opts.targetType, opts.targetId, opts.oldValue || null, opts.newValue || null, opts.source || 'system', Date.now())
}

export function getLedgerHistory(userId: string, limit = 50): LedgerEntry[] {
  ensureLedgerTable()
  return sqlite.prepare(
    'SELECT * FROM memory_ledger WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(userId, limit) as LedgerEntry[]
}

// ═══════════════════════════════════════════════════════════
// LAYER 2: VIEWS — 多维度检索视图
// ═══════════════════════════════════════════════════════════

export type ViewDimension = 'category' | 'recency' | 'importance' | 'task_relevance'

export interface ViewQuery {
  userId: string
  dimensions: ViewDimension[]
  category?: string
  daysBack?: number
  minImportance?: number
  topicKeywords?: string[]
  limit?: number
}

export interface ViewResult {
  id: number
  summary: string
  category: string
  keywords: string[]
  score: number           // composite score 0-100
  breakdown: {
    recencyScore: number  // 0-30
    accessScore: number   // 0-30
    importanceScore: number // 0-20
    relevanceScore: number  // 0-20
  }
  createdAt: number
  accessCount: number
}

/**
 * 多维度检索 — 组合评分
 * 
 * 评分公式:
 *   final = recency(30) + access(30) + importance(20) + relevance(20)
 * 
 * recency:   最近7天满分, 线性衰减到90天归零
 * access:    访问>=10次满分, 线性增长
 * importance: 直接从DB字段 (0-1 → 0-20)
 * relevance: 关键词命中率 (0-20)
 */
export function queryMemoryView(query: ViewQuery): ViewResult[] {
  const daysBack = query.daysBack || 90
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000
  const now = Date.now()

  let rows: any[]
  if (query.category) {
    rows = sqlite.prepare(
      `SELECT * FROM cross_session_memory WHERE user_id = ? AND category = ? AND created_at > ? ORDER BY created_at DESC LIMIT 200`
    ).all(query.userId, query.category, cutoff)
  } else {
    rows = sqlite.prepare(
      `SELECT * FROM cross_session_memory WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT 200`
    ).all(query.userId, cutoff)
  }

  const results: ViewResult[] = []
  for (const row of rows) {
    const keywords: string[] = JSON.parse(row.keywords || '[]')
    const ageDays = (now - row.created_at) / (24 * 60 * 60 * 1000)

    // Recency: 7天满分, 线性衰减
    const recencyScore = Math.max(0, 30 * (1 - Math.min(ageDays, 90) / 90))
    
    // Access: >=10满分
    const accessScore = Math.min(30, (row.access_count || 0) * 3)
    
    // Importance: from cross_session_memory (estimated 0-1 → 0-20)
    const importanceScore = Math.min(20, (row.importance || 0.5) * 20)
    
    // Relevance: keyword match
    let relevanceScore = 10 // baseline
    if (query.topicKeywords && query.topicKeywords.length > 0) {
      const hits = query.topicKeywords.filter(k => 
        keywords.some(kw => kw.includes(k) || k.includes(kw))
      ).length
      relevanceScore = Math.min(20, hits / Math.max(1, query.topicKeywords.length) * 20)
    }

    const score = recencyScore + accessScore + importanceScore + relevanceScore

    if (!query.minImportance || score >= query.minImportance) {
      results.push({
        id: row.id,
        summary: row.summary,
        category: row.category,
        keywords,
        score: Math.round(score * 10) / 10,
        breakdown: { recencyScore: Math.round(recencyScore*10)/10, accessScore: Math.round(accessScore*10)/10, importanceScore: Math.round(importanceScore*10)/10, relevanceScore: Math.round(relevanceScore*10)/10 },
        createdAt: row.created_at,
        accessCount: row.access_count || 0,
      })
    }
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, query.limit || 10)
}

// ═══════════════════════════════════════════════════════════
// LAYER 3: POLICY — 记忆治理策略
// ═══════════════════════════════════════════════════════════

/**
 * 衰减策略: 根据访问频率和时效性重新计算记忆的保留权重
 * 返回建议操作: keep / decay / archive / delete
 */
export function evaluateRetentionPolicy(entry: {
  id: number; createdAt: number; accessCount: number; importance: number
}): { action: 'keep' | 'decay' | 'archive' | 'delete'; score: number; reason: string } {
  const ageDays = (Date.now() - entry.createdAt) / (24 * 60 * 60 * 1000)
  
  // Hot: <7天 → keep
  if (ageDays < 7) return { action: 'keep', score: 100, reason: '近期记忆' }
  
  // Warm: 7-30天 + 高访问 → keep; 低访问 → decay
  if (ageDays < 30) {
    if (entry.accessCount >= 3) return { action: 'keep', score: 80, reason: '温记忆+高访问' }
    return { action: 'decay', score: 60, reason: '温记忆+低访问' }
  }
  
  // Cool: 30-90天 → decay or archive
  if (ageDays < 90) {
    if (entry.accessCount >= 5) return { action: 'keep', score: 50, reason: '冷记忆+高访问' }
    if (entry.importance > 0.7) return { action: 'archive', score: 30, reason: '冷记忆+高重要性→归档' }
    return { action: 'decay', score: 20, reason: '冷记忆+低重要性' }
  }
  
  // Cold: >90天 → archive or delete
  if (entry.importance > 0.5) return { action: 'archive', score: 10, reason: '旧记忆+中重要性→归档' }
  return { action: 'delete', score: 0, reason: '过期记忆' }
}

/**
 * 冲突解决策略: 当新旧事实/偏好冲突时
 * 规则: 新值覆盖旧值, 除非旧值标记为 pinned
 * 返回: { resolved: true/false, winner: 'new'|'old', reason }
 */
export function resolveConflict(
  newFact: { content: string; confidence: number; source: string; timestamp: number },
  oldFact: { content: string; confidence: number; pinned: boolean; timestamp: number }
): { winner: 'new' | 'old' | 'merge'; reason: string } {
  // Pinned 记忆不可覆盖
  if (oldFact.pinned) return { winner: 'old', reason: '旧记忆已锁定(pinned)' }
  
  // 新事实 confidence > 旧事实 → 覆盖
  if (newFact.confidence > oldFact.confidence + 0.2) return { winner: 'new', reason: '新事实置信度显著更高' }
  
  // 时间差 <1小时 且 置信度相近 → merge
  const timeDiff = Math.abs(newFact.timestamp - oldFact.timestamp)
  if (timeDiff < 3600000 && Math.abs(newFact.confidence - oldFact.confidence) < 0.2) {
    return { winner: 'merge', reason: '时间接近+置信度相近→合并' }
  }
  
  // 默认: 新覆盖旧
  return { winner: 'new', reason: '新事实覆盖旧事实(默认规则)' }
}

/**
 * 上下文注入优先级: 从记忆池中选出最优N条注入system prompt
 */
export function selectContextInjection(
  userId: string,
  currentTopic: string,
  maxItems = 5
): ViewResult[] {
  const topicKeywords = currentTopic.split(/[\s,，。！？]+/).filter(k => k.length >= 2)
  return queryMemoryView({
    userId,
    dimensions: ['recency', 'importance', 'task_relevance'],
    topicKeywords,
    limit: maxItems,
    daysBack: 60,
  })
}

/**
 * 定期维护: 清理过期记忆, 更新衰减状态
 */
export function runMemoryMaintenance(userId: string): { decayed: number; archived: number; deleted: number } {
  const rows = sqlite.prepare(
    'SELECT id, created_at, access_count, keywords FROM cross_session_memory WHERE user_id = ?'
  ).all(userId) as Array<{ id: number; created_at: number; access_count: number; keywords: string }>

  let decayed = 0, archived = 0, deleted = 0
  for (const row of rows) {
    const kw = JSON.parse(row.keywords || '[]')
    const importance = kw.length > 0 ? Math.min(1, kw.length / 10) : 0.3
    const policy = evaluateRetentionPolicy({ id: row.id, createdAt: row.created_at, accessCount: row.access_count, importance })
    
    if (policy.action === 'decay') {
      // 降低访问计数 (模拟热度衰减)
      sqlite.prepare('UPDATE cross_session_memory SET access_count = MAX(0, access_count - 1) WHERE id = ?').run(row.id)
      decayed++
      appendLedger({ userId, operation: 'decay', targetType: 'memory', targetId: String(row.id), oldValue: `access_count=${row.access_count}`, newValue: `access_count=${Math.max(0, row.access_count - 1)}`, source: 'auto_decay' })
    } else if (policy.action === 'delete') {
      sqlite.prepare('DELETE FROM cross_session_memory WHERE id = ?').run(row.id)
      deleted++
      appendLedger({ userId, operation: 'delete', targetType: 'memory', targetId: String(row.id), oldValue: 'exists', newValue: null, source: 'auto_decay' })
    }
  }

  return { decayed, archived, deleted }
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
ensureLedgerTable()
console.log('[MemoryLedger] Ledger-Views-Policy 三层已就绪')
