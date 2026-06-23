// packages/backend/src/core/self-evolve.ts · DaShengOS v5.2
// 自主学习进化引擎 — Strategy Learning + Error Pattern Recognition + Skill Auto-Generation
// 2026-06-21 · 让 AI 越用越强

import { sqlite } from '../storage/db.js'
import { randomUUID } from 'node:crypto'

// ─── Types ─────────────────────────────────────────────────

export interface EvolutionRecord {
  id: string
  session_id: string
  strategy: string        // 采用的策略名称
  tool_sequence: string[] // 工具调用序列
  success: boolean
  latency_ms: number
  error_pattern?: string  // 如果失败，错误模式
  learned_insight?: string // 学到的经验
  score_delta: number     // 对进化评分的贡献
  timestamp: number
}

export interface StrategyPattern {
  id: string
  name: string
  description: string
  tool_sequence: string[]
  success_rate: number    // 0-1
  use_count: number
  avg_latency_ms: number
  recommended_for: string[] // 适用场景关键词
  evolved_from?: string   // 从哪个 pattern 进化而来
  generation: number      // 进化代数
}

export interface ErrorPattern {
  pattern: string         // 错误模式正则
  category: string        // 'tool_failure' | 'llm_timeout' | 'api_error' | 'parse_error'
  occurrence_count: number
  known_fixes: string[]   // 已知修复方案
  auto_fix_success_rate: number
  last_seen: number
}

export interface EvolutionMetrics {
  total_sessions: number
  total_tool_calls: number
  success_rate: number
  avg_latency_ms: number
  strategies_learned: number
  error_patterns_recognized: number
  evolution_score: number  // 0-100, 综合进化评分
  generation: number
  last_evolved: number
}

// ─── Database Init ─────────────────────────────────────────

const EVOLVE_SCHEMA = `
CREATE TABLE IF NOT EXISTS evolution_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  tool_sequence_json TEXT NOT NULL DEFAULT '[]',
  success INTEGER NOT NULL DEFAULT 1,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  error_pattern TEXT,
  learned_insight TEXT,
  score_delta REAL NOT NULL DEFAULT 0,
  timestamp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  tool_sequence_json TEXT NOT NULL DEFAULT '[]',
  success_rate REAL NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  recommended_for_json TEXT NOT NULL DEFAULT '[]',
  evolved_from TEXT,
  generation INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS error_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  known_fixes_json TEXT NOT NULL DEFAULT '[]',
  auto_fix_success_rate REAL NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS evolution_metrics (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  total_sessions INTEGER NOT NULL DEFAULT 0,
  total_tool_calls INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 1,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  strategies_learned INTEGER NOT NULL DEFAULT 0,
  error_patterns_recognized INTEGER NOT NULL DEFAULT 0,
  evolution_score REAL NOT NULL DEFAULT 50,
  generation INTEGER NOT NULL DEFAULT 1,
  last_evolved INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO evolution_metrics (id, last_evolved) VALUES (1, 0);
`

export function initEvolutionDB(): void {
  for (const stmt of EVOLVE_SCHEMA.split(';').filter(s => s.trim())) {
    try { sqlite.exec(stmt + ';') } catch { /* table exists */ }
  }
}

// ─── Core Evolution Logic ──────────────────────────────────

/**
 * 记录一次交互，学习策略模式
 */
