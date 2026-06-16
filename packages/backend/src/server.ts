// packages/backend/src/server.ts · v0.3 spec §10-§19 (Fastify 5 + Drizzle + Redis)
// Phase 2 入口: 127.0.0.1:8000 + 47 端点 + 8 核心模块
// Track D.1 (2026-06-15) · 装 dotenv 让 backend 读 packages/backend/.env (含 SILICONFLOW_API_KEY 等)
//   ⚠️ 之前 v0.3 backend 不读 .env, 这是历史遗留 bug. 现在第一行 import 'dotenv/config'
import 'dotenv/config'

import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
// import websocket from '@fastify/websocket'
import sensible from '@fastify/sensible'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import jwt from 'jsonwebtoken'

import { config } from './config.js'
import { setupGateway } from './core/gateway.js'
import { authRoutes } from './api/auth.js'
import { sessionRoutes } from './api/sessions.js'
import { agentRoutes } from './api/agents.js'
import { skillRoutes } from './api/skills.js'
import { mcpRoutes } from './api/mcp.js'
import {
  toolRoutes,
  modelRoutes,
  fileRoutes,
  auditRoutes,
  settingsRoutes,
  systemRoutes,
  workspaceRoutes,
  secretRoutes,
} from './api/misc.js'
import { phase5Routes } from './api/phase5.js'
import { stripeRoutes } from './api/stripe.js'
import { metricsRoutes } from './api/metrics.js'
import { socialRoutes } from './api/social.js'  // Track B · 3 社媒 agent 路由 (2026-06-15)
import { initSchema, sqlite } from './storage/db.js'
import { sessionWSS } from './ws/session-ws.js'
import { metrics } from './core/metrics.js'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      transport:
        config.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            }
          : undefined,
    },
    // Phase D.8 (2026-06-16) X-Request-Id 贯穿 — 读 X-Request-Id 头或 nanoid 生成
    // pino-pretty log 自动带 req.id, onSend hook 回写 header 给客户端
    genReqId: (req) => {
      const fromHeader = req.headers['x-request-id']
      if (typeof fromHeader === 'string' && fromHeader.length > 0 && fromHeader.length <= 128) {
        return fromHeader
      }
      return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    },
    bodyLimit: 1024 * 1024,
  })

  // 启动时建表 (Phase 2 简化为内联, Phase 3 用 migration)
  initSchema()
  // 让 routes 能直接用 app.sqlite
  app.decorate('sqlite', sqlite)

  // Phase 7.5: 保留 raw body 给 Stripe webhook 验签 (parsed JSON 仍正常走 route handler)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      ;(req as unknown as { rawBody: string }).rawBody = body as string
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  await app.register(sensible)
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || /^http:\/\/(127\.0\.0\.1|localhost):(3000|5173)$/.test(origin)) {
        cb(null, true)
      } else {
        cb(new Error('CORS_DENIED'), false)
      }
    },
    credentials: true,
    maxAge: 86400,
  })
  await app.register(helmet, { contentSecurityPolicy: false })
  // Phase 7: per-tier rate limit
  //   已登录: 按 user_id 限流, max 按 billing_tier (free=60, pro=300, enterprise=1000)
  //   未登录: 按 IP 限流, 60 req/min
  // 注: rate-limit 插件跑在 onRequest hook, 比 authenticate (preHandler) 早,
  //     所以 req.user 不可用 — 我们直接 decode JWT 拿 sub (decode 不验签, 安全)
  const TIER_LIMITS_RPM = { free: 60, pro: 300, enterprise: 1000 } as const
  function extractUserIdFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader?.startsWith('Bearer ')) return null
    const token = authHeader.slice(7)
    try {
      // decode 不验签, 安全因为下游 authenticate 真会验
      const payload = jwt.decode(token)
      if (payload && typeof payload === 'object' && typeof payload.sub === 'string') {
        return payload.sub
      }
    } catch {
      // decode 失败 (非 JWT 格式) — 当作未登录
    }
    return null
  }
  await app.register(rateLimit, {
    global: true,
    max: (req) => {
      const userId = req.user?.id ?? extractUserIdFromHeader(req.headers.authorization)
      if (!userId) return config.RATE_LIMIT_PER_MINUTE
      const row = sqlite
        .prepare(
          `SELECT COALESCE(bt.tier, 'free') AS tier FROM users u
           LEFT JOIN billing_tier bt ON bt.user_id = u.id
           WHERE u.id = ?`,
        )
        .get(userId) as { tier: keyof typeof TIER_LIMITS_RPM } | undefined
      return TIER_LIMITS_RPM[row?.tier ?? 'free']
    },
    keyGenerator: (req) =>
      req.user?.id ?? extractUserIdFromHeader(req.headers.authorization) ?? req.ip,
    timeWindow: '1 minute',
    // Phase 8: rate limit 命中 → metric +1 (按 tier 分)
    onExceeded: (req) => {
      const userId = req.user?.id ?? extractUserIdFromHeader(req.headers.authorization)
      let tier = 'unauth'
      if (userId) {
        const row = sqlite
          .prepare(
            `SELECT COALESCE(bt.tier, 'free') AS tier FROM users u
             LEFT JOIN billing_tier bt ON bt.user_id = u.id
             WHERE u.id = ?`,
          )
          .get(userId) as { tier: keyof typeof TIER_LIMITS_RPM } | undefined
        tier = row?.tier ?? 'free'
      }
      metrics.rateLimitHit.inc({ tier })
    },
  })

  // Phase 8: 全局 onResponse 收所有 HTTP 耗时 (histogram, 覆盖所有路由)
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? req.url ?? 'unknown'
    metrics.httpRequestDuration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime,
    )
  })

  // Phase D.8 (2026-06-16) X-Request-Id 回写 header (客户端 / 浏览器 devtools 可看)
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.id) {
      reply.header('X-Request-Id', req.id)
    }
    return payload
  })
  // websocket plugin 已在 sessionWSS 里注册, 这里不重复

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'DaShengOS Private AI Workbench API',
        version: '0.3.0-p2',
        description: '47 端点 · v0.3 spec §10',
      },
      servers: [{ url: `http://${config.BACKEND_HOST}:${config.BACKEND_PORT}/api/v1` }],
    },
  })
  await app.register(swaggerUI, { routePrefix: '/docs' })

  await setupGateway(app, {
    jwtSecret: config.DASHENG_JWT_SECRET,
    accessTokenTtlSec: config.DASHENG_JWT_ACCESS_TTL_SEC,
    refreshTokenTtlSec: config.DASHENG_JWT_REFRESH_TTL_SEC,
    rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
  })

  await app.register(sessionWSS)

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(sessionRoutes, { prefix: '/api/v1/sessions' })
  await app.register(agentRoutes, { prefix: '/api/v1/agents' })
  await app.register(skillRoutes, { prefix: '/api/v1/skills' })
  await app.register(mcpRoutes, { prefix: '/api/v1/mcp' })
  await app.register(toolRoutes, { prefix: '/api/v1/tools' })
  await app.register(modelRoutes, { prefix: '/api/v1/models' })
  await app.register(fileRoutes, { prefix: '/api/v1/files' })
  await app.register(auditRoutes, { prefix: '/api/v1/audit' })
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' })
  await app.register(systemRoutes, { prefix: '/api/v1/system' })
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspace' })
  await app.register(secretRoutes, { prefix: '/api/v1/secrets' })
  // Track B · 3 社媒 Agent 路由 (2026-06-15)
  await app.register(socialRoutes, { prefix: '/api/v1/social' })
  // Phase 5 scaffold: /api/v1/auth/sso, /api/v1/marketplace, /api/v1/billing
  await app.register(phase5Routes, { prefix: '/api/v1' })
  // Phase 7.5: Stripe webhook (公开, 不走 rate limit, 内置 rateLimit: false)
  await app.register(stripeRoutes, { prefix: '/api/v1' })
  // Phase 8: Prometheus /metrics (公开, 不走 rate limit)
  await app.register(metricsRoutes, { prefix: '/api/v1' })

  return app
}

