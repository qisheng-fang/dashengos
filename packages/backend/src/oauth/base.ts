// packages/backend/src/oauth/base.ts · D4 (2026-06-18)
// 4 平台 OAuth 公共接口 + 凭证落盘工具
//   - 凭证存到 secrets 表 (已存在), name = "oauth:<platform>:<userId>"
//   - 加密: 用 config.DASHENG_JWT_SECRET 派生 AES-256-GCM key
//   - 平台适配器只需实现 start()/callback() 两个方法

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'

export type OAuthPlatform = 'wechat_mp' | 'feishu' | 'wechat_video' | 'shopify'

export interface OAuthCredential {
  platform: OAuthPlatform
  user_id: string
  // 平台原始凭证
  access_token: string
  refresh_token?: string
  openid?: string        // 微信 openid / 飞书 user_id / shop domain
  unionid?: string       // 微信 unionid (公众号/视频号互通)
  scope?: string
  expires_at?: number    // ms timestamp, 0 = 永不过期
  raw?: Record<string, unknown>  // 平台原始响应
  created_at: number
  updated_at: number
}

export interface PlatformAdapter {
  platform: OAuthPlatform
  displayName: string
  // 拼 authorize URL; 返回 { url, state }
  start(opts: { userId: string; redirectUri: string }): { url: string; state: string }
  // 处理回调, 换 token, 返回标准化凭证
  callback(opts: { code: string; state: string; userId: string; redirectUri: string }): Promise<OAuthCredential>
  // 测活: 用凭证调一次平台 API
  test(cred: OAuthCredential): Promise<{ ok: boolean; info?: string }>
}

// ============================================================
// 加密 (用 JWT secret 派生 32 字节 key, 兼容 DASHENG_JWT_SECRET 任意长度)
// ============================================================

const KEY = scryptSync(config.DASHENG_JWT_SECRET, 'dasheng-oauth-salt', 32)
const ALGO = 'aes-256-gcm'

function encrypt(plain: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, KEY, iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc])
}

function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, 12)
  const tag = blob.subarray(12, 28)
  const enc = blob.subarray(28)
  const decipher = createDecipheriv(ALGO, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

// ============================================================
// secrets 表 CRUD (凭证落盘)
// ============================================================

function credName(platform: OAuthPlatform, userId: string): string {
  return `oauth:${platform}:${userId}`
}

export function saveCredential(cred: OAuthCredential): void {
  const name = credName(cred.platform, cred.user_id)
  const now = Date.now()
  const value = encrypt(JSON.stringify(cred))
  // upsert
  const existing = sqlite.prepare('SELECT id, created_at FROM secrets WHERE name = ?').get(name) as
    | { id: string; created_at: number }
    | undefined
  if (existing) {
    sqlite
      .prepare('UPDATE secrets SET encrypted_value = ?, updated_at = ? WHERE name = ?')
      .run(value, now, name)
  } else {
    sqlite
      .prepare(
        'INSERT INTO secrets (id, name, backend, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(`sec_${now}_${randomBytes(4).toString('hex')}`, name, 'FILE_ENCRYPTED', value, now, now)
  }
}

export function loadCredential(platform: OAuthPlatform, userId: string): OAuthCredential | null {
  const row = sqlite
    .prepare('SELECT encrypted_value, updated_at FROM secrets WHERE name = ?')
    .get(credName(platform, userId)) as { encrypted_value: Buffer; updated_at: number } | undefined
  if (!row) return null
  try {
    return JSON.parse(decrypt(row.encrypted_value)) as OAuthCredential
  } catch {
    return null
  }
}

export function deleteCredential(platform: OAuthPlatform, userId: string): boolean {
  const result = sqlite.prepare('DELETE FROM secrets WHERE name = ?').run(credName(platform, userId))
  return result.changes > 0
}

export function listAllCredentials(): OAuthCredential[] {
  const rows = sqlite
    .prepare("SELECT encrypted_value FROM secrets WHERE name LIKE 'oauth:%'")
    .all() as Array<{ encrypted_value: Buffer }>
  const out: OAuthCredential[] = []
  for (const r of rows) {
    try {
      out.push(JSON.parse(decrypt(r.encrypted_value)) as OAuthCredential)
    } catch {
      /* skip corrupted */
    }
  }
  return out
}

// ============================================================
// state 临时存储 (10min TTL) - 防止 CSRF
// ============================================================

interface StateRecord {
  state: string
  userId: string
  platform: OAuthPlatform
  redirectUri: string
  createdAt: number
}

const stateStore = new Map<string, StateRecord>()

export function saveState(rec: StateRecord): void {
  stateStore.set(rec.state, rec)
  // 10min 后自动清
  setTimeout(() => stateStore.delete(rec.state), 10 * 60 * 1000)
}

export function consumeState(state: string): StateRecord | null {
  const rec = stateStore.get(state)
  if (!rec) return null
  stateStore.delete(state)
  // 校验 TTL
  if (Date.now() - rec.createdAt > 10 * 60 * 1000) return null
  return rec
}

// ============================================================
// 适配器注册表
// ============================================================

const adapters = new Map<OAuthPlatform, PlatformAdapter>()

export function registerAdapter(adapter: PlatformAdapter): void {
  adapters.set(adapter.platform, adapter)
}

export function getAdapter(platform: OAuthPlatform): PlatformAdapter | null {
  return adapters.get(platform) ?? null
}
