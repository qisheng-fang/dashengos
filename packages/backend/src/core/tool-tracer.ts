// packages/backend/src/core/tool-tracer.ts · DaShengOS v6.0
// 工具调用追踪 + 断点恢复 + Replay 机制
// 2026-06-23

import { sqlite } from '../storage/db.js'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface ToolTrace {
  id: string
  sessionId: string
  userId: string
  iteration: number         // 在 agent loop 中的迭代序号
  stepIndex: number         // 在同一次迭代中的步骤序号
  toolName: string
  toolArgs: Record<string, any>
  result: {
    success: boolean
    data?: string
    error?: string
    durationMs: number
  }
  checkpoint: {
    messagesSnapshot: string  // JSON 序列化的消息列表
    toolCallState: string     // 已执行工具的状态
  }
  timestamp: number
}

export interface ReplayResult {
  originalTrace: ToolTrace
  replayedAt: number
  result: {
    success: boolean
    data?: string
    error?: string
    durationMs: number
  }
  diff?: string  // 与原结果的差异
}

export interface CheckpointSnapshot {
  sessionId: string
  iteration: number
  messagesJson: string
  toolResultsJson: string
  timestamp: number
}

// ═══════════════════════════════════════════════════════════
// DB Schema
// ═══════════════════════════════════════════════════════════

function ensureTraceTable(): void {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS tool_traces (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      step_index INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      tool_args TEXT NOT NULL,
      result_success INTEGER NOT NULL DEFAULT 0,
      result_data TEXT,
      result_error TEXT,
      result_duration_ms INTEGER NOT NULL DEFAULT 0,
      checkpoint_messages TEXT,
      checkpoint_tool_state TEXT,
      timestamp INTEGER NOT NULL
    )
  `).run()
  sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_tt_session ON tool_traces(session_id, iteration)').run()
  sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_tt_tool ON tool_traces(tool_name, timestamp)').run()

  // Checkpoints 表 (独立于 trace，用于恢复)
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS agent_checkpoints (
      session_id TEXT NOT NULL,
      iteration INTEGER NOT NULL,
      messages_json TEXT NOT NULL,
      tool_results_json TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      PRIMARY KEY (session_id, iteration)
    )
  `).run()
}

// ═══════════════════════════════════════════════════════════
// 记录工具调用 Trace
// ═══════════════════════════════════════════════════════════

