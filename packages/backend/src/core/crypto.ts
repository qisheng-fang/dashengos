// packages/backend/src/core/crypto.ts · Track B.1 (2026-06-17)
// AES-256-GCM 加密工具 — 用于社交媒体 cookie 安全存储
// Node.js 内置 crypto 模块, 零依赖

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM recommended
const AUTH_TAG_LENGTH = 16
const SALT_LENGTH = 32
const KEY_LENGTH = 32 // 256 bits

/**
 * 从密码派生 AES-256 密钥
 * 使用 scrypt (N=2^14) 防止暴力破解
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 })
}

/**
 * 加密明文 → base64(ciphertext + authTag + iv + salt)
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // 打包: salt || iv || authTag || ciphertext
  const packed = Buffer.concat([salt, iv, authTag, encrypted])
  return packed.toString('base64')
}

/**
 * 解密 base64(salt || iv || authTag || ciphertext) → 明文
 * 失败抛 Error (密码错 / 数据损坏)
 */
export function decrypt(packedBase64: string, password: string): string {
  const packed = Buffer.from(packedBase64, 'base64')

  let offset = 0
  const salt = packed.subarray(offset, offset + SALT_LENGTH)
  offset += SALT_LENGTH
  const iv = packed.subarray(offset, offset + IV_LENGTH)
  offset += IV_LENGTH
  const authTag = packed.subarray(offset, offset + AUTH_TAG_LENGTH)
  offset += AUTH_TAG_LENGTH
  const encrypted = packed.subarray(offset)

  const key = deriveKey(password, salt)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}

/**
 * 生成 cookie 加密密码
 * 生产环境应从 env COOKIE_ENCRYPTION_KEY 读, 开发环境自动生成
 */
export function getCookieEncryptionKey(): string {
  const envKey = process.env.COOKIE_ENCRYPTION_KEY
  if (envKey && envKey.length >= 32) return envKey

  // 开发环境: 用 JWT_SECRET 派生 (不是真安全但比硬编码好)
  const jwtSecret = process.env.DASHENG_JWT_SECRET ?? 'dev-only-fallback'
  return `cookie-kek:${jwtSecret.slice(0, 32).padEnd(32, '0')}`
}
