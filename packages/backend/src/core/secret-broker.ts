// DaShengOS v6.0 · Secret Broker
// 蓝图 §4.6: 密钥不进 Agent 上下文，运行时临时注入
// 存储: AES-256-GCM 加密文件 → 内存缓存 (10min TTL)
// 注入: 沙箱执行前按需注入 → 执行后隔离清除

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// ─── Types ────────────────────────────────────────────────

interface SecretEntry {
  key: string        // e.g. "DEEPSEEK_API_KEY"
  value: string      // encrypted
  scopes: string[]   // which tools need this: ["llm:deepseek", "sandbox.exec"]
}

interface SecretManifest {
  version: 1
  created: number
  entries: SecretEntry[]
}

// ─── Tool → Secret mapping ────────────────────────────────

const TOOL_SECRET_MAP: Record<string, string[]> = {
  // LLM provider calls (backend handles, not sandbox)
  'agent.run': ['DEEPSEEK_API_KEY', 'SILICONFLOW_API_KEY', 'AGNES_AI_API_KEY'],
  'research.run': ['DEEPSEEK_API_KEY'],

  // Sandbox exec — strip ALL by default, only inject if explicitly needed
  'sandbox.exec': [],  // no secrets by default

  // Git operations (if using token auth)
  'git.push': ['GITHUB_TOKEN'],
  'git.clone': ['GITHUB_TOKEN'],

  // Stripe (backend only)
  'payment.*': ['DASHENG_STRIPE_WEBHOOK_SECRET'],
}

// ─── Sensitive key patterns (always strip from sandbox) ───

const SENSITIVE_KEY_PATTERNS = [
  /API[_-]?KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /JWT/i,
  /HMAC/i,
  /WEBHOOK/i,
  /PRIVATE[_-]?KEY/i,
]

// ─── Encrypted Store ──────────────────────────────────────

const STORE_PATH = resolve(process.cwd(), '../../seed/secrets.enc')
const CACHE_TTL_MS = 10 * 60 * 1000  // 10 minutes

let memoryCache: Map<string, { value: string; expiresAt: number }> | null = null

function getMasterKey(): Buffer {
  // Priority: DASHE_MASTER_KEY env → Keychain → derived key
  const envKey = process.env.DASHE_MASTER_KEY
  if (envKey) return Buffer.from(envKey, 'hex')

  // Fallback: derive from machine-specific data
  const hostname = process.env.HOSTNAME || process.env.HOST || 'dasheng'
  const user = process.env.USER || 'admin'
  return scryptSync(`${hostname}:${user}:dasheng-secrets-v1`, 'dasheng-os-salt', 32)
}

function encrypt(value: string, key: Buffer): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(encrypted: string, key: Buffer): string {
  const buf = Buffer.from(encrypted, 'base64')
  const iv = buf.subarray(0, 16)
  const tag = buf.subarray(16, 32)
  const data = buf.subarray(32)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf-8')
}

// ─── Load / Save ──────────────────────────────────────────

function loadStore(): SecretManifest {
  try {
    if (!existsSync(STORE_PATH)) return { version: 1, created: Date.now(), entries: [] }
    const masterKey = getMasterKey()
    const raw = readFileSync(STORE_PATH, 'utf-8')
    const decrypted = decrypt(raw, masterKey)
    return JSON.parse(decrypted)
  } catch (e: any) {
    console.error('[SecretBroker] Failed to load store:', e.message)
    return { version: 1, created: Date.now(), entries: [] }
  }
}

function saveStore(manifest: SecretManifest): void {
  try {
    const dir = dirname(STORE_PATH)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const masterKey = getMasterKey()
    const encrypted = encrypt(JSON.stringify(manifest), masterKey)
    writeFileSync(STORE_PATH, encrypted)
  } catch (e: any) {
    console.error('[SecretBroker] Failed to save store:', e.message)
  }
}

// ─── Public API ───────────────────────────────────────────

/**
 * Initialize secret store from .env (one-time migration).
 * Reads .env, encrypts all API_KEY/SECRET entries, writes encrypted store.
 */
export function migrateFromEnv(): { migrated: number; skipped: number } {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return { migrated: 0, skipped: 0 }

  const manifest = loadStore()
  const existing = new Set(manifest.entries.map(e => e.key))
  let migrated = 0, skipped = 0

  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const value = trimmed.slice(eqIdx + 1).trim()

    // Only migrate sensitive keys
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(p => p.test(key))
    if (!isSensitive || !value) { skipped++; continue }

    if (existing.has(key)) { skipped++; continue }

    // Determine scopes based on key name
    const scopes: string[] = []
    if (key.includes('DEEPSEEK')) scopes.push('llm:deepseek', 'agent.run')
    if (key.includes('SILICONFLOW')) scopes.push('llm:siliconflow', 'agent.run')
    if (key.includes('AGNES')) scopes.push('llm:agnes', 'agent.run')
    if (key.includes('GOOGLE')) scopes.push('llm:google', 'agent.run')
    if (key.includes('STRIPE')) scopes.push('payment.*')
    if (key.includes('JWT')) scopes.push('auth')

    manifest.entries.push({ key, value, scopes })
    existing.add(key)
    migrated++
  }

  if (migrated > 0) {
    saveStore(manifest)
    console.log(`[SecretBroker] Migrated ${migrated} secrets from .env → seed/secrets.enc`)
  }

  return { migrated, skipped }
}

/**
 * Get a secret by key. Only callable from system code, never exposed to Agent.
 * Uses memory cache with 10-min TTL.
 */
export function getSecret(key: string): string | null {
  // Check memory cache first
  if (memoryCache) {
    const cached = memoryCache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
  }

  // Load from encrypted store
  const manifest = loadStore()
  const entry = manifest.entries.find(e => e.key === key)
  if (!entry) return null

  // Initialize cache
  if (!memoryCache) memoryCache = new Map()
  memoryCache.set(key, {
    value: entry.value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return entry.value
}

/**
 * Build a sandbox-safe env object for a specific tool execution.
 * Strips ALL sensitive keys, injects only tool-specific secrets.
 */
export function buildSandboxEnv(toolId: string): Record<string, string> {
  const safe: Record<string, string> = {}

  // Only pass through non-sensitive env vars
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue
    const isSensitive = SENSITIVE_KEY_PATTERNS.some(p => p.test(key))
    if (!isSensitive) safe[key] = value
  }

  // Add tool-specific secrets
  const allowedKeys = TOOL_SECRET_MAP[toolId] || []
  // Also check wildcard patterns
  for (const [pattern, keys] of Object.entries(TOOL_SECRET_MAP)) {
    if (pattern.endsWith('.*') && toolId.startsWith(pattern.slice(0, -2))) {
      allowedKeys.push(...keys)
    }
  }

  for (const key of allowedKeys) {
    const secret = getSecret(key)
    if (secret) safe[key] = secret
  }

  return safe
}

/**
 * Check if env has been sanitized (no sensitive keys).
 */
export function isSandboxEnvSafe(): boolean {
  for (const [key] of Object.entries(process.env)) {
    if (SENSITIVE_KEY_PATTERNS.some(p => p.test(key))) return false
  }
  return true
}

/**
 * Clear the memory cache (force reload from disk).
 */
export function clearSecretCache(): void {
  memoryCache = null
}

/**
 * List available secret keys (names only, never values).
 */
export function listSecretKeys(): string[] {
  const manifest = loadStore()
  return manifest.entries.map(e => e.key)
}
