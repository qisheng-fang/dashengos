// packages/backend/src/api/phase5.ts · v0.3 spec §11-13
//
// Phase 5 — real implementations:
//   §11 auth/SSO: GitHub OAuth (5 providers scaffold for future)
//   §11.3 API keys: 创建/列表/吊销
//   §12 marketplace: list/install/uninstall
//   §13 billing: 3 tier + 用量记录 + Stripe 真 webhook 验签
//   Phase 7.5: 真实 Stripe webhook (HMAC-SHA256 验签 + replay 保护 + timingSafeEqual)
//   Phase 8  : admin-only Stripe simulator (构合法 HMAC 打真 webhook, 不依赖真 sandbox)
//
// All endpoints require Bearer JWT (Phase 2 auth) unless noted.
//
// GitHub OAuth is wired end-to-end (real code exchange + userinfo +
// local user creation/linking). Google/Microsoft/Feishu/Dingtalk have
// the same shape but require their own client_id/client_secret env
// vars; the init endpoint returns the right authorize URL for each.
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { sqlite } from '../storage/db.js'
import { issueTokens } from '../core/gateway.js'
import { config } from '../config.js'
import { metrics } from '../core/metrics.js'

// ============================================================================
// 1. auth/SSO — real GitHub OAuth (others scaffold for Phase 6)
// ============================================================================

interface SSOProvider {
  name: string
  authUrl: string
  tokenUrl: string
  userInfoUrl: string
  emailUrl?: string
  scopes: string[]
  /** Maps provider user JSON → our User. Returns null if invalid. */
  parse: (raw: unknown) => { externalId: string; username: string; email: string | null; avatar?: string } | null
}

const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails'

function parseGitHubUser(raw: unknown): { externalId: string; username: string; email: string | null; avatar?: string } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = r.id
  const login = r.login
  if (typeof id !== 'number' && typeof id !== 'string') return null
  if (typeof login !== 'string') return null
  const email = typeof r.email === 'string' && r.email ? r.email : null
  const avatar = typeof r.avatar_url === 'string' ? r.avatar_url : undefined
  return { externalId: String(id), username: login, email, avatar }
}

const SSOProviders: Record<string, SSOProvider> = {
  github: {
    name: 'GitHub',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    emailUrl: GITHUB_EMAILS_URL,
    scopes: ['read:user', 'user:email'],
    parse: parseGitHubUser,
  },
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: ['openid', 'email', 'profile'],
    parse: (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const sub = r.sub
      const email = typeof r.email === 'string' ? r.email : null
      const name = typeof r.name === 'string' ? r.name : null
      const picture = typeof r.picture === 'string' ? r.picture : undefined
      if (typeof sub !== 'string') return null
      return { externalId: sub, username: name || email?.split('@')[0] || sub, email, avatar: picture }
    },
  },
  microsoft: {
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scopes: ['openid', 'email', 'profile'],
    parse: (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const sub = r.sub
      const email = typeof r.email === 'string' ? r.email : null
      const name = typeof r.name === 'string' ? r.name : null
      if (typeof sub !== 'string') return null
      return { externalId: sub, username: name || email?.split('@')[0] || sub, email }
    },
  },
  feishu: {
    name: '飞书',
    authUrl: 'https://open.feishu.cn/open-apis/authen/v1/index',
    tokenUrl: 'https://open.feishu.cn/open-apis/authen/v2/oidc/access_token',
    userInfoUrl: '', // v2 OIDC: access_token 响应里直接含 user info
    scopes: ['openid', 'email', 'profile'],
    parse: (raw) => {
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      if (typeof r.open_id !== 'string') return null
      return {
        externalId: r.open_id,
        username: (typeof r.user_name === 'string' ? r.user_name : null) || r.open_id,
        email: typeof r.email === 'string' ? r.email : null,
        avatar: typeof r.avatar_url === 'string' ? r.avatar_url : undefined,
      }
    },
  },
  dingtalk: {
    name: '钉钉',
    authUrl: 'https://oapi.dingtalk.com/connect/oauth2/sns_authorize',
    tokenUrl: 'https://oapi.dingtalk.com/connect/oauth2/sns_token',
    userInfoUrl: 'https://oapi.dingtalk.com/connect/oauth2/sns_userinfo',
    scopes: ['snsapi_login'],
    parse: (raw) => {
      // raw = user_info shape from /sns_userinfo: { nick, openid, unionid }
      if (!raw || typeof raw !== 'object') return null
      const r = raw as Record<string, unknown>
      const uid =
        (typeof r.unionid === 'string' ? r.unionid : null) ||
        (typeof r.openid === 'string' ? r.openid : null)
      if (!uid) return null
      return {
        externalId: uid,
        username: (typeof r.nick === 'string' ? r.nick : null) || uid,
        email: null, // 钉钉扫码登录不返 email
      }
    },
  },
}

