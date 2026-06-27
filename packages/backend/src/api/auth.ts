// packages/backend/src/api/auth.ts · v0.3 spec §10 (4 端点: login/refresh/logout/logout-all)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { sqlite } from '../storage/db.js'
import { issueTokens } from '../core/gateway.js'
import { config } from '../config.js'
import { metrics } from '../core/metrics.js'
import bcrypt from 'bcryptjs'

const LoginSchema = z.object({
  username: z.string().min(3).max(64),
  password: z.string().min(8).max(128),
  mfa_code: z.string().min(6).max(6).optional(),
})

const RefreshSchema = z.object({
  refresh_token: z.string().min(1),
})

// Phase 7: admin 强制踢出某用户
const ForceLogoutSchema = z.object({ user_id: z.string() })

// Phase C.1 (2026-06-16) login lockout constants
// D5 (2026-06-18): 阈值降到 3, 窗口缩到 60s, 因为 dev 环境 backend 重启时 WAL snapshot 残留老 attempts
const LOGIN_MAX_ATTEMPTS = 3
const LOGIN_WINDOW_MS = 60_000

// 查 IP 在 15min 内的失败次数, 决定是否锁定
function isIpLocked(ip: string, now: number): { locked: boolean; retryAfterSec: number; failedCount: number } {
  const windowStart = now - LOGIN_WINDOW_MS
  const rows = sqlite
    .prepare(
      `SELECT attempt_at FROM login_attempts
       WHERE ip = ? AND success = 0 AND attempt_at > ?
       ORDER BY attempt_at ASC`,
    )
    .all(ip, windowStart) as Array<{ attempt_at: number }>
  // D5 debug (2026-06-18): 验证 login_attempts 实际值
  if (process.env.DASHENG_DB_DEBUG) {
    const all = sqlite.prepare('SELECT * FROM login_attempts').all() as Array<unknown>
    // eslint-disable-next-line no-console
    console.log(`[auth] isIpLocked(${ip}) rows=${rows.length} total_in_table=${all.length} windowStart=${windowStart}`)
  }
  if (rows.length < LOGIN_MAX_ATTEMPTS) {
    return { locked: false, retryAfterSec: 0, failedCount: rows.length }
  }
  // 锁定: 最早一次失败 + 15min 是解锁时刻
  const oldest = rows[0].attempt_at
  const unlockAt = oldest + LOGIN_WINDOW_MS
  const retryAfterSec = Math.max(0, Math.ceil((unlockAt - now) / 1000))
  return { locked: true, retryAfterSec, failedCount: rows.length }
}

