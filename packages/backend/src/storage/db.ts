// packages/backend/src/storage/db.ts · v0.3 spec §12 (Drizzle + SQLite)
// 14 张核心表 + 4 张 DeerFlow 表 (Phase 3 加) + FTS5 触发器

import Database from 'better-sqlite3'
import type { Database as BetterDb } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { sql } from 'drizzle-orm'
import { mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, isAbsolute } from 'node:path'
import { config } from '../config.js'

// 解析 file: / sqlite: URL 成 better-sqlite3 能吃的路径
//   file:./data/x.db          → ./data/x.db   (相对)
//   file:///abs/path          → /abs/path     (绝对)
//   sqlite:./data/x.db        → ./data/x.db   (相对)
//   sqlite:///abs/path        → /abs/path     (绝对)
// 之前只 replace(/^file:/) 会把 sqlite:///./x 当字面文件名,后端跑去 packages/backend/sqlite:/data/x.db
const rawPath = config.DATABASE_URL.replace(/^(file|sqlite):/, '')
const dbPath = isAbsolute(rawPath) ? rawPath : resolve(process.cwd(), rawPath)
const dbDir = dirname(dbPath)
if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

// SQLite 连接 + WAL 模式
const sqlite: BetterDb = new Database(dbPath)
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('synchronous = NORMAL')

// Drizzle 包装
export const db = drizzle(sqlite)
export { sqlite, sql }

// 启动时建表 (Phase 2 简化为内联, Phase 3 用 migration)
export function initSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      mfa_secret TEXT,
      role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN','USER','GUEST')),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      -- Phase 7: JWT 撤销 checkpoint (ms timestamp)
      -- 任何 iat < tokens_valid_after 的 JWT 都会被 gateway 拒绝
      tokens_valid_after INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      config_yaml TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE'
                     CHECK (status IN ('ACTIVE','ARCHIVED','ABORTED','ERRORED')),
      token_count INTEGER NOT NULL DEFAULT 0,
      parent_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_updated ON sessions(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('SYSTEM','USER','ASSISTANT','TOOL')),
      content TEXT NOT NULL,
      tool_calls_json TEXT,
      tool_call_id TEXT,
      parent_message_id TEXT,
      model TEXT,
      token_in INTEGER,
      token_out INTEGER,
      finish_reason TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      version TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('BUILTIN','GIT','LOCAL','MARKETPLACE')),
      source_url TEXT,
      signature TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      installed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_skills (
      agent_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      config_json TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      PRIMARY KEY (agent_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      args_json TEXT NOT NULL,
      env_json TEXT,
      signature_sha256 TEXT NOT NULL,
      sandbox_config_json TEXT,
      status TEXT NOT NULL DEFAULT 'REGISTERED'
                   CHECK (status IN ('REGISTERED','STARTED','STOPPED','ERRORED')),
      last_health_check INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mcp_tools (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      input_schema_json TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK (risk_level IN ('READ','WRITE','NETWORK','EXEC')),
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE(server_id, name)
    );

    CREATE TABLE IF NOT EXISTS tool_permissions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      role TEXT,
      tool_pattern TEXT NOT NULL,
      allow INTEGER NOT NULL DEFAULT 1,
      require_confirm INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS file_objects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_backend TEXT NOT NULL CHECK (storage_backend IN ('LOCAL','S3','IPFS')),
      storage_path TEXT NOT NULL,
      content_hash_sha256 TEXT NOT NULL,
      uploaded_at INTEGER NOT NULL,
      expires_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      user_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('DEBUG','INFO','WARN','ERROR','CRITICAL')),
      action TEXT NOT NULL,
      target TEXT,
      args_json TEXT,
      result_summary TEXT,
      duration_ms INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      signature_hmac TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_severity_ts ON audit_logs(severity, timestamp DESC);

    CREATE TABLE IF NOT EXISTS secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      backend TEXT NOT NULL CHECK (backend IN ('KEYCHAIN','FILE_ENCRYPTED','ENV')),
      encrypted_value BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- ========================================================================
    -- Phase 6: persistent state for phase5 routes (was in-memory in Phase 5)
    -- ========================================================================

    -- 1. SSO in-flight sessions (OIDC state validation, 10 min TTL)
    CREATE TABLE IF NOT EXISTS sso_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      state TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      user_id TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sso_sessions_expires ON sso_sessions(expires_at);

    -- 2. SSO external identity → local user mapping
    --    (replaces encoding ssoUsername into users.username; collision-proof)
    CREATE TABLE IF NOT EXISTS sso_links (
      provider TEXT NOT NULL,
      external_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      linked_at INTEGER NOT NULL,
      PRIMARY KEY (provider, external_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sso_links_user ON sso_links(user_id);

    -- 3. API keys (raw key returned only at creation; hash stored for verify)
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      hash TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, revoked);
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);

    -- 4. Marketplace agent installs
    CREATE TABLE IF NOT EXISTS marketplace_installs (
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      version TEXT NOT NULL,
      installed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, agent_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 5. Billing usage (30-day period)
    CREATE TABLE IF NOT EXISTS billing_usage (
      user_id TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0,
      sandbox_exec_seconds INTEGER NOT NULL DEFAULT 0,
      storage_bytes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, period_start),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 6. User billing tier
    CREATE TABLE IF NOT EXISTS billing_tier (
      user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','pro','enterprise')),
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 7. Phase 8: refresh token 存储 (jti + hash)
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,                    -- ulid (== refresh JWT 的 jti claim)
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,                -- sha256(refresh_token) hex
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,      -- 软删 (logout/rotate)
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, revoked);

    -- 8. Phase A: per-user settings (model config persistence) · Track C.3
    --   category 格式: 'provider.{id}' | 'models.text' | 'preferences.*'
    --   value 是 JSON (例如 {apiKey, hasKey} 或 {chain: []})
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, category),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

    -- 9. Phase C.1: login attempt tracking (for IP-based lockout)
    --   5 fail in 15min from same IP → lock 15min
    --   success → DELETE 同一 IP 的所有 attempt (重置)
    CREATE TABLE IF NOT EXISTS login_attempts (
      id TEXT PRIMARY KEY,
      ip TEXT NOT NULL,
      attempt_at INTEGER NOT NULL,
      success INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempt_at);
  `)

  // Phase 7: 增量迁移 (旧 DB 加列, 新 DB 上面的 CREATE TABLE 已含)
  // SQLite ALTER 重复加列会抛错, try/catch 吞掉
  try {
    sqlite.exec('ALTER TABLE users ADD COLUMN tokens_valid_after INTEGER NOT NULL DEFAULT 0')
  } catch {
    // 列已存在 — 静默忽略
  }
}
