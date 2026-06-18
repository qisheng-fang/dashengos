// packages/backend/src/core/gateway.ts · v0.3 spec §16.5
// Fastify decorate(authenticate/requireAdmin) + audit hook + JWT revocation

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'
import { audit } from './audit.js'

export interface GatewayOptions {
  jwtSecret: string
  accessTokenTtlSec: number
  refreshTokenTtlSec: number
  rateLimitPerMinute: number
}

// Phase 8: refresh token 入库记录 (由 auth.ts 传 callback 进来, 避免 gateway 直接依赖 storage schema)
export interface RefreshTokenRecord {
  id: string
  user_id: string
  token_hash: string
  created_at: number
  expires_at: number
}

export interface AuthUser {
  id: string
  role: 'ADMIN' | 'USER' | 'GUEST'
  scopes: string[]
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    sqlite?: unknown
  }
}

export function issueTokens(
  userId: string,
  role: string,
  scopes: string[],
  opts: GatewayOptions & { storeRefreshToken?: (rec: RefreshTokenRecord) => void },
) {
  // Phase 8: refresh token 加 jti claim (= refresh_tokens.id)
  const jti = ulid()
  const access = jwt.sign({ sub: userId, role, scopes, scope: 'api' }, opts.jwtSecret, {
    expiresIn: opts.accessTokenTtlSec,
    algorithm: 'HS256',
  })
  const refresh = jwt.sign({ sub: userId, scope: 'refresh', jti }, opts.jwtSecret, {
    expiresIn: opts.refreshTokenTtlSec,
    algorithm: 'HS256',
  })
  // 可选: 把 refresh 哈希存 DB (auth.ts 传 callback)
  if (opts.storeRefreshToken) {
    opts.storeRefreshToken({
      id: jti,
      user_id: userId,
      token_hash: createHash('sha256').update(refresh).digest('hex'),
      created_at: Date.now(),
      expires_at: Date.now() + opts.refreshTokenTtlSec * 1000,
    })
  }
  return { access_token: access, refresh_token: refresh, expires_in: opts.accessTokenTtlSec }
}

function extractBearer(req: FastifyRequest): string | null {
  const auth = req.headers.authorization
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

export async function setupGateway(app: FastifyInstance, opts: GatewayOptions): Promise<void> {
  // 0. 注册 user 装饰器 — Fastify 5.x 严格模式, 未注册的 setter 会在 reply.send 时 hang
  // 必须在 authenticate 装饰器之前, 否则首次设置 req.user 时报错
  app.decorateRequest('user', null as any)

  // 1. authenticate 装饰器
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    const token = extractBearer(req)
    if (!token) {
      return reply.code(401).send({ code: 'UNAUTHORIZED', message: 'missing bearer token' })
    }
    try {
      const payload = jwt.verify(token, opts.jwtSecret) as Record<string, unknown>
      const userId = payload.sub as string
      const iat = (payload.iat as number) ?? 0

      // Phase 7: 撤销检查 (PK 查, 1 RTT)
      const row = sqlite
        .prepare('SELECT tokens_valid_after, role FROM users WHERE id = ?')
        .get(userId) as { tokens_valid_after: number; role: 'ADMIN' | 'USER' | 'GUEST' } | undefined
      if (!row) {
        return reply.code(401).send({ code: 'USER_NOT_FOUND', message: 'user no longer exists' })
      }
      if (iat * 1000 < row.tokens_valid_after) {
        return reply.code(401).send({ code: 'TOKEN_REVOKED', message: 'token issued before logout' })
      }

      req.user = {
        id: userId,
        role: (payload.role as AuthUser['role']) ?? row.role,
        scopes: (payload.scopes as string[]) ?? [],
      }
    } catch {
      return reply.code(401).send({ code: 'TOKEN_INVALID', message: 'invalid or expired token' })
    }
  })

  // 2. requireAdmin
  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    await (app as unknown as { authenticate: (r: FastifyRequest, rp: FastifyReply) => Promise<void> }).authenticate(
      req,
      reply,
    )
    if (reply.sent) return
    if (req.user?.role !== 'ADMIN') {
      return reply.code(403).send({ code: 'ADMIN_REQUIRED', message: 'admin role required' })
    }
  })

  // 3. 全局 onResponse audit hook
  app.addHook('onResponse', async (req, reply) => {
    await audit.log({
      type: 'api.call',
      severity: reply.statusCode >= 500 ? 'ERROR' : 'INFO',
      user_id: req.user?.id,
      session_id: (req.params as Record<string, string>)?.id,
      action: `${req.method} ${req.routeOptions?.url ?? req.url}`,
      args_json: JSON.stringify({ query: req.query, params: req.params }).slice(0, 500),
      result_summary: `HTTP ${reply.statusCode}`,
      duration_ms: Math.round(reply.elapsedTime),
      client_ip: req.ip,
      user_agent: req.headers['user-agent']?.slice(0, 200),
    })
  })
}