function recordLoginAttempt(ip: string, now: number, success: boolean) {
  if (success) {
    // 登录成功 → 清空该 IP 全部记录
    sqlite.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip)
    return
  }
  sqlite
    .prepare('INSERT INTO login_attempts (id, ip, attempt_at, success) VALUES (?, ?, ?, 0)')
    .run(`la_${now}_${Math.random().toString(36).slice(2, 8)}`, ip, now)
}

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/login
  app.post('/login', async (req, reply) => {
    const parsed = LoginSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }
    const { username, password } = parsed.data

    // Phase C.1: IP 锁定 (dev 默认 3 fail/60s, DASHENG_LOGIN_LOCKOUT=false 可禁用)
    const now = Date.now()
    const ip = req.ip || 'unknown'
    const lockEnabled = process.env.DASHENG_LOGIN_LOCKOUT !== 'false'
    if (lockEnabled) {
      const lock = isIpLocked(ip, now)
      if (lock.locked) {
        metrics.authLogin.inc({ result: 'locked' })
        return reply
          .code(429)
          .header('Retry-After', String(lock.retryAfterSec))
          .send({
            code: 'TOO_MANY_LOGIN_ATTEMPTS',
            message: `账户临时锁定, ${lock.retryAfterSec}s 后重试`,
            retry_after_sec: lock.retryAfterSec,
          })
      }
    }

    const user = sqlite
      .prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?')
      .get(username) as { id: string; username: string; password_hash: string; role: 'ADMIN' | 'USER' | 'GUEST' } | undefined

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      metrics.authLogin.inc({ result: 'fail' })
      recordLoginAttempt(ip, now, false)
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'invalid credentials' })
    }

    // 成功 → 清锁定记录
    recordLoginAttempt(ip, now, true)
    metrics.authLogin.inc({ result: 'success' })

    const tokens = issueTokens(user.id, user.role, [], {
      jwtSecret: config.DASHENG_JWT_SECRET,
      accessTokenTtlSec: config.DASHENG_JWT_ACCESS_TTL_SEC,
      refreshTokenTtlSec: config.DASHENG_JWT_REFRESH_TTL_SEC,
      rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
      // Phase 8: 把 refresh token 哈希写到 refresh_tokens 表
      storeRefreshToken: (rec) => {
        sqlite
          .prepare(
            'INSERT INTO refresh_tokens (id, user_id, token_hash, created_at, expires_at, revoked) VALUES (?, ?, ?, ?, ?, 0)',
          )
          .run(rec.id, rec.user_id, rec.token_hash, rec.created_at, rec.expires_at)
      },
    })

    return reply.send({
      ...tokens,
      user: { id: user.id, username: user.username, role: user.role },
    })
  })

  // POST /auth/refresh (Phase 8: real — 验 jti + 签新 access)
  app.post('/refresh', async (req, reply) => {
    const parsed = RefreshSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }

    let payload: Record<string, unknown>
    try {
      payload = jwt.verify(parsed.data.refresh_token, config.DASHENG_JWT_SECRET) as Record<string, unknown>
    } catch {
      metrics.authRefresh.inc({ result: 'invalid' })
      return reply.code(401).send({ code: 'REFRESH_INVALID' })
    }
    if (payload.scope !== 'refresh' || typeof payload.jti !== 'string') {
      metrics.authRefresh.inc({ result: 'invalid' })
      return reply.code(401).send({ code: 'REFRESH_INVALID' })
    }

    // 查 jti 未撤销
    const row = sqlite
      .prepare('SELECT user_id, expires_at, revoked FROM refresh_tokens WHERE id = ?')
      .get(payload.jti) as { user_id: string; expires_at: number; revoked: number } | undefined
    if (!row) {
      metrics.authRefresh.inc({ result: 'unknown' })
      return reply.code(401).send({ code: 'REFRESH_UNKNOWN' })
    }
    if (row.revoked) {
      metrics.authRefresh.inc({ result: 'revoked' })
      return reply.code(401).send({ code: 'REFRESH_REVOKED' })
    }
    if (row.expires_at < Date.now()) {
      sqlite.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(payload.jti)
      metrics.authRefresh.inc({ result: 'expired' })
      return reply.code(401).send({ code: 'REFRESH_EXPIRED' })
    }

    // 拿 user (含 tokens_valid_after 撤销检查)
    const user = sqlite
      .prepare('SELECT id, role, tokens_valid_after FROM users WHERE id = ?')
      .get(row.user_id) as { id: string; role: 'ADMIN' | 'USER' | 'GUEST'; tokens_valid_after: number } | undefined
    if (!user) {
      metrics.authRefresh.inc({ result: 'unknown' })
      return reply.code(401).send({ code: 'USER_NOT_FOUND' })
    }

    // Phase 7 撤销检查: refresh 跟 access 用同一个 tokens_valid_after
    const iat = (payload.iat as number) ?? 0
    if (iat * 1000 < user.tokens_valid_after) {
      metrics.authRefresh.inc({ result: 'revoked' })
      return reply.code(401).send({ code: 'REFRESH_REVOKED', message: 'refresh issued before logout' })
    }

    // 签新 access (不 rotate refresh — Phase 8.5)
    const newAccess = jwt.sign(
      { sub: user.id, role: user.role, scopes: [], scope: 'api' },
      config.DASHENG_JWT_SECRET,
      { expiresIn: config.DASHENG_JWT_ACCESS_TTL_SEC, algorithm: 'HS256' },
    )
    metrics.authRefresh.inc({ result: 'success' })
    return reply.send({
      access_token: newAccess,
      expires_in: config.DASHENG_JWT_ACCESS_TTL_SEC,
    })
  })

  // POST /auth/logout (Phase 7: real — bump tokens_valid_after)
  // 旧 token (iat < tokens_valid_after) 在 gateway 自动 401 TOKEN_REVOKED
  app.post('/logout', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const now = Date.now()
    sqlite.prepare('UPDATE users SET tokens_valid_after = ? WHERE id = ?').run(now, userId)
    metrics.authLogout.inc({ scope: 'self' })
    return reply.send({ ok: true, revoked_at: now, scope: 'self' })
  })

  // POST /auth/logout-all (Phase 7: admin force-logout another user)
  // 路由前缀是 /api/v1/auth, 这里写 /logout-all 即可
  app.post('/logout-all', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user!.role !== 'ADMIN') {
      return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
    }
    const parsed = ForceLogoutSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const { user_id } = parsed.data
    const u = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(user_id) as
      | { id: string }
      | undefined
    if (!u) return reply.code(404).send({ code: 'USER_NOT_FOUND' })
    const now = Date.now()
    sqlite.prepare('UPDATE users SET tokens_valid_after = ? WHERE id = ?').run(now, user_id)
    // 也撤销该用户所有 refresh token
    sqlite.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(user_id)
    metrics.authLogout.inc({ scope: 'admin' })
    return reply.send({ ok: true, revoked_at: now, user_id, scope: 'admin' })
  })
}