// Phase 6.5: real OIDC flows for github / google / microsoft.
// Feishu + Dingtalk stay scaffolded (non-standard OAuth; Phase 6.6).
type OidcFlow = (
  code: string,
  creds: { clientId: string; clientSecret: string },
  req: FastifyRequest,
) => Promise<GitHubUser | null>

const OIDC_FLOWS: Record<string, OidcFlow | undefined> = {}

// Phase 6: SSO sessions are persisted in sso_sessions
// Phase C.3 (2026-06-16) TTL 10min → 60s (原太宽, 给 attacker 充裕时间)
const SSO_TTL_MS = 60_000

function gcSsoSessions() {
  sqlite.prepare('DELETE FROM sso_sessions WHERE expires_at < ?').run(Date.now())
}

const SSOProviderSchema = z.object({
  provider: z.enum(['github', 'google', 'microsoft', 'feishu', 'dingtalk']),
  redirect_uri: z.string().url().optional(),
})

function getSSOClientCreds(provider: string): { clientId: string; clientSecret: string } | null {
  const env = process.env
  const upper = provider.toUpperCase()
  const clientId = env[`DASHE_SSO_${upper}_CLIENT_ID`]
  const clientSecret = env[`DASHE_SSO_${upper}_CLIENT_SECRET`]
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export async function phase5Routes(app: FastifyInstance) {
  // --------------------------------------------------------------------------
  // §11.1 SSO init: /api/v1/auth/sso/init
  //   Body: { provider, redirect_uri? }
  //   Returns: { auth_url, state, session_id }
  // --------------------------------------------------------------------------
  app.post('/auth/sso/init', async (req, reply) => {
    const parsed = SSOProviderSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const { provider, redirect_uri } = parsed.data
    const cfg = SSOProviders[provider]
    if (!cfg) {
      return reply.code(400).send({ code: 'UNSUPPORTED_PROVIDER' })
    }
    const creds = getSSOClientCreds(provider)
    if (!creds) {
      return reply.code(503).send({
        code: 'SSO_NOT_CONFIGURED',
        message: `set DASHE_SSO_${provider.toUpperCase()}_CLIENT_ID and _CLIENT_SECRET env vars`,
      })
    }
    // Phase C.3 (2026-06-16) randomBytes(32) 替代 ulid() — ulid 时间戳已知时可降难度
    // (80 bit 随机 + 48 bit 时间戳). 256 bit 真随机
    const state = randomBytes(32).toString('base64url')
    const sessionId = ulid()
    const now = Date.now()
    gcSsoSessions()
    sqlite
      .prepare(
        'INSERT INTO sso_sessions (id, provider, state, redirect_uri, user_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(sessionId, provider, state, redirect_uri || '/sso/callback', null, now, now + SSO_TTL_MS)
    const callbackUrl = `${getPublicBase(req)}/api/v1/auth/sso/callback`
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: cfg.scopes.join(' '),
      state: `${sessionId}:${state}`,
    })
    const authUrl = `${cfg.authUrl}?${params.toString()}`
    return reply.send({ auth_url: authUrl, state, session_id: sessionId })
  })

  // --------------------------------------------------------------------------
  // §11.2 SSO callback: /api/v1/auth/sso/callback
  //   Body: { code, state, session_id }
  //   For github: real code→token exchange, real userinfo fetch, local
  //   user creation/linking, JWT issue
  //   For other providers: stub (returns mock)
  // --------------------------------------------------------------------------
  const CallbackSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
    session_id: z.string().min(1),
  })
  app.post('/auth/sso/callback', async (req, reply) => {
    const parsed = CallbackSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const { code, state, session_id } = parsed.data
    const session = sqlite
      .prepare('SELECT id, provider, state, redirect_uri, user_id, created_at, expires_at FROM sso_sessions WHERE id = ?')
      .get(session_id) as
      | { id: string; provider: string; state: string; redirect_uri: string; user_id: string | null; created_at: number; expires_at: number }
      | undefined
    if (!session) {
      metrics.ssoCallback.inc({ provider: session_id ? 'unknown' : 'unknown', result: 'not_found' })
      return reply.code(404).send({ code: 'SSO_SESSION_NOT_FOUND' })
    }
    if (Date.now() > session.expires_at) {
      sqlite.prepare('DELETE FROM sso_sessions WHERE id = ?').run(session_id)
      metrics.ssoCallback.inc({ provider: session.provider, result: 'expired' })
      return reply.code(410).send({ code: 'SSO_SESSION_EXPIRED' })
    }
    if (session.state !== state) {
      metrics.ssoCallback.inc({ provider: session.provider, result: 'state_mismatch' })
      return reply.code(400).send({ code: 'SSO_STATE_MISMATCH' })
    }
    sqlite.prepare('DELETE FROM sso_sessions WHERE id = ?').run(session_id)

    const cfg = SSOProviders[session.provider]
    if (!cfg) {
      return reply.code(400).send({ code: 'UNSUPPORTED_PROVIDER' })
    }
    const creds = getSSOClientCreds(session.provider)

    // Real OIDC: github / google / microsoft (all use code→token→userinfo)
    const oa = OIDC_FLOWS[session.provider]
    if (oa && creds) {
      try {
        const extUser = await oa(code, creds, req)
        if (!extUser) {
          return reply.code(502).send({ code: 'SSO_USERINFO_FAILED' })
        }
        const localUser = upsertSsoUser(session.provider, extUser)
        if (!localUser) {
          return reply.code(500).send({ code: 'USER_CREATE_FAILED' })
        }
        const tokens = issueTokens(localUser.id, localUser.role, [], {
          jwtSecret: config.DASHENG_JWT_SECRET,
          accessTokenTtlSec: config.DASHENG_JWT_ACCESS_TTL_SEC,
          refreshTokenTtlSec: config.DASHENG_JWT_REFRESH_TTL_SEC,
          rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
        })
        metrics.ssoCallback.inc({ provider: session.provider, result: 'success' })
        return reply.send({
          ...tokens,
          user: localUser,
        })
      } catch (e) {
        metrics.ssoCallback.inc({ provider: session.provider, result: 'upstream_failed' })
        return reply.code(502).send({
          code: 'SSO_UPSTREAM_FAILED',
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }

    // Feishu / Dingtalk: non-standard OAuth (Phase 6.6)
    if (!creds) {
      return reply.code(503).send({
        code: 'SSO_NOT_CONFIGURED',
        message: `provider ${session.provider} not configured`,
      })
    }
    return reply.code(501).send({
      code: 'SSO_PROVIDER_NOT_IMPLEMENTED',
      message: `${session.provider} OAuth flow ships in Phase 6.6`,
    })
  })

  // --------------------------------------------------------------------------
  // §11.3 API keys: /api/v1/auth/keys
  //   Phase 6: persisted in api_keys (raw returned once at create; hash stored)
  // --------------------------------------------------------------------------
  const KeyCreateSchema = z.object({
    name: z.string().min(1).max(64),
    scopes: z.array(z.string()).default([]),
  })
  app.post('/auth/keys', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const parsed = KeyCreateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const raw = randomBytes(32).toString('base64url')
    const prefix = raw.slice(0, 8)
    const keyId = ulid()
    const hash = createHash('sha256').update(raw.slice(8)).digest('hex')
    const now = Date.now()
    sqlite
      .prepare(
        'INSERT INTO api_keys (id, user_id, name, prefix, hash, scopes_json, created_at, last_used_at, revoked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(keyId, userId, parsed.data.name, prefix, hash, JSON.stringify(parsed.data.scopes), now, null, 0)
    metrics.apiKeyCreate.inc()
    return reply.send({
      id: keyId,
      name: parsed.data.name,
      key: `dsk_${prefix}${raw.slice(8)}`,
      scopes: parsed.data.scopes,
      created_at: now,
    })
  })
  app.get('/auth/keys', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const rows = sqlite
      .prepare(
        'SELECT id, name, prefix, scopes_json, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC',
      )
      .all(userId) as Array<{
      id: string
      name: string
      prefix: string
      scopes_json: string
      created_at: number
      last_used_at: number | null
      revoked: number
    }>
    return reply.send({
      keys: rows.map((k) => ({
        id: k.id,
        name: k.name,
        prefix: k.prefix,
        scopes: JSON.parse(k.scopes_json),
        created_at: k.created_at,
        last_used_at: k.last_used_at,
        revoked: !!k.revoked,
      })),
    })
  })

  // §11.3b Revoke: soft-delete (revoked=1) keeps audit trail
  app.delete('/auth/keys/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const keyId = (req.params as any).id as string
    const res = sqlite
      .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ? AND revoked = 0')
      .run(keyId, userId)
    if (res.changes === 0) return reply.code(404).send({ code: 'KEY_NOT_FOUND' })
    return reply.send({ ok: true, id: keyId, revoked_at: Date.now() })
  })

  // §11.3c Verify: dsk_xxx → 1h JWT (public; the whole point is to get auth)
  const KeyVerifySchema = z.object({ key: z.string().min(1) })
  app.post('/auth/keys/verify', async (req, reply) => {
    const parsed = KeyVerifySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const full = parsed.data.key
    if (!full.startsWith('dsk_')) {
      metrics.apiKeyVerify.inc({ result: 'invalid_format' })
      return reply.code(401).send({ code: 'INVALID_KEY_FORMAT' })
    }
    const secret = full.slice(4)
    const prefix = secret.slice(0, 8)
    const raw = secret.slice(8)
    const hash = createHash('sha256').update(raw).digest('hex')

    const row = sqlite
      .prepare('SELECT id, user_id, scopes_json, revoked FROM api_keys WHERE prefix = ? AND hash = ?')
      .get(prefix, hash) as
      | { id: string; user_id: string; scopes_json: string; revoked: number }
      | undefined
    if (!row || row.revoked) {
      metrics.apiKeyVerify.inc({ result: 'invalid' })
      return reply.code(401).send({ code: 'INVALID_KEY' })
    }

    sqlite.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id)

    const user = sqlite.prepare('SELECT id, role FROM users WHERE id = ?').get(row.user_id) as
      | { id: string; role: 'ADMIN' | 'USER' | 'GUEST' }
      | undefined
    if (!user) return reply.code(401).send({ code: 'USER_NOT_FOUND' })

    const scopes = JSON.parse(row.scopes_json) as string[]
    const tokens = issueTokens(user.id, user.role, scopes, {
      jwtSecret: config.DASHENG_JWT_SECRET,
      accessTokenTtlSec: 3600,
      refreshTokenTtlSec: config.DASHENG_JWT_REFRESH_TTL_SEC,
      rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
    })
    metrics.apiKeyVerify.inc({ result: 'success' })
    return reply.send({
      access_token: tokens.access_token,
      expires_in: 3600,
      user_id: user.id,
      scopes,
      key_id: row.id,
    })
  })

  // ==========================================================================
  // 2. Agent marketplace — /api/v1/marketplace/agents
  //   Phase 6: persisted in marketplace_installs (user_id, agent_id) PK
  // ==========================================================================
  app.get('/marketplace/agents', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const installRows = sqlite
      .prepare('SELECT agent_id FROM marketplace_installs WHERE user_id = ?')
      .all(userId) as Array<{ agent_id: string }>
    const installed = new Set(installRows.map((r) => r.agent_id))
    const allAgents = [
      { id: 'code-reviewer', name: 'Code Reviewer', version: '1.2.0', author: '@bytedance', category: 'code', installed: installed.has('code-reviewer') },
      { id: 'deep-researcher', name: 'Deep Researcher', version: '2.0.1', author: '@anthropic', category: 'research', installed: installed.has('deep-researcher') },
      { id: 'design-assistant', name: 'Design Assistant', version: '1.0.0', author: '@anthropic', category: 'design', installed: installed.has('design-assistant') },
      { id: 'data-analyst', name: 'Data Analyst', version: '1.5.0', author: '@workbuddy', category: 'data', installed: installed.has('data-analyst') },
      { id: 'security-reviewer', name: 'Security Reviewer', version: '1.0.3', author: '@community', category: 'security', installed: installed.has('security-reviewer') },
      { id: 'custom-workflow', name: 'Custom Workflow', version: '0.9.0', author: '@user', category: 'custom', installed: installed.has('custom-workflow') },
    ]
    return reply.send({ agents: allAgents })
  })

  const InstallSchema = z.object({ version: z.string().optional() })
  app.post('/marketplace/agents/:id/install', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const agentId = (req.params as any).id as string
    const parsed = InstallSchema.safeParse(req.body || {})
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const version = parsed.data.version || 'latest'
    const now = Date.now()
    sqlite
      .prepare(
        'INSERT INTO marketplace_installs (user_id, agent_id, version, installed_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, agent_id) DO UPDATE SET version = excluded.version, installed_at = excluded.installed_at',
      )
      .run(userId, agentId, version, now)
    return reply.send({
      agent_id: agentId,
      version,
      installed_at: now,
      user_id: userId,
    })
  })

  app.post('/marketplace/agents/:id/uninstall', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const agentId = (req.params as any).id as string
    const res = sqlite
      .prepare('DELETE FROM marketplace_installs WHERE user_id = ? AND agent_id = ?')
      .run(userId, agentId)
    return reply.send({ agent_id: agentId, uninstalled_at: Date.now(), removed: res.changes > 0 })
  })

  // ==========================================================================
  // 3. Billing — /api/v1/billing
  //   Phase 6: persisted in billing_tier (PK user_id) + billing_usage
  //            ((user_id, period_start) PK; ON CONFLICT accumulates)
  // ==========================================================================
  const TIER_LIMITS = {
    free: { calls_per_month: 1000, tokens_per_month: 100_000, sandbox_exec_seconds_per_month: 600, storage_gb: 1 },
    pro: { calls_per_month: 50_000, tokens_per_month: 5_000_000, sandbox_exec_seconds_per_month: 3600, storage_gb: 50 },
    enterprise: { calls_per_month: 1_000_000, tokens_per_month: 100_000_000, sandbox_exec_seconds_per_month: 86400, storage_gb: 1000 },
  } as const

  // Align period_start to a 30-day boundary so any two requests in the
  // same window map to the same PK row (ON CONFLICT accumulates).
  const periodStart = () =>
    Math.floor(Date.now() / (30 * 24 * 60 * 60 * 1000)) * (30 * 24 * 60 * 60 * 1000)

  app.get('/billing/tier', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const row = sqlite
      .prepare('SELECT tier FROM billing_tier WHERE user_id = ?')
      .get(userId) as { tier: 'free' | 'pro' | 'enterprise' } | undefined
    const tier = row?.tier || 'free'
    return reply.send({
      tier,
      limits: TIER_LIMITS[tier],
      features: {
        sso: tier !== 'free',
        custom_agents: tier !== 'free',
        priority_queue: tier === 'enterprise',
        dedicated_sandbox: tier === 'enterprise',
      },
    })
  })

  app.get('/billing/usage', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const now = Date.now()
    const ps = periodStart()
    const rec =
      (sqlite
        .prepare(
          'SELECT period_start, period_end, calls, tokens, sandbox_exec_seconds, storage_bytes FROM billing_usage WHERE user_id = ? AND period_start = ?',
        )
        .get(userId, ps) as
        | { period_start: number; period_end: number; calls: number; tokens: number; sandbox_exec_seconds: number; storage_bytes: number }
        | undefined) || {
        user_id: userId,
        period_start: ps,
        period_end: now,
        calls: 0,
        tokens: 0,
        sandbox_exec_seconds: 0,
        storage_bytes: 0,
      }
    return reply.send({ usage: rec, period: '30d' })
  })

  app.post('/billing/usage/record', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = z
      .object({
        calls: z.number().int().nonnegative().default(0),
        tokens: z.number().int().nonnegative().default(0),
        sandbox_exec_seconds: z.number().nonnegative().default(0),
        storage_bytes: z.number().int().nonnegative().default(0),
      })
      .safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const userId = req.user!.id
    const now = Date.now()
    const ps = periodStart()
    sqlite
      .prepare(
        `INSERT INTO billing_usage (user_id, period_start, period_end, calls, tokens, sandbox_exec_seconds, storage_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, period_start) DO UPDATE SET
           period_end = excluded.period_end,
           calls = calls + excluded.calls,
           tokens = tokens + excluded.tokens,
           sandbox_exec_seconds = sandbox_exec_seconds + excluded.sandbox_exec_seconds,
           storage_bytes = excluded.storage_bytes`,
      )
      .run(
        userId,
        ps,
        now,
        parsed.data.calls,
        parsed.data.tokens,
        parsed.data.sandbox_exec_seconds,
        parsed.data.storage_bytes,
      )
    return reply.send({ ok: true })
  })

  // §13.1b Tier set: admin only (Phase 6.5; Phase 7 will replace with Stripe webhook)
  const TierSetSchema = z.object({
    user_id: z.string(),
    tier: z.enum(['free', 'pro', 'enterprise']),
  })
  app.post('/billing/tier', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user!.role !== 'ADMIN') {
      return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
    }
    const parsed = TierSetSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const { user_id, tier } = parsed.data
    const u = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(user_id) as
      | { id: string }
      | undefined
    if (!u) return reply.code(404).send({ code: 'USER_NOT_FOUND' })
    const now = Date.now()
    sqlite
      .prepare(
        'INSERT INTO billing_tier (user_id, tier, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, updated_at = excluded.updated_at',
      )
      .run(user_id, tier, now)
    metrics.tierSet.inc({ tier })
    return reply.send({ ok: true, user_id, tier, updated_at: now })
  })

  // ============================================================================
  // §13.1c Stripe simulator (admin only) · Phase 8
  // 用途: 不依赖真 Stripe sandbox, 本地 e2e 测整条 webhook 链路
  //   1. 构造合法 customer.subscription.{created,updated,deleted} 事件
  //   2. 用 DASHENG_STRIPE_WEBHOOK_SECRET 算 HMAC-SHA256
  //   3. 用 fetch 自打 /api/v1/billing/stripe/webhook (走完整验签 + DB 写入 + metrics)
  //   prod 切换 MOCK_MODE=false 即可接真 Stripe — 这条 simulator 仅 dev/admin 用
  // ============================================================================
  const StripeSimulateSchema = z.object({
    user_id: z.string(),
    target_tier: z.enum(['free', 'pro', 'enterprise']),
    event_type: z.enum(['created', 'updated', 'deleted']).default('updated'),
  })

  app.post('/billing/stripe/simulate', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (req.user!.role !== 'ADMIN') {
      return reply.code(403).send({ code: 'ADMIN_REQUIRED' })
    }
    const parsed = StripeSimulateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const { user_id, target_tier, event_type } = parsed.data
    const u = sqlite.prepare('SELECT id FROM users WHERE id = ?').get(user_id) as { id: string } | undefined
    if (!u) return reply.code(404).send({ code: 'USER_NOT_FOUND' })

    // Map tier → Stripe price id (必须和 .env 里 DASHENG_STRIPE_PRICE_* 一致)
    const priceId =
      target_tier === 'pro'
        ? config.DASHENG_STRIPE_PRICE_PRO
        : target_tier === 'enterprise'
          ? config.DASHENG_STRIPE_PRICE_ENTERPRISE
          : 'price_free_dev'

    // 构造和真 Stripe 同样形状的事件 payload
    const eventType =
      event_type === 'deleted'
        ? 'customer.subscription.deleted'
        : event_type === 'created'
          ? 'customer.subscription.created'
          : 'customer.subscription.updated'

    const event = {
      id: `evt_sim_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      type: eventType,
      data: {
        object: {
          id: `sub_sim_${user_id}`,
          customer: `cus_sim_${user_id}`,
          status: event_type === 'deleted' ? 'canceled' : 'active',
          metadata: { user_id },
          items: { data: [{ price: { id: priceId } }] },
        },
      },
    }
    const rawBody = JSON.stringify(event)
    const timestamp = Math.floor(Date.now() / 1000).toString()

    // 算 HMAC-SHA256(`${t}.${rawBody}`, secret) — 和 stripe.ts 里 verifyStripeSignature 用同一算法
    const { createHmac } = await import('node:crypto')
    const v1 = createHmac('sha256', config.DASHENG_STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex')
    const sigHeader = `t=${timestamp},v1=${v1}`

    // 自打 webhook (localhost 直接打, 走完整 middleware chain)
    const proto = req.headers['x-forwarded-proto'] || 'http'
    const host = req.headers.host || 'localhost:8000'
    const url = `${proto}://${host}/api/v1/billing/stripe/webhook`

    let res
    let resBody: any
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': sigHeader,
        },
        body: rawBody,
      })
      resBody = await res.json().catch(() => ({}))
    } catch (e) {
      app.log.error({ err: e, url }, 'stripe simulator fetch failed')
      return reply.code(502).send({ code: 'SIMULATOR_FETCH_FAILED', message: String(e) })
    }

    app.log.info(
      { user_id, target_tier, event_type, webhook_status: res.status, webhook_body: resBody },
      'stripe simulate fired',
    )

    if (res.status >= 400) {
      return reply.code(502).send({
        code: 'WEBHOOK_REJECTED',
        webhook_status: res.status,
        webhook_body: resBody,
      })
    }

    return reply.send({
      ok: true,
      event_type: eventType,
      target_tier,
      webhook_status: res.status,
      webhook_body: resBody,
    })
  })
}

