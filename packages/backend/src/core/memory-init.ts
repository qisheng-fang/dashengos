// DaShengOS v6.1 — Memory System Initializer
// 所有记忆相关表的创建和索引，在服务器启动时调用一次
// 解决 "Lazy table not yet created" 无限警告问题

import { sqlite } from '../storage/db.js'

export function initMemoryTables(): { created: string[]; errors: string[] } {
  const created: string[] = []
  const errors: string[] = []

  const tables = [
    // ─── 跨会话记忆 ─────────────────────────────────
    {
      name: 'cross_session_memory',
      sql: `CREATE TABLE IF NOT EXISTS cross_session_memory (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        category TEXT NOT NULL DEFAULT 'general',
        summary TEXT NOT NULL,
        keywords TEXT DEFAULT '[]',
        importance REAL DEFAULT 0.5,
        access_count INTEGER DEFAULT 1,
        last_accessed_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        decayed_at INTEGER,
        metadata TEXT DEFAULT '{}'
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_csm_user ON cross_session_memory(user_id, last_accessed_at)',
        'CREATE INDEX IF NOT EXISTS idx_csm_category ON cross_session_memory(category, importance)',
        'CREATE INDEX IF NOT EXISTS idx_csm_keywords ON cross_session_memory(keywords)',
      ],
    },
    // ─── 记忆账本 ───────────────────────────────────
    {
      name: 'memory_ledger',
      sql: `CREATE TABLE IF NOT EXISTS memory_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        source TEXT NOT NULL DEFAULT 'system',
        timestamp INTEGER NOT NULL
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_ledger_user ON memory_ledger(user_id, timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_ledger_target ON memory_ledger(target_type, target_id)',
      ],
    },
    // ─── 用户动态画像 ───────────────────────────────
    {
      name: 'dynamic_user_profiles',
      sql: `CREATE TABLE IF NOT EXISTS dynamic_user_profiles (
        user_id TEXT PRIMARY KEY,
        username TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'USER',
        preferred_style TEXT DEFAULT 'concise',
        preferred_format TEXT DEFAULT 'text',
        preferred_language TEXT DEFAULT 'zh',
        top_topics TEXT DEFAULT '[]',
        topic_expertise TEXT DEFAULT '{}',
        favorite_tools TEXT DEFAULT '[]',
        tool_sequence_patterns TEXT DEFAULT '[]',
        avg_session_length REAL DEFAULT 0,
        peak_activity_hour INTEGER DEFAULT 9,
        task_complexity TEXT DEFAULT 'moderate',
        total_sessions INTEGER DEFAULT 0,
        total_interactions INTEGER DEFAULT 0,
        last_active_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_dup_user ON dynamic_user_profiles(user_id)',
      ],
    },
    // ─── 记忆嵌入向量 ───────────────────────────────
    {
      name: 'memory_embeddings',
      sql: `CREATE TABLE IF NOT EXISTS memory_embeddings (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        model TEXT DEFAULT 'bge-large-zh',
        dimension INTEGER DEFAULT 1024,
        created_at INTEGER NOT NULL
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_mem_emb ON memory_embeddings(memory_id)',
      ],
    },
    // ─── 记忆摘要 ───────────────────────────────────
    {
      name: 'memory_summaries',
      sql: `CREATE TABLE IF NOT EXISTS memory_summaries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT,
        summary_type TEXT DEFAULT 'session',
        summary_text TEXT NOT NULL,
        key_points TEXT DEFAULT '[]',
        action_items TEXT DEFAULT '[]',
        token_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_ms_user ON memory_summaries(user_id, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_ms_session ON memory_summaries(session_id)',
      ],
    },
    // ─── 上下文压缩日志 ─────────────────────────────
    {
      name: 'context_compression_log',
      sql: `CREATE TABLE IF NOT EXISTS context_compression_log (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        before_tokens INTEGER NOT NULL,
        after_tokens INTEGER NOT NULL,
        ratio REAL NOT NULL,
        method TEXT DEFAULT 'llm',
        duration_ms INTEGER,
        success INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_ccl_session ON context_compression_log(session_id, created_at)',
      ],
    },
    // ─── 编排运行记录 ───────────────────────────────
    {
      name: 'orchestration_runs',
      sql: `CREATE TABLE IF NOT EXISTS orchestration_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        intent TEXT,
        mode TEXT DEFAULT 'pipeline',
        state_json TEXT DEFAULT '{}',
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )`,
      indexes: [
        'CREATE INDEX IF NOT EXISTS idx_or_session ON orchestration_runs(session_id, created_at)',
      ],
    },
  ]

  for (const table of tables) {
    try {
      sqlite.prepare(table.sql).run()
      for (const idx of table.indexes) {
        sqlite.prepare(idx).run()
      }
      created.push(table.name)
    } catch (e: any) {
      errors.push(`${table.name}: ${e.message}`)
    }
  }

  console.log(`[MemoryInit] Created ${created.length} tables${errors.length > 0 ? `, ${errors.length} errors` : ''}`)
  if (errors.length > 0) {
    errors.forEach(e => console.error(`[MemoryInit] ✗ ${e}`))
  }

  return { created, errors }
}

// ─── Seed initial data ────────────────────────────────────

export function seedMemoryDefaults(): void {
  const now = Date.now()

  // Create default user profile if users exist but no profiles
  const users = sqlite.prepare('SELECT id, username, role FROM users').all() as Array<{ id: string; username: string; role: string }>
  for (const user of users) {
    const existing = sqlite.prepare('SELECT user_id FROM dynamic_user_profiles WHERE user_id = ?').get(user.id)
    if (!existing) {
      try {
        sqlite.prepare(`INSERT INTO dynamic_user_profiles (user_id, username, role, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`).run(user.id, user.username, user.role, now, now)
        console.log(`[MemoryInit] Seeded profile for ${user.username}`)
      } catch (e: any) {
        console.warn(`[MemoryInit] Failed to seed profile for ${user.username}:`, e.message)
      }
    }
  }

  console.log(`[MemoryInit] Memory system ready — ${users.length} user profiles`)
}
