// packages/backend/src/api/social.ts · Track B (2026-06-15)
// 3 社媒 Agent Fastify 路由 (前缀 /api/v1/social)
//
// GET  /                    列 3 social agents
// GET  /:id                 取单个 social agent
// GET  /:id/tools           列 agent 的工具定义
// POST /:id/execute         调 agent 的 tool
// GET  /workers/health      5 worker 健康检查 (sau/douyin/wechat/video_parser/pixelle)

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSocialAgent, getSocialAgentRegistry, getSocialAgentsAsBuiltin, socialWorker } from '../agents/social/index.js'
import { sqlite } from '../storage/db.js'
import { encrypt, decrypt, getCookieEncryptionKey } from '../core/crypto.js'
import { randomUUID } from 'node:crypto'

const ExecuteSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
})

// Social cookie schemas
const PLATFORMS = ['douyin', 'xiaohongshu', 'wechat'] as const
const PutCookieSchema = z.object({
  cookie_value: z.string().min(1).max(65536),
  cookie_name: z.string().min(1).max(64).default('default'),
  metadata: z
    .object({
      nickname: z.string().optional(),
      avatar: z.string().optional(),
      expires_at: z.number().optional(),
      notes: z.string().optional(),
    })
    .default({}),
})
const CookiePlatformSchema = z.enum(PLATFORMS)