export function recordEvolution(opts: {
  sessionId: string
  strategy: string
  toolSequence: string[]
  success: boolean
  latencyMs: number
  errorMessage?: string
}): EvolutionRecord {
  const id = `ev_${Date.now()}_${randomUUID().slice(0, 8)}`

  // 分析错误模式
  let errorPattern = ''
  let learnedInsight = ''

  if (!opts.success && opts.errorMessage) {
    errorPattern = classifyError(opts.errorMessage)
    learnedInsight = generateInsight(opts.strategy, opts.toolSequence, errorPattern)
    learnErrorPattern(errorPattern)
  }

  // 计算 score_delta
  const scoreDelta = opts.success
    ? (opts.latencyMs < 5000 ? 2 : 1) * (opts.toolSequence.length > 1 ? 1.5 : 1)
    : -1

  // 存储记录
  sqlite.prepare(`
    INSERT INTO evolution_records (id, session_id, strategy, tool_sequence_json, success, latency_ms, error_pattern, learned_insight, score_delta, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, opts.sessionId, opts.strategy, JSON.stringify(opts.toolSequence),
    opts.success ? 1 : 0, opts.latencyMs, errorPattern || null, learnedInsight || null, scoreDelta, Date.now())

  // 更新策略模式
  if (opts.success) {
    updateStrategyPattern(opts.strategy, opts.toolSequence, opts.latencyMs)
  }

  // 更新全局指标
  updateGlobalMetrics(scoreDelta)

  return {
    id, session_id: opts.sessionId, strategy: opts.strategy,
    tool_sequence: opts.toolSequence, success: opts.success,
    latency_ms: opts.latencyMs, error_pattern: errorPattern,
    learned_insight: learnedInsight, score_delta: scoreDelta,
    timestamp: Date.now(),
  }
}

/**
 * 获取最优策略推荐
 */
export function recommendStrategy(userMessage: string): {
  strategy: StrategyPattern | null
  confidence: number
  reason: string
} {
  const patterns = sqlite.prepare(`
    SELECT * FROM strategy_patterns WHERE success_rate > 0.5 ORDER BY success_rate DESC, use_count DESC LIMIT 10
  `).all() as any[]

  if (patterns.length === 0) {
    return { strategy: null, confidence: 0, reason: '无历史策略数据' }
  }

  // 关键词匹配
  const msg = userMessage.toLowerCase()
  let best: any = null
  let bestScore = 0

  for (const p of patterns) {
    const recFor: string[] = JSON.parse(p.recommended_for_json || '[]')
    const matches = recFor.filter((kw: string) => msg.includes(kw.toLowerCase())).length
    const score = matches * 3 + p.success_rate * 5 + Math.log10(p.use_count + 1)
    if (score > bestScore) { bestScore = score; best = p }
  }

  if (!best) {
    // 回退到成功率最高的
    best = patterns[0]
    bestScore = best.success_rate * 3
  }

  return {
    strategy: best ? {
      id: best.id, name: best.name, description: best.description,
      tool_sequence: JSON.parse(best.tool_sequence_json),
      success_rate: best.success_rate, use_count: best.use_count,
      avg_latency_ms: best.avg_latency_ms,
      recommended_for: JSON.parse(best.recommended_for_json),
      evolved_from: best.evolved_from, generation: best.generation,
    } : null,
    confidence: Math.min(bestScore / 20, 1),
    reason: best ? `匹配策略: ${best.name} (成功率 ${(best.success_rate * 100).toFixed(0)}%)` : '无匹配策略',
  }
}

/**
 * 获取已知错误模式的修复方案
 */
export function getErrorFix(errorMessage: string): string | null {
  const patterns = sqlite.prepare(`
    SELECT pattern, known_fixes_json, auto_fix_success_rate FROM error_patterns
    WHERE auto_fix_success_rate > 0.3 ORDER BY occurrence_count DESC
  `).all() as any[]

  for (const ep of patterns) {
    try {
      if (new RegExp(ep.pattern, 'i').test(errorMessage)) {
        const fixes: string[] = JSON.parse(ep.known_fixes_json || '[]')
        return fixes[0] || null
      }
    } catch { /* invalid regex */ }
  }
  return null
}

/**
 * 获取进化指标
 */
export function getEvolutionMetrics(): EvolutionMetrics {
  const row = sqlite.prepare('SELECT * FROM evolution_metrics WHERE id = 1').get() as any
  if (!row) {
    return {
      total_sessions: 0, total_tool_calls: 0, success_rate: 1,
      avg_latency_ms: 0, strategies_learned: 0, error_patterns_recognized: 0,
      evolution_score: 50, generation: 1, last_evolved: 0,
    }
  }
  return {
    total_sessions: row.total_sessions,
    total_tool_calls: row.total_tool_calls,
    success_rate: row.success_rate,
    avg_latency_ms: row.avg_latency_ms,
    strategies_learned: row.strategies_learned,
    error_patterns_recognized: row.error_patterns_recognized,
    evolution_score: row.evolution_score,
    generation: row.generation,
    last_evolved: row.last_evolved,
  }
}

/**
 * 触发进化 — 基于积累的经验优化策略
 */
export async function triggerEvolution(): Promise<{
  evolved: boolean
  new_patterns: number
  pruned_patterns: number
  generation: number
}> {
  const metrics = getEvolutionMetrics()
  const newGeneration = metrics.generation + 1

  // 1. 分析最近 100 条记录，发现新模式
  const recentRecords = sqlite.prepare(`
    SELECT strategy, tool_sequence_json, success FROM evolution_records
    ORDER BY timestamp DESC LIMIT 100
  `).all() as any[]

  const strategyMap = new Map<string, { successes: number; failures: number; toolSeq: string[] }>()
  for (const r of recentRecords) {
    const key = r.strategy
    if (!strategyMap.has(key)) {
      strategyMap.set(key, { successes: 0, failures: 0, toolSeq: JSON.parse(r.tool_sequence_json) })
    }
    const s = strategyMap.get(key)!
    if (r.success) {
      s.successes = s.successes + 1
    } else {
      s.failures = s.failures + 1
    }
  }

  // 2. 发现成功率 >70% 的新策略并保存
  let newPatterns = 0
  for (const [name, stats] of strategyMap) {
    const total = stats.successes + stats.failures
    if (total < 3) continue
    const rate = stats.successes / total
    if (rate > 0.7) {
      const exists = sqlite.prepare('SELECT id FROM strategy_patterns WHERE name = ?').get(name)
      if (!exists) {
        // 提取关键词
        const keywords = extractKeywords(name, stats.toolSeq)
        sqlite.prepare(`
          INSERT INTO strategy_patterns (id, name, description, tool_sequence_json, success_rate, use_count, avg_latency_ms, recommended_for_json, generation)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `sp_${Date.now()}_${randomUUID().slice(0, 8)}`, name,
          `自动发现的策略: ${name}`, JSON.stringify(stats.toolSeq),
          rate, total, 0, JSON.stringify(keywords), newGeneration,
        )
        newPatterns++
      }
    }
  }

  // 3. 清理成功率 <30% 的低效策略
  const pruned = sqlite.prepare(`
    DELETE FROM strategy_patterns WHERE success_rate < 0.3 AND use_count > 10
  `).run()

  // 4. 自创技能 — 将高成功率策略转为 SKILL.md
  let skillsCreated = 0
  try {
    const { generateSkillFromPattern } = await import('./harness/skill-discovery')
    const highPerformers = sqlite.prepare(`
      SELECT name, tool_sequence_json, success_rate, use_count FROM strategy_patterns
      WHERE success_rate > 0.7 AND use_count >= 3
    `).all() as any[]
    
    for (const sp of highPerformers) {
      const toolSeq: string[] = JSON.parse(sp.tool_sequence_json)
      if (toolSeq.length >= 2) {
        const pattern = {
          signature: toolSeq.join('→'),
          frequency: sp.use_count,
          toolSequence: toolSeq,
          recentIntents: [sp.name],
          firstSeen: Date.now() - 86400000,
          lastSeen: Date.now(),
          isWorkflow: toolSeq.length >= 3,
        }
        const result = generateSkillFromPattern(pattern)
        if (result.success) skillsCreated++
      }
    }
  } catch { /* skill generation non-critical */ }

  // 5. 更新指标
  const strategyCount = (sqlite.prepare('SELECT COUNT(*) as c FROM strategy_patterns').get() as any)?.c || 0
  const errorCount = (sqlite.prepare('SELECT COUNT(*) as c FROM error_patterns').get() as any)?.c || 0
  const newScore = Math.min(50 + strategyCount * 3 + errorCount * 2 + metrics.success_rate * 20, 100)

  sqlite.prepare(`
    UPDATE evolution_metrics SET
      strategies_learned = ?, error_patterns_recognized = ?,
      evolution_score = ?, generation = ?, last_evolved = ?
    WHERE id = 1
  `).run(strategyCount, errorCount, newScore, newGeneration, Date.now())

  return {
    evolved: newPatterns > 0 || skillsCreated > 0,
    new_patterns: newPatterns,
    pruned_patterns: pruned.changes,
    generation: newGeneration,
  }
}