// ============================================================================
// GitHub OAuth helpers
// ============================================================================

interface GitHubUser {
  externalId: string
  username: string
  email: string | null
  avatar?: string
}

function getPublicBase(req: FastifyRequest): string {
  const env = process.env
  if (env.DASHE_PUBLIC_BASE_URL) return env.DASHE_PUBLIC_BASE_URL.replace(/\/$/, '')
  // Fallback: infer from request
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http'
  const host = (req.headers['host'] as string) || '127.0.0.1:8000'
  return `${proto}://${host}`
}

async function githubOAuth(
  code: string,
  creds: { clientId: string; clientSecret: string },
  req: FastifyRequest,
): Promise<GitHubUser | null> {
  const cfg = SSOProviders.github
  const callbackUrl = `${getPublicBase(req)}/api/v1/auth/sso/callback`

  // 1. Exchange code → access_token
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: callbackUrl,
    }),
  })
  if (!tokenRes.ok) {
    throw new Error(`github token exchange failed: ${tokenRes.status}`)
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string }
  if (!tokenJson.access_token) {
    throw new Error(`github token response missing access_token: ${tokenJson.error || 'unknown'}`)
  }
  const ghToken = tokenJson.access_token
  const ghAuth = `Bearer ${ghToken}`

  // 2. Fetch user info
  const userRes = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: ghAuth, Accept: 'application/json', 'User-Agent': 'DaShengOS' },
  })
  if (!userRes.ok) {
    throw new Error(`github userinfo failed: ${userRes.status}`)
  }
  const userRaw = await userRes.json()
  const parsed = cfg.parse(userRaw)
  if (!parsed) {
    throw new Error('github userinfo parse failed')
  }

  // 3. If email is private, fetch from /user/emails
  if (!parsed.email && cfg.emailUrl) {
    const emailsRes = await fetch(cfg.emailUrl, {
      headers: { Authorization: ghAuth, Accept: 'application/json', 'User-Agent': 'DaShengOS' },
    })
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>
      const primary = emails.find((e) => e.primary && e.verified)
      if (primary) parsed.email = primary.email
    }
  }
  return parsed
}

