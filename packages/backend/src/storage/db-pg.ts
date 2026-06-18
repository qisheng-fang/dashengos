// packages/backend/src/storage/db-pg.ts · Track B.1 (2026-06-17)
// PostgreSQL drizzle 支持 — 生产环境替代 SQLite
// 启用方式: DATABASE_TYPE=postgres DATABASE_URL=postgres://user:pass@host:5432/db
//
// 注意: 本模块需要 pg 和 drizzle-orm/pg-core 依赖
//   首次启用前: cd packages/backend && pnpm add pg && pnpm add -D @types/pg
//   迁移: 见 deploy/migrate-sqlite-to-pg.sh

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { config } from '../config.js'

let pgPool: Pool | null = null
let pgDb: NodePgDatabase | null = null

/**
 * 初始化 PostgreSQL 连接池
 * 调用方需确保 DATABASE_TYPE=postgres
 */
export function initPg(): { db: NodePgDatabase; pool: Pool } {
  if (pgPool) return { db: pgDb!, pool: pgPool }

  const url = config.DATABASE_URL
  pgPool = new Pool({
    connectionString: url,
    max: config.DASHENG_DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  })

  pgDb = drizzle(pgPool, { logger: config.NODE_ENV === 'development' })
  return { db: pgDb, pool: pgPool }
}

/**
 * PostgreSQL 建表 (等价于 SQLite initSchema)
 * 使用原始 SQL — 保持与 SQLite schema 一致
 */
export async function initPgSchema(pool: Pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 核心表 (与 SQLite schema 对齐)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        avatar_url TEXT DEFAULT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        status TEXT NOT NULL DEFAULT 'active',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_login_at BIGINT DEFAULT NULL,
        tokens_valid_after BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'general',
        system_prompt TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT 'ollama:qwen2.5:7b',
        temperature REAL NOT NULL DEFAULT 0.7,
        max_tokens INTEGER NOT NULL DEFAULT 4096,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        built_in INTEGER NOT NULL DEFAULT 0
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '新会话',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        model TEXT DEFAULT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        tool_calls TEXT DEFAULT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT 'custom',
        manifest TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_skills (
        agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
        PRIMARY KEY (agent_id, skill_id)
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL DEFAULT 'stdio',
        config TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'disconnected',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS mcp_tools (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        input_schema TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS tool_permissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_id TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL,
        UNIQUE(user_id, tool_id)
      );
      CREATE INDEX IF NOT EXISTS idx_tool_perms_user ON tool_permissions(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS file_objects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes BIGINT NOT NULL DEFAULT 0,
        storage_path TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_files_user ON file_objects(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        ip TEXT DEFAULT NULL,
        signature_hmac TEXT DEFAULT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        encrypted_value BYTEA NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_secrets_user ON secrets(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '{}',
        updated_at BIGINT NOT NULL,
        UNIQUE(user_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS sso_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT DEFAULT NULL,
        expires_at BIGINT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sso_user ON sso_sessions(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS sso_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        linked_at BIGINT NOT NULL,
        UNIQUE(user_id, provider)
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT 'default',
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL DEFAULT '',
        scopes TEXT NOT NULL DEFAULT '[]',
        last_used_at BIGINT DEFAULT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT DEFAULT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS marketplace_installs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        item_type TEXT NOT NULL,
        item_id TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT 'latest',
        installed_at BIGINT NOT NULL,
        UNIQUE(user_id, item_type, item_id)
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        metric TEXT NOT NULL,
        value REAL NOT NULL DEFAULT 0,
        period TEXT NOT NULL,
        recorded_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_billing_user ON billing_usage(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS billing_tier (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tier TEXT NOT NULL DEFAULT 'free',
        started_at BIGINT NOT NULL,
        expires_at BIGINT DEFAULT NULL,
        stripe_subscription_id TEXT DEFAULT NULL
      );
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (user_id, category)
      );
      CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id TEXT PRIMARY KEY,
        ip TEXT NOT NULL,
        attempt_at BIGINT NOT NULL,
        success INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempt_at);
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS social_cookies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        cookie_name TEXT NOT NULL DEFAULT 'default',
        encrypted_value TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(user_id, platform, cookie_name)
      );
      CREATE INDEX IF NOT EXISTS idx_social_cookies_user ON social_cookies(user_id);
      CREATE INDEX IF NOT EXISTS idx_social_cookies_platform ON social_cookies(user_id, platform);
    `)

    await client.query('COMMIT')
    console.log('[db-pg] PostgreSQL schema initialized (21 tables)')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * 优雅关闭连接池
 */
export async function disconnectPg(pool: Pool) {
  await pool.end()
}

export { sql }