export function recordToolTrace(opts: {
  sessionId: string
  userId: string
  iteration: number
  stepIndex: number
  toolName: string
  toolArgs: Record<string, any>
  result: { success: boolean; data?: string; error?: string; durationMs: number }
  checkpoint?: { messagesJson: string; toolStateJson: string }
}): void {
  ensureTraceTable()
  const id = `trace_${opts.sessionId}_${opts.iteration}_${opts.stepIndex}_${Date.now()}`
  try {
    sqlite.prepare(`
      INSERT INTO tool_traces (id, session_id, user_id, iteration, step_index, tool_name, tool_args,
        result_success, result_data, result_error, result_duration_ms,
        checkpoint_messages, checkpoint_tool_state, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, opts.sessionId, opts.userId, opts.iteration, opts.stepIndex,
      opts.toolName, JSON.stringify(opts.toolArgs),
      opts.result.success ? 1 : 0, opts.result.data || null, opts.result.error || null,
      opts.result.durationMs,
      opts.checkpoint?.messagesJson || null, opts.checkpoint?.toolStateJson || null,
      Date.now(),
    )
  } catch { /* non-critical */ }
}

// ═══════════════════════════════════════════════════════════
// 保存检查点 (每个迭代结束时)
// ═══════════════════════════════════════════════════════════

export function saveCheckpoint(opts: {
  sessionId: string
  iteration: number
  messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }>
  toolResults: Record<string, { success: boolean; data?: string; error?: string }>
}): void {
  ensureTraceTable()
  try {
    sqlite.prepare(`
      INSERT OR REPLACE INTO agent_checkpoints (session_id, iteration, messages_json, tool_results_json, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      opts.sessionId, opts.iteration,
      JSON.stringify(opts.messages),
      JSON.stringify(opts.toolResults),
      Date.now(),
    )
  } catch { /* non-critical */ }
}

/**
 * 从最近的检查点恢复
 */
export function loadLatestCheckpoint(sessionId: string): CheckpointSnapshot | null {
  ensureTraceTable()
  const row = sqlite.prepare(
    'SELECT * FROM agent_checkpoints WHERE session_id = ? ORDER BY iteration DESC LIMIT 1'
  ).get(sessionId) as any
  if (!row) return null
  return {
    sessionId: row.session_id,
    iteration: row.iteration,
    messagesJson: row.messages_json,
    toolResultsJson: row.tool_results_json,
    timestamp: row.timestamp,
  }
}

// ═══════════════════════════════════════════════════════════
// Replay: 重放已记录的工具调用
// ═══════════════════════════════════════════════════════════

export async function replayToolCall(
  traceId: string,
  executor: (toolName: string, args: Record<string, any>) => Promise<{ success: boolean; data?: string; error?: string }>
): Promise<ReplayResult | null> {
  ensureTraceTable()
  const row = sqlite.prepare('SELECT * FROM tool_traces WHERE id = ?').get(traceId) as any
  if (!row) return null

  const originalTrace: ToolTrace = {
    id: row.id, sessionId: row.session_id, userId: row.user_id,
    iteration: row.iteration, stepIndex: row.step_index,
    toolName: row.tool_name, toolArgs: JSON.parse(row.tool_args || '{}'),
    result: {
      success: !!row.result_success, data: row.result_data, error: row.result_error,
      durationMs: row.result_duration_ms,
    },
    checkpoint: {
      messagesSnapshot: row.checkpoint_messages || '',
      toolCallState: row.checkpoint_tool_state || '',
    },
    timestamp: row.timestamp,
  }

  const t0 = Date.now()
  const newResult = await executor(originalTrace.toolName, originalTrace.toolArgs)
  const durationMs = Date.now() - t0

  const diff = newResult.data !== originalTrace.result.data
    ? `结果变化: 原=${originalTrace.result.data?.slice(0, 100)}, 新=${newResult.data?.slice(0, 100)}`
    : undefined

  return {
    originalTrace,
    replayedAt: Date.now(),
    result: { success: newResult.success, data: newResult.data, error: newResult.error, durationMs },
    diff,
  }
}

/**
 * 批量重放一个会话的所有工具调用
 */
export async function replaySession(
  sessionId: string,
  executor: (toolName: string, args: Record<string, any>) => Promise<{ success: boolean; data?: string; error?: string }>
): Promise<ReplayResult[]> {
  ensureTraceTable()
  const rows = sqlite.prepare(
    'SELECT id FROM tool_traces WHERE session_id = ? ORDER BY iteration ASC, step_index ASC'
  ).all(sessionId) as Array<{ id: string }>

  const results: ReplayResult[] = []
  for (const row of rows) {
    const r = await replayToolCall(row.id, executor)
    if (r) results.push(r)
  }
  return results
}

// ═══════════════════════════════════════════════════════════
// Tracing 查询 (可观测性)
// ═══════════════════════════════════════════════════════════

export function getSessionTraces(sessionId: string, limit = 100): ToolTrace[] {
  ensureTraceTable()
  const rows = sqlite.prepare(
    'SELECT * FROM tool_traces WHERE session_id = ? ORDER BY iteration ASC, step_index ASC LIMIT ?'
  ).all(sessionId, limit) as any[]

  return rows.map(row => ({
    id: row.id, sessionId: row.session_id, userId: row.user_id,
    iteration: row.iteration, stepIndex: row.step_index,
    toolName: row.tool_name, toolArgs: JSON.parse(row.tool_args || '{}'),
    result: {
      success: !!row.result_success, data: row.result_data, error: row.result_error,
      durationMs: row.result_duration_ms,
    },
    checkpoint: {
      messagesSnapshot: row.checkpoint_messages || '',
      toolCallState: row.checkpoint_tool_state || '',
    },
    timestamp: row.timestamp,
  }))
}

export function getToolStats(toolName?: string, hoursBack = 24): {
  totalCalls: number
  successRate: number
  avgDurationMs: number
  p95DurationMs: number
  p99DurationMs: number
} {
  ensureTraceTable()
  const cutoff = Date.now() - hoursBack * 3600000
  let rows: any[]
  if (toolName) {
    rows = sqlite.prepare(
      'SELECT result_success, result_duration_ms FROM tool_traces WHERE tool_name = ? AND timestamp > ?'
    ).all(toolName, cutoff)
  } else {
    rows = sqlite.prepare(
      'SELECT result_success, result_duration_ms FROM tool_traces WHERE timestamp > ?'
    ).all(cutoff)
  }

  if (rows.length === 0) return { totalCalls: 0, successRate: 0, avgDurationMs: 0, p95DurationMs: 0, p99DurationMs: 0 }

  const totalCalls = rows.length
  const successCount = rows.filter(r => r.result_success).length
  const durations = rows.map(r => r.result_duration_ms).sort((a, b) => a - b)
  const avgDurationMs = Math.round(durations.reduce((s, d) => s + d, 0) / totalCalls)
  const p95DurationMs = durations[Math.floor(totalCalls * 0.95)] || durations[durations.length - 1]
  const p99DurationMs = durations[Math.floor(totalCalls * 0.99)] || durations[durations.length - 1]

  return { totalCalls, successRate: Math.round((successCount / totalCalls) * 100), avgDurationMs, p95DurationMs, p99DurationMs }
}

// ═══════════════════════════════════════════════════════════
// Token 预算熔断
// ═══════════════════════════════════════════════════════════

let sessionTokenBudgets = new Map<string, { budget: number; used: number; resetAt: number }>()

export function setTokenBudget(sessionId: string, budget: number, ttlMs: number = 600000) {
  sessionTokenBudgets.set(sessionId, { budget, used: 0, resetAt: Date.now() + ttlMs })
}

export function consumeTokens(sessionId: string, tokens: number): { allowed: boolean; remaining: number; budget: number } {
  const b = sessionTokenBudgets.get(sessionId)
  if (!b) return { allowed: true, remaining: Infinity, budget: Infinity }
  if (Date.now() > b.resetAt) {
    b.used = 0
    b.resetAt = Date.now() + 600000
  }
  b.used += tokens
  return { allowed: b.used <= b.budget, remaining: b.budget - b.used, budget: b.budget }
}

// 定期清理
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of sessionTokenBudgets) {
    if (now > v.resetAt) sessionTokenBudgets.delete(k)
  }
}, 300_000)

console.log('[ToolTracer] 追踪+检查点+Replay+Token熔断 已就绪')
