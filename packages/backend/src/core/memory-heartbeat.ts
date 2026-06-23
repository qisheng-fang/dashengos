// packages/backend/src/core/memory-heartbeat.ts
// DaShengOS v6.0 — Memory Heartbeat: SQLite integrity + decay + size monitor
// 2026-06-23 · 30s 自检周期，异常自动修复

import { sqlite } from '../storage/db.js'

// ─── Types ────────────────────────────────────────────────

export interface MemoryHealthReport {
  timestamp: number
  healthy: boolean
  sqliteIntegrity: { ok: boolean; error?: string }
  tablesExist: { ok: boolean; missing: string[] }
  decayStatus: { ok: boolean; decayedCount: number; error?: string }
  tableSizes: { ok: boolean; rows: Record<string, number>; warnings: string[] }
}

// Core tables that MUST exist (created by memory.ts on first run)
const REQUIRED_TABLES = [
  'sessions',
  'messages',
]

// Tables lazily created by modules on first use — warn only
const LAZY_TABLES = [
  'cross_session_memory',
  'memory_ledger',
  'memory_embeddings',
  'dynamic_user_profiles',
  'memory_summaries',
]

const TABLE_SIZE_WARN = 100_000   // warn if any table exceeds 100k rows

let heartbeatInterval: ReturnType<typeof setInterval> | null = null
let lastReport: MemoryHealthReport | null = null

// ─── Integrity Check ─────────────────────────────────────

function checkIntegrity(): { ok: boolean; error?: string } {
  try {
    const row = sqlite.prepare('PRAGMA integrity_check').get() as any
    const result = row?.integrity_check || ''
    if (result === 'ok') return { ok: true }
    return { ok: false, error: result }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

// ─── Table Existence ─────────────────────────────────────

function checkTables(): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  try {
    for (const table of REQUIRED_TABLES) {
      const row = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table)
      if (!row) missing.push(table)
    }
    // Lazy tables: warn only, don't fail health check
    for (const table of LAZY_TABLES) {
      const row = sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(table)
      if (!row) console.log('[MemoryHeartbeat] Lazy table not yet created:', table)
    }
    return { ok: missing.length === 0, missing }
  } catch (e: any) {
    return { ok: false, missing: ['error: ' + e.message] }
  }
}

// ─── Memory Decay ────────────────────────────────────────

function runDecay(): { ok: boolean; decayedCount: number; error?: string } {
  try {
    // Decay access_count for all entries (aging)
    const aged = sqlite.prepare(
      'UPDATE cross_session_memory SET access_count = MAX(0, access_count - 1) WHERE access_count > 0'
    ).run()
    
    // Delete entries that have decayed to zero AND are older than 7 days
    const deleted = sqlite.prepare(
      "DELETE FROM cross_session_memory WHERE access_count = 0 AND last_accessed_at < ?"
    ).run(Date.now() - 7 * 86400_000)
    
    return { ok: true, decayedCount: (aged.changes || 0) + (deleted.changes || 0) }
  } catch (e: any) {
    return { ok: false, decayedCount: 0, error: e.message }
  }
}

// ─── Table Size Monitor ──────────────────────────────────

function checkSizes(): { ok: boolean; rows: Record<string, number>; warnings: string[] } {
  const rows: Record<string, number> = {}
  const warnings: string[] = []
  try {
    for (const table of REQUIRED_TABLES) {
      const row = sqlite.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get() as any
      const count = row?.cnt || 0
      rows[table] = count
      if (count > TABLE_SIZE_WARN) {
        warnings.push(`${table}: ${count.toLocaleString()} rows (threshold: ${TABLE_SIZE_WARN.toLocaleString()})`)
      }
    }
    return { ok: warnings.length === 0, rows, warnings }
  } catch (e: any) {
    return { ok: false, rows, warnings: ['error: ' + e.message] }
  }
}

// ─── Full Health Check ───────────────────────────────────

export function runMemoryHealthCheck(): MemoryHealthReport {
  const sqliteIntegrity = checkIntegrity()
  const tablesExist = checkTables()
  const decayStatus = runDecay()
  const tableSizes = checkSizes()

  const healthy = sqliteIntegrity.ok && tablesExist.ok && decayStatus.ok
  
  lastReport = {
    timestamp: Date.now(),
    healthy,
    sqliteIntegrity,
    tablesExist,
    decayStatus,
    tableSizes,
  }
  
  if (!healthy) {
    console.log('[MemoryHeartbeat] DEBUG:', 
      'integrity=' + sqliteIntegrity.ok,
      'tables=' + tablesExist.ok + ' missing=' + JSON.stringify(tablesExist.missing),
      'decay=' + decayStatus.ok)
    console.warn('[MemoryHeartbeat] Health check FAILED:', 
      !sqliteIntegrity.ok ? 'integrity=' + sqliteIntegrity.error :
      !tablesExist.ok ? 'missing_tables=' + tablesExist.missing.join(',') :
      !decayStatus.ok ? 'decay=' + decayStatus.error : 'unknown')
  }
  
  return lastReport
}

// ─── Auto-repair ─────────────────────────────────────────

function autoRepair(report: MemoryHealthReport): boolean {
  let repaired = false
  
  // Missing tables → try to recreate via migration
  if (!report.tablesExist.ok) {
    for (const table of report.tablesExist.missing) {
      try {
        // Basic CREATE IF NOT EXISTS for core tables
        if (table === 'sessions') {
          sqlite.prepare(`CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
            message_count INTEGER DEFAULT 0, is_archived INTEGER DEFAULT 0
          )`).run()
          repaired = true
        } else if (table === 'chat_messages') {
          sqlite.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
            content TEXT NOT NULL, created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id)
          )`).run()
          repaired = true
        } else if (table === 'cross_session_memory') {
          sqlite.prepare(`CREATE TABLE IF NOT EXISTS cross_session_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
            category TEXT NOT NULL, summary TEXT NOT NULL,
            keywords TEXT, importance INTEGER DEFAULT 1,
            access_count INTEGER DEFAULT 3, created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )`).run()
          repaired = true
        }
        console.log('[MemoryHeartbeat] Auto-recreated table:', table)
      } catch (e: any) {
        console.error('[MemoryHeartbeat] Failed to recreate table:', table, e.message)
      }
    }
  }
  
  return repaired
}

// ─── Heartbeat Lifecycle ─────────────────────────────────

export function startMemoryHeartbeat(): void {
  if (heartbeatInterval) return
  
  // Run once immediately
  const report = runMemoryHealthCheck()
  if (!report.healthy) autoRepair(report)
  
  heartbeatInterval = setInterval(() => {
    const r = runMemoryHealthCheck()
    if (!r.healthy) {
      const repaired = autoRepair(r)
      if (repaired) {
        // Re-check after repair
        setTimeout(() => runMemoryHealthCheck(), 2000)
      }
    }
  }, 30000)
  
  console.log('[MemoryHeartbeat] Started (30s interval)')
}

export function stopMemoryHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval)
    heartbeatInterval = null
    console.log('[MemoryHeartbeat] Stopped')
  }
}

export function getLastMemoryReport(): MemoryHealthReport | null {
  return lastReport
}