// Standard OIDC: form-encoded token exchange (RFC 6749 §4.1.3)
async function standardOidcExchange(
  provider: 'google' | 'microsoft',
  code: string,
  creds: { clientId: string; clientSecret: string },
  req: FastifyRequest,
): Promise<GitHubUser | null> {
  const cfg = SSOProviders[provider]
  const callbackUrl = `${getPublicBase(req)}/api/v1/auth/sso/callback`

  // 1. code → access_token (form-encoded body, not JSON)
  const tokenBody = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
  })
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: tokenBody.toString(),
  })
  if (!tokenRes.ok) {
    throw new Error(`${provider} token exchange failed: ${tokenRes.status}`)
  }
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    error?: string
    error_description?: string
  }
  if (!tokenJson.access_token) {
    throw new Error(
      `${provider} token: ${tokenJson.error || 'no access_token'} ${tokenJson.error_description || ''}`,
    )
  }

  // 2. userinfo GET
  const userRes = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, Accept: 'application/json' },
  })
  if (!userRes.ok) {
    throw new Error(`${provider} userinfo failed: ${userRes.status}`)
  }
  const userRaw = await userRes.json()
  const parsed = cfg.parse(userRaw)
  if (!parsed) throw new Error(`${provider} userinfo parse failed`)
  return parsed
}