// ─── Internal Helpers ──────────────────────────────────────

function classifyError(errorMsg: string | undefined): string {
  const m = (errorMsg || '').toLowerCase()
  if (m.includes('timeout') || m.includes('timed out')) return 'llm_timeout'
  if (m.includes('unauthorized') || m.includes('401') || m.includes('403')) return 'api_auth'
  if (m.includes('rate limit') || m.includes('429')) return 'rate_limit'
  if (m.includes('parse') || m.includes('json') || m.includes('syntax')) return 'parse_error'
  if (m.includes('not found') || m.includes('404') || m.includes('enoent')) return 'resource_missing'
  if (m.includes('command') || m.includes('exec')) return 'tool_failure'
  if (m.includes('network') || m.includes('econnrefused') || m.includes('dns')) return 'network_error'
  return 'unknown_error'
}

function generateInsight(strategy: string, toolSeq: string[], errorPattern: string): string {
  if (errorPattern === 'llm_timeout') return `策略 ${strategy} 遇到超时，建议增加超时或减少工具调用数`
  if (errorPattern === 'tool_failure') return `工具序列 ${toolSeq.join('→')} 中某步失败，建议添加前置检查`
  if (errorPattern === 'parse_error') return `数据格式问题，建议增加格式验证步骤`
  return `策略 ${strategy} 遇到 ${errorPattern}，已记录`
}