async function main() {
  // Phase B.1 (2026-06-16) 启动校验: prod 绝不能跑 mock Stripe, 没 secret 也不让起
  if (config.DASHENG_STRIPE_MOCK_MODE) {
    if (config.NODE_ENV === 'production') {
      console.error(
        '🚨 FATAL: DASHENG_STRIPE_MOCK_MODE=true 但 NODE_ENV=production, ' +
          '任何人可伪造 webhook 事件改自己 tier. 启动中止.',
      )
      process.exit(1)
    }
    console.warn(
      '⚠️  Stripe webhook MOCK_MODE=true — 跳过签名验证. 仅 dev 测用, 上 prod 必关.',
    )
  } else if (!config.DASHENG_STRIPE_WEBHOOK_SECRET) {
    // Phase 10 (2026-06-17) 改: 不再 fatal, 降为 warning
    //   原先 process.exit(1) 不允许 MVP 跳过 Stripe, 跟 '先 ship 后接 payment' 实践冲突
    //   真没 secret 时 webhook 永远 400 SIGNATURE_INVALID, 不影响其他端点
    console.warn(
      '⚠️  Stripe webhook MOCK_MODE=false 但 WEBHOOK_SECRET 未配, webhook 永远 400. ' +
        'MVP 阶段可忽略, 真收钱时去 Stripe dashboard 拿 whsec_... 填 .env',
    )
  }

  // Phase D.7 (2026-06-16) 启动校验: prod 必用强 JWT secret, 默认 dev-only 值拒起
  if (config.DASHENG_JWT_SECRET.startsWith('dev-only-')) {
    if (config.NODE_ENV === 'production') {
      console.error(
        '🚨 FATAL: DASHENG_JWT_SECRET 是 dev 默认值, prod 必填 ≥ 32 字符真随机. 启动中止.',
      )
      process.exit(1)
    }
    console.warn(
      '⚠️  DASHENG_JWT_SECRET 是 dev 默认值, 仅 dev 测用, 上 prod 必换.',
    )
  }

  const app = await buildServer()
  try {
    await app.listen({ host: config.BACKEND_HOST, port: config.BACKEND_PORT })
    app.log.info(
      { host: config.BACKEND_HOST, port: config.BACKEND_PORT, env: config.NODE_ENV },
      'DaShengOS backend listening',
    )
    app.log.info(`OpenAPI: http://${config.BACKEND_HOST}:${config.BACKEND_PORT}/docs`)
  } catch (err) {
    app.log.error(err, 'failed to start')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