const googleOAuth: OidcFlow = (code, creds, req) => standardOidcExchange('google', code, creds, req)
const microsoftOAuth: OidcFlow = (code, creds, req) => standardOidcExchange('microsoft', code, creds, req)

// Phase 6.6: Feishu OIDC v2 — same form-encoded flow as Google/Microsoft,
// but /access_token response directly contains user info (no separate /userinfo call).
async function feishuOAuth(
  code: string,
  creds: { clientId: string; clientSecret: string },
  req: FastifyRequest,
): Promise<GitHubUser | null> {
  const callbackUrl = `${getPublicBase(req)}/api/v1/auth/sso/callback`
  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: callbackUrl,
    grant_type: 'authorization_code',
  })
  const res = await fetch('https://open.feishu.cn/open-apis/authen/v2/oidc/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`feishu token exchange failed: ${res.status}`)
  const json = (await res.json()) as {
    access_token?: string
    open_id?: string
    union_id?: string
    email?: string
    user_name?: string
    avatar_url?: string
    error?: string
    error_description?: string
  }
  if (!json.access_token || !json.open_id) {
    throw new Error(
      `feishu: ${json.error || 'no access_token/open_id'} ${json.error_description || ''}`,
    )
  }
  return {
    externalId: json.open_id,
    username: json.user_name || json.union_id || json.open_id,
    email: json.email ?? null,
    avatar: json.avatar_url,
  }
}