function learnErrorPattern(pattern: string): void {
  const exists = sqlite.prepare('SELECT id, occurrence_count FROM error_patterns WHERE pattern = ?').get(pattern) as any
  if (exists) {
    sqlite.prepare('UPDATE error_patterns SET occurrence_count = occurrence_count + 1, last_seen = ? WHERE id = ?')
      .run(Date.now(), exists.id)
  } else {
    const fixes = suggestFixes(pattern)
    sqlite.prepare(`
      INSERT INTO error_patterns (pattern, category, occurrence_count, known_fixes_json, last_seen)
      VALUES (?, ?, 1, ?, ?)
    `).run(pattern, pattern.includes('timeout') ? 'llm_timeout' : 'tool_failure', JSON.stringify(fixes), Date.now())
  }
}

function suggestFixes(errorPattern: string): string[] {
  switch (errorPattern) {
    case 'llm_timeout': return ['增加超时时间到 180s', '减少 max_tokens', '切换更快的模型']
    case 'rate_limit': return ['等待 60s 重试', '切换到备用 provider', '减少并发请求']
    case 'api_auth': return ['检查 API key 是否过期', '验证 provider 配置', '检查账户余额']
    case 'network_error': return ['检查网络连接', '切换 DNS', '重试 3 次']
    case 'tool_failure': return ['检查命令语法', '确认工具可用性', '运行 quickHealthCheck']
    case 'parse_error': return ['验证 JSON 格式', '添加 try-catch', '使用 schema 验证']
    default: return ['运行 quickHealthCheck', '重试操作', '检查日志']
  }
}

function updateStrategyPattern(strategy: string, toolSeq: string[], latencyMs: number): void {
  const exists = sqlite.prepare('SELECT id, use_count, success_rate, avg_latency_ms FROM strategy_patterns WHERE name = ?').get(strategy) as any
  if (exists) {
    const newCount = exists.use_count + 1
    const newRate = (exists.success_rate * exists.use_count + 1) / newCount
    const newLatency = (exists.avg_latency_ms * exists.use_count + latencyMs) / newCount
    sqlite.prepare(`
      UPDATE strategy_patterns SET use_count = ?, success_rate = ?, avg_latency_ms = ?
      WHERE id = ?
    `).run(newCount, newRate, newLatency, exists.id)
  } else {
    const keywords = extractKeywords(strategy, toolSeq)
    sqlite.prepare(`
      INSERT INTO strategy_patterns (id, name, description, tool_sequence_json, success_rate, use_count, avg_latency_ms, recommended_for_json)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    `).run(`sp_${Date.now()}_${randomUUID().slice(0, 8)}`, strategy,
      `自动学习策略: ${strategy}`, JSON.stringify(toolSeq), latencyMs, JSON.stringify(keywords))
  }
}

function updateGlobalMetrics(scoreDelta: number): void {
  const row = sqlite.prepare('SELECT * FROM evolution_metrics WHERE id = 1').get() as any
  if (!row) return

  const newScore = Math.min(100, Math.max(0, row.evolution_score + scoreDelta))
  sqlite.prepare(`
    UPDATE evolution_metrics SET
      total_sessions = total_sessions + 1,
      evolution_score = ?,
      last_evolved = ?
    WHERE id = 1
  `).run(newScore, Date.now())
}

function extractKeywords(strategy: string, toolSeq: string[]): string[] {
  const keywords: string[] = []
  const all = [strategy, ...toolSeq].join(' ').toLowerCase()
  const kwList = ['搜索', 'search', '报告', 'report', '分析', 'analysis', '代码', 'code',
    '诊断', 'diagnose', '文件', 'file', '命令', 'command', '修复', 'fix', '部署', 'deploy']
  for (const kw of kwList) {
    if (all.includes(kw)) keywords.push(kw)
  }
  return keywords.slice(0, 5)
}