export async function socialRoutes(app: FastifyInstance) {
  // GET / — 列 3 social agents
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      agents: getSocialAgentsAsBuiltin(),
      count: Object.keys(getSocialAgentRegistry()).length,
    })
  })

  // GET /:id — 取单个 agent
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    return reply.send({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      capabilities: agent.capabilities,
      tools: agent.tools,
    })
  })

  // GET /:id/tools — 列 agent 的工具定义
  app.get('/:id/tools', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    return reply.send({
      agent_id: agent.id,
      tools: agent.tools,
      count: agent.tools.length,
    })
  })

  // POST /:id/execute — 调 agent 的 tool (Track B.1: 自动注入用户 cookie)
  app.post('/:id/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = ExecuteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_FAILED',
        issues: parsed.error.issues,
      })
    }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    // Track B.1: 注入当前用户的 cookie 到 worker
    socialWorker.setUserId(req.user!.id)
    const result = await agent.execute(parsed.data.tool, parsed.data.params)
    const status = result.ok ? 200 : 502
    return reply.code(status).send({
      agent_id: id,
      tool: parsed.data.tool,
      ...result,
    })
  })

  // GET /workers/health — 5 worker 健康检查 (debug 用, 帮老板查 worker 状态)
  app.get('/workers/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const health = await socialWorker.healthAll()
    const all_ok = Object.values(health).every((h) => h.ok)
    return reply.code(all_ok ? 200 : 503).send({
      all_ok,
      workers: health,
      timestamp: Date.now(),
    })
  })

  // ====================================================================
  // Track B.1 (2026-06-17): Social Media Cookie Management
  //   GET    /cookies                   列所有平台的 cookie 状态
  //   GET    /cookies/:platform        取解密后的 cookie 值
  //   PUT    /cookies/:platform        存/更新加密 cookie
  //   DELETE /cookies/:platform        删 cookie
  //   加密: AES-256-GCM, key = COOKIE_ENCRYPTION_KEY 或 JWT_SECRET 派生
  // ====================================================================

  // GET /cookies — 列所有平台的 cookie 状态 (不返回加密值)
  app.get('/cookies', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const rows = sqlite
      .prepare(
        'SELECT id, platform, cookie_name, metadata, created_at, updated_at FROM social_cookies WHERE user_id = ?',
      )
      .all(userId) as Array<{
      id: string
      platform: string
      cookie_name: string
      metadata: string
      created_at: number
      updated_at: number
    }>

    const cookies = rows.map((r) => {
      let meta = {}
      try {
        meta = JSON.parse(r.metadata)
      } catch {
        /* ignore */
      }
      return {
        id: r.id,
        platform: r.platform,
        cookie_name: r.cookie_name,
        metadata: meta,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }
    })

    // 汇总 per-platform 状态
    const status: Record<string, { has_cookie: boolean; count: number }> = {}
    for (const p of PLATFORMS) {
      const platformCookies = cookies.filter((c) => c.platform === p)
      status[p] = {
        has_cookie: platformCookies.length > 0,
        count: platformCookies.length,
      }
    }

    return reply.send({ cookies, status })
  })

  // GET /cookies/:platform — 取解密后的 cookie 值
  app.get('/cookies/:platform', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { platform: rawPlatform } = req.params as { platform: string }
    const platformParse = CookiePlatformSchema.safeParse(rawPlatform)
    if (!platformParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown platform' })
    }
    const userId = req.user!.id
    const platform = platformParse.data

    const row = sqlite
      .prepare(
        'SELECT id, platform, cookie_name, encrypted_value, metadata FROM social_cookies WHERE user_id = ? AND platform = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(userId, platform) as
      | { id: string; platform: string; cookie_name: string; encrypted_value: string; metadata: string }
      | undefined

    if (!row) {
      return reply.code(404).send({ code: 'COOKIE_NOT_FOUND', message: `no cookie for ${platform}` })
    }

    let cookieValue: string
    try {
      cookieValue = decrypt(row.encrypted_value, getCookieEncryptionKey())
    } catch {
      return reply.code(500).send({ code: 'DECRYPT_FAILED', message: 'cookie decryption failed (wrong key?)' })
    }

    let meta = {}
    try {
      meta = JSON.parse(row.metadata)
    } catch {
      /* ignore */
    }

    return reply.send({
      id: row.id,
      platform: row.platform,
      cookie_name: row.cookie_name,
      cookie_value: cookieValue,
      metadata: meta,
    })
  })

  // PUT /cookies/:platform — 存/更新加密 cookie
  app.put('/cookies/:platform', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { platform: rawPlatform } = req.params as { platform: string }
    const platformParse = CookiePlatformSchema.safeParse(rawPlatform)
    if (!platformParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown platform' })
    }
    const bodyParse = PutCookieSchema.safeParse(req.body)
    if (!bodyParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: bodyParse.error.issues })
    }

    const userId = req.user!.id
    const platform = platformParse.data
    const { cookie_value, cookie_name, metadata } = bodyParse.data
    const now = Date.now()

    // 加密
    const encrypted = encrypt(cookie_value, getCookieEncryptionKey())
    const metaJson = JSON.stringify(metadata)

    // upsert
    const existing = sqlite
      .prepare('SELECT id FROM social_cookies WHERE user_id = ? AND platform = ? AND cookie_name = ?')
      .get(userId, platform, cookie_name) as { id: string } | undefined

    if (existing) {
      sqlite
        .prepare(
          'UPDATE social_cookies SET encrypted_value = ?, metadata = ?, updated_at = ? WHERE id = ?',
        )
        .run(encrypted, metaJson, now, existing.id)
      return reply.send({ ok: true, id: existing.id, platform, cookie_name, action: 'updated' })
    }

    const id = randomUUID()
    sqlite
      .prepare(
        'INSERT INTO social_cookies (id, user_id, platform, cookie_name, encrypted_value, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, userId, platform, cookie_name, encrypted, metaJson, now, now)

    return reply.send({ ok: true, id, platform, cookie_name, action: 'created' })
  })

  // DELETE /cookies/:platform — 删 cookie
  app.delete('/cookies/:platform', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { platform: rawPlatform } = req.params as { platform: string }
    const platformParse = CookiePlatformSchema.safeParse(rawPlatform)
    if (!platformParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown platform' })
    }
    const userId = req.user!.id
    const platform = platformParse.data

    const result = sqlite
      .prepare('DELETE FROM social_cookies WHERE user_id = ? AND platform = ?')
      .run(userId, platform)

    if (result.changes === 0) {
      return reply.code(404).send({ code: 'COOKIE_NOT_FOUND', message: `no cookie for ${platform}` })
    }

    return reply.send({ ok: true, platform, deleted: result.changes })
  })
}