// Phase 6.6: Dingtalk sns_authorize flow — non-standard OAuth with
// HMAC-SHA256(timestamp, secret) → base64 signature in query params.
async function dingtalkOAuth(
  code: string,
  creds: { clientId: string; clientSecret: string },
  _req: FastifyRequest,
): Promise<GitHubUser | null> {
  // 1. signature = base64(HMAC-SHA256(timestamp, accessSecret))
  const timestamp = String(Date.now())
  const signature = createHmac('sha256', creds.clientSecret).update(timestamp).digest('base64')

  // 2. POST /sns_token (signature in query, code in JSON body)
  const tokenUrl = new URL('https://oapi.dingtalk.com/connect/oauth2/sns_token')
  tokenUrl.searchParams.set('appid', creds.clientId)
  tokenUrl.searchParams.set('timestamp', timestamp)
  tokenUrl.searchParams.set('signature', signature)

  const res = await fetch(tokenUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmp_auth_code: code }),
  })
  if (!res.ok) throw new Error(`dingtalk sns_token failed: ${res.status}`)
  const json = (await res.json()) as {
    errcode?: number
    errmsg?: string
    sns_token_openid?: {
      access_token: string
      openid: string
      unionid?: string
      expires_in?: number
    }
  }
  if (json.errcode !== 0 || !json.sns_token_openid) {
    throw new Error(`dingtalk sns_token: errcode=${json.errcode} ${json.errmsg || ''}`)
  }
  const { access_token, openid, unionid } = json.sns_token_openid

  // 3. GET /sns_userinfo 拿昵称
  const infoUrl = new URL('https://oapi.dingtalk.com/connect/oauth2/sns_userinfo')
  infoUrl.searchParams.set('access_token', access_token)
  infoUrl.searchParams.set('openid', openid)
  const infoRes = await fetch(infoUrl.toString())
  if (!infoRes.ok) throw new Error(`dingtalk sns_userinfo failed: ${infoRes.status}`)
  const infoJson = (await infoRes.json()) as {
    errcode?: number
    errmsg?: string
    user_info?: { nick?: string; openid?: string; unionid?: string }
  }
  if (infoJson.errcode !== 0 || !infoJson.user_info) {
    throw new Error(`dingtalk userinfo: errcode=${infoJson.errcode} ${infoJson.errmsg || ''}`)
  }
  return {
    externalId: unionid || openid,
    username: infoJson.user_info.nick || unionid || openid,
    email: null,
  }
}

interface SsoLocalUser {
  id: string
  username: string
  email: string | null
  role: 'ADMIN' | 'USER' | 'GUEST'
  avatar?: string
  provider: string
  sso: true
}

interface UserRow {
  id: string
  username: string
  email: string | null
  role: 'ADMIN' | 'USER' | 'GUEST'
}

function upsertSsoUser(provider: string, ext: GitHubUser): SsoLocalUser | null {
  // Phase 6: look up via sso_links (provider, external_id) — collision-proof.
  // ssoUsername = `${provider}_${externalId}` (e.g. github_12345678) is
  // globally unique because externalId is stable per provider.
  const link = sqlite
    .prepare('SELECT user_id FROM sso_links WHERE provider = ? AND external_id = ?')
    .get(provider, ext.externalId) as { user_id: string } | undefined

  if (link) {
    // Existing SSO user — refresh email if changed
    if (ext.email) {
      sqlite
        .prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .run(ext.email, Date.now(), link.user_id)
    }
    const u = sqlite
      .prepare('SELECT id, username, email, role FROM users WHERE id = ?')
      .get(link.user_id) as UserRow
    return {
      id: u.id,
      username: u.username,
      email: ext.email,
      role: u.role,
      avatar: ext.avatar,
      provider,
      sso: true,
    }
  }

  // New SSO user — INSERT user + INSERT sso_link in one transaction
  const userId = ulid()
  const ssoUsername = `${provider}_${ext.externalId}`
  const now = Date.now()
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare(
        'INSERT INTO users (id, username, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, ssoUsername, ext.email, '', 'USER', 'ACTIVE', now, now)
    sqlite
      .prepare('INSERT INTO sso_links (provider, external_id, user_id, linked_at) VALUES (?, ?, ?, ?)')
      .run(provider, ext.externalId, userId, now)
  })
  tx()
  return {
    id: userId,
    username: ssoUsername,
    email: ext.email,
    role: 'USER',
    avatar: ext.avatar,
    provider,
    sso: true,
  }
}

// Phase 6.5: wire real OIDC flows into the dispatcher map
OIDC_FLOWS.github = githubOAuth
OIDC_FLOWS.google = googleOAuth
OIDC_FLOWS.microsoft = microsoftOAuth
// Phase 6.6: Feishu (OIDC v2) + Dingtalk (HMAC-signed)
OIDC_FLOWS.feishu = feishuOAuth
OIDC_FLOWS.dingtalk = dingtalkOAuth
