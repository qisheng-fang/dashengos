// Fix: Node.js TLS cert verification for external HTTPS calls
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
// packages/backend/src/server.ts · v0.3 spec §10-§19 (Fastify 5 + Drizzle + Redis)
// Phase 2 入口: 127.0.0.1:8000 + 47 端点 + 8 核心模块
// Track D.1 (2026-06-15) · 装 dotenv 让 backend 读 packages/backend/.env (含 SILICONFLOW_API_KEY 等)
//   ⚠️ 之前 v0.3 backend 不读 .env, 这是历史遗留 bug. 现在第一行 import 'dotenv/config'
import 'dotenv/config'

// ═══ DaShengOS Integrity Guard v8.8 ═══
// 运行时系统提示词哈希校验 — 防止未经授权的修改
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __INTEGRITY_DIR = dirname(fileURLToPath(import.meta.url))
// Canon checksums are self-contained in system-prompt-canon.ts

async function verifySystemPromptIntegrity(): Promise<boolean> {
  try {
    const { verifyPromptIntegrity, getPromptChecksum } = await import('./core/harness/system-prompt-canon.js')
    const check = verifyPromptIntegrity()
    if (check.ok) {
      console.log('[IntegrityGuard] System prompt integrity verified \u2705  checksum: ' + check.currentHash.slice(0,16))
      return true
    }
    console.error('[IntegrityGuard] \u26d4 CANONICAL PROMPT TAMPERED! System will NOT serve requests.')
    return false
  } catch (e: any) {
    console.error('[IntegrityGuard] Canon module load failed — prompt may be corrupted:', e.message)
    return false
  }
}

// Verify at startup
// Integrity check moved to main()

// Periodic re-verification (every 5 minutes)
// Periodic check started in main()

import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
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
import { mcpServerHostRoutes } from './core/mcp-server-host.js'
import { memoryLedgerRoutes } from './api/memory-ledger.js'
import { memorySystemRoutes } from './api/memory-system.js'
import { toolTracerRoutes } from './api/tool-tracer.js'
import { ragRoutes } from './api/rag.js'
import { otelRoutes } from './api/otel.js'
import { multimodalRoutes } from './api/multimodal.js'
import { openDesignRoutes } from './api/open-design.js'
import { getPrometheusMetrics, startCollectorExport } from './core/otel-exporter.js'
import { recordMetric } from './core/otel-exporter.js'
import {
  toolRoutes,
  modelRoutes,
  fileRoutes,
  auditRoutes,
  settingsRoutes,
  workspaceRoutes,
  secretRoutes,
} from './api/misc.js'
import { systemRoutes } from './api/system.js'
import { healthRoutes } from './api/health.js'
import { cloudRunnerRoutes } from './api/cloud-runner.js'
import { dashboardRoutes } from './api/dashboard.js'
import { phase5Routes } from './api/phase5.js'
import { stripeRoutes } from './api/stripe.js'
import { metricsRoutes } from './api/metrics.js'
import { socialRoutes } from './api/social.js'  // Track B · 3 社媒 agent 路由 (2026-06-15)
import { windowRoutes } from './api/window.js'  // Hermes 对齐: 原生窗口管理
import { openclawRoutes } from './api/openclaw.js'  // Hermes 对齐: 跨平台协议层
import { browserRoutes } from './api/browser.js'  // Phase A.3 · Playwright 浏览器自动化 (2026-06-17)
import { statusRoutes } from './api/status.js'
import { configRoutes } from './api/config.js'  // D1 · 仿 Hermes SidebarStatusStrip (2026-06-17)
import { doctorRoutes } from './api/doctor.js'  // D2 · 仿 Hermes doctor (2026-06-17)
import { providersRoutes } from './api/providers.js'  // D3 · 仿 Hermes providers 插件化 (2026-06-17)
import { oauthRoutes } from './api/oauth.js'  // D4 · 4 平台 OAuth (微信公众号/飞书/视频号/Shopify, 2026-06-18)
import { selfHealRoutes } from './api/self-heal.js'  // P3 · 自我诊断/修复 (2026-06-18)
import { previewRoutes } from './api/preview.js'
import { daemonRoutes } from './api/daemon.js'
import { agentTarsRoutes } from './api/agent-tars.js'
import { transformersRoutes } from './api/transformers.js'
import { astrbotRoutes } from './api/astrbot.js'
import { langgraphRoutes } from './api/langgraph.js'
import { socialWorker } from './agents/social/worker-client.js'  // Track B.1 · Cookie 解析器
import { initSchema, sqlite } from './storage/db.js'
import { seedBrandSettings } from './core/harness/memory.js'
import { seedStatusMessages } from './providers/streaming.js'
import { getEvolutionReport, getToolRankings } from './core/orchestrator/self-evolver.js'
import { sessionWSS } from './ws/session-ws.js'
import { terminalRoutes } from './api/terminal.js'
import { metrics } from './core/metrics.js'
import { disconnect as redisDisconnect } from './cache/redis.js'

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    forceCloseConnections: true,
    connectionTimeout: 0,
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
  seedBrandSettings() // 首次启动时将品牌知识写入数据库
  seedStatusMessages() // 首次启动时将流式状态文案写入数据库
  // 让 routes 能直接用 app.sqlite
  app.decorate('sqlite', sqlite)

  // Phase 7.5: 保留 raw body 给 Stripe webhook 验签 (parsed JSON 仍正常走 route handler)
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      const raw = typeof body === 'string' ? body : ''
      ;(req as unknown as { rawBody: string }).rawBody = raw
      // 修复：空 body 返回 {} 而不是抛异常（uninstall 等端点不需要 body）
      const trimmed = raw.trim()
      if (!trimmed) {
        done(null, {})
        return
      }
      try {
        done(null, JSON.parse(trimmed))
      } catch (err) {
        done(err as Error, undefined)
      }
    },
  )

  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } })
  await app.register(sensible)
  // Track B.1 (2026-06-17): CORS origins 可从 env 配置
  //   开发环境默认 localhost:3000/5173, 生产环境从 CORS_ORIGINS 读
  const corsOrigins = config.CORS_ORIGINS
    ? config.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : []
  const hasCustomOrigins = corsOrigins.length > 0

  await app.register(cors, {
    origin: (origin, cb) => {
      // 服务器端请求 (无 origin) — 允许
      if (!origin) {
        cb(null, true)
        return
      }
      // 自定义生产域名
      if (hasCustomOrigins) {
        if (corsOrigins.includes(origin)) {
          cb(null, true)
        } else {
          cb(new Error('CORS_DENIED'), false)
        }
        return
      }
      // 开发环境默认白名单
      if (/^https?:\/\/(127\.0\.0\.1|localhost):(3000|5173|4173)$/.test(origin)) {
        cb(null, true)
      } else {
        cb(new Error('CORS_DENIED'), false)
      }
    },
    credentials: true,
    maxAge: 86400,
  })
  // Helmet: CSP 按需开启
  await app.register(helmet, { contentSecurityPolicy: config.CSP_ENABLED ? {} as any : false })

  // Track B.1 (2026-06-17): CSRF 保护 (仅生产环境, 对 state-changing methods 启用)
  if (config.CSRF_ENABLED) {
    // @fastify/csrf-protection uses cookie-based double-submit pattern
    try {
      const { default: csrfProtection } = await import('@fastify/csrf-protection')
      await app.register(csrfProtection, {
        cookieOpts: {
          signed: true,
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
        },
      })
      app.log.info('[security] CSRF protection enabled')
    } catch {
      app.log.warn('[security] @fastify/csrf-protection not installed, CSRF skipped')
    }
  }
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

  // Phase 2 (2026-06-17): 全局 onError — 统一捕获未处理异常，脱敏敏感字段
  app.setErrorHandler(async (error, req, reply) => {
    // 脱敏：从错误信息中移除 Authorization header 和可能的 API key
    const safeReq = {
      method: req.method,
      url: req.url,
      id: req.id,
    }

    const err = error as Error & { statusCode?: number; code?: string }

    // 如果已经是 Fastify 错误（ValidationError 等），直接用
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      req.log.warn({ err: err.message, req: safeReq }, 'client error')
      return reply.status(err.statusCode).send({
        code: err.code ?? 'CLIENT_ERROR',
        message: err.message,
        request_id: req.id,
      })
    }

    // 500 — 内部错误，不泄露细节
    req.log.error({ err: err.message, stack: err.stack?.slice(0, 500), req: safeReq }, 'internal error')
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: req.id,
    })
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
  await app.register(terminalRoutes)

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(sessionRoutes, { prefix: '/api/v1/sessions' })
  await app.register(agentRoutes, { prefix: '/api/v1/agents' })
  await app.register(skillRoutes, { prefix: '/api/v1/skills' })
  await app.register(mcpRoutes, { prefix: '/api/v1/mcp' })
  await app.register(mcpServerHostRoutes)  // MCP Server Host (JSON-RPC on /mcp/*)
  await app.register(memorySystemRoutes, { prefix: '/api/v1/memory' })
  await app.register(memoryLedgerRoutes, { prefix: '/api/v1/memory-ledger' })
  const { memoryHeartbeatRoutes } = await import('./api/memory-heartbeat.js')
  await app.register(memoryHeartbeatRoutes, { prefix: '/api/v1/memory' })
  await app.register(toolTracerRoutes, { prefix: '/api/v1/tools' })
  await app.register(ragRoutes, { prefix: '/api/v1/rag' })
  await app.register(otelRoutes, { prefix: '/api/v1/otel' })
  await app.register(multimodalRoutes, { prefix: '/api/v1/multimodal' })
  await app.register(openDesignRoutes, { prefix: '/api/v1/open-design' })
  
  // Prometheus metrics endpoint (no auth)
  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', 'text/plain; version=0.0.4')
    return getPrometheusMetrics()
  })
  
  // Start OTEL collector export
  startCollectorExport()
  await app.register(toolRoutes, { prefix: '/api/v1/tools' })
  await app.register(modelRoutes, { prefix: '/api/v1/models' })
  await app.register(healthRoutes, { prefix: '/api/v1' })
  await app.register(fileRoutes, { prefix: '/api/v1/files' })
  await app.register(auditRoutes, { prefix: '/api/v1/audit' })
  await app.register(settingsRoutes, { prefix: '/api/v1/settings' })
  await app.register(systemRoutes, { prefix: '/api/v1/system' })

    // Backup API (manual trigger + list)
    app.get('/api/v1/backup/list', { preHandler: [app.authenticate] }, async (_req, reply) => {
      const { listBackups } = await import('./core/auto-backup.js')
      return reply.send({ backups: listBackups() })
    })
    app.post('/api/v1/backup/create', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
      const { manualBackup } = await import('./core/auto-backup.js')
      const result = manualBackup()
      return reply.send(result)
    })
    await app.register(cloudRunnerRoutes, { prefix: '/api/v1/cloud' });
    await app.register(dashboardRoutes, { prefix: '/api/v1/dashboard' });
  await app.register(workspaceRoutes, { prefix: '/api/v1/workspace' })
  await app.register(secretRoutes, { prefix: '/api/v1/secrets' })

  // Public health endpoint (no auth required) — 负载均衡 / K8s probe 用
  app.get('/health', async (_req, reply) => {
    let dbOk = false
    try {
      sqlite.prepare('SELECT 1').get()
      dbOk = true
    } catch { /* noop */ }
    return reply.send({
      status: dbOk ? 'ok' : 'degraded',
      version: '0.3.0-p2',
      uptime_sec: Math.floor(process.uptime()),
      checks: {
        database: dbOk ? 'ok' : 'fail',
      },
    })
  })

  // Track B · 3 社媒 Agent 路由 (2026-06-15)
  // Track B.1 (2026-06-17): 注入 Cookie 解析器 → social worker 自动带用户 cookie
  socialWorker.setCookieResolver(async (platform: string, userId?: string) => {
    if (!userId) return null
    try {
      const { decrypt, getCookieEncryptionKey } = await import('./core/crypto.js')
      const row = sqlite
        .prepare(
          'SELECT encrypted_value FROM social_cookies WHERE user_id = ? AND platform = ? ORDER BY updated_at DESC LIMIT 1',
        )
        .get(userId, platform) as { encrypted_value: string } | undefined
      if (!row) return null
      return decrypt(row.encrypted_value, getCookieEncryptionKey())
    } catch {
      return null
    }
  })
  await app.register(socialRoutes, { prefix: '/api/v1/social' })
  await app.register(windowRoutes, { prefix: '/api/v1' })  // Hermes: 窗口管理
  await app.register(openclawRoutes, { prefix: '/api/v1' })  // Hermes: OpenCLaw 协议
  // Phase 5 scaffold: /api/v1/auth/sso, /api/v1/marketplace, /api/v1/billing
  await app.register(phase5Routes, { prefix: '/api/v1' })
  // Phase 7.5: Stripe webhook (公开, 不走 rate limit, 内置 rateLimit: false)
  await app.register(stripeRoutes, { prefix: '/api/v1' })
  // Phase 8: Prometheus /metrics (公开, 不走 rate limit)
  await app.register(metricsRoutes, { prefix: '/api/v1' })
  // Track C.1 (2026-06-17): 定时任务自动化引擎
  const { automationRoutes } = await import('./api/automations.js')
  await app.register(automationRoutes, { prefix: '/api/v1/automations' })


  // D4 (2026-06-18): 4 平台 OAuth 路由
  await app.register(oauthRoutes)

  // Phase A.3 (2026-06-17): Playwright 浏览器自动化
  await app.register(browserRoutes, { prefix: '/api/v1/browser' })

  // Phase A.4 (2026-06-17): 文档生成 (PPTX/DOCX/PDF/XLSX)
  const { documentRoutes } = await import('./api/documents.js')
  await app.register(documentRoutes, { prefix: '/api/v1/documents' })

  // Phase A.5 (2026-06-17): 可视化 (Chart.js 配置验证 + 调色板)
  const { visualizationRoutes } = await import('./api/visualizations.js')
  await app.register(visualizationRoutes, { prefix: '/api/v1/visualizations' })

  // Phase B.2 (2026-06-17): 多 Agent 编排引擎
  const { orchestratorRoutes } = await import('./api/orchestrator.js')
  await app.register(orchestratorRoutes, { prefix: '/api/v1/orchestrator' })

  // Phase C.1 (2026-06-17): 自我改进学习系统
  const { learningRoutes } = await import('./api/learnings.js')
  await app.register(learningRoutes, { prefix: '/api/v1/learnings' })

  // Track C.2 (2026-06-17): Smart Dispatcher Chat REST bridge
  const { chatRoutes } = await import('./api/chat.js')
  await app.register(chatRoutes, { prefix: '/api/v1/chat' })

  // D1 + D2 (2026-06-17): 仿 Hermes 状态条 + Doctor 自检
  //    - /api/status       14 字段,前端 10s 拉一次显示色块
  //    - /api/doctor       8 章节结构化检查 + 一键修复
  //    - /api/system/...   重启 gateway / backend
  await app.register(statusRoutes)
  await app.register(configRoutes)
  await app.register(doctorRoutes)
  await app.register(providersRoutes)

  // P3 (2026-06-18): 自我诊断/修复 API
  await app.register(selfHealRoutes, { prefix: '/api/v1' })
  await app.register(previewRoutes, { prefix: '/api/v1' })  // 2026-06-20: 预览面板代理
  // 初始化确认门
  const { initConfirmationGate } = await import('./core/self-heal/gate.js')
  initConfirmationGate({ elevatedMode: false })

  // D6 (2026-06-18): Web Server 集中 - 仿 Hermes 集中 web_server
  //    - /api/v1/dashboard       聚合 status + providers + oauth + doctor 4 块元数据
  //    - /api/v1/dashboard/refresh 强制清缓存
  // 注: dashboard 走自己的 preHandler [app.authenticate], 不依赖全局 hook
  const { webRoutes } = await import('./web/index.js')
  await app.register(webRoutes)
  await app.register(daemonRoutes, { prefix: '/api/v1' })
  await app.register(agentTarsRoutes, { prefix: '/api/v1/agent-tars' })
  await app.register(transformersRoutes, { prefix: '/api/v1/transformers' })
  await app.register(astrbotRoutes, { prefix: '/api/v1/astrbot' })
  await app.register(langgraphRoutes, { prefix: '/api/v1/langgraph' })

  // v5.2: 自主学习进化 API
  app.get('/api/v1/evolve/report', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const report = getEvolutionReport()
    const rankings = getToolRankings()
    return reply.send({ report, rankings })
  })

  app.get('/api/v1/evolve/rankings', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const rankings = getToolRankings()
    return reply.send(rankings)
  })

  return app
}

async function main() {
  // ═══ PROMPT INTEGRITY CHECK ═══
  const INTEGRITY_OK = await verifySystemPromptIntegrity()
  if (!INTEGRITY_OK) {
    console.error('[IntegrityGuard] ⛔ CANONICAL PROMPT TAMPERED — refusing to start')
    process.exit(1)
  }
  // Periodic re-verification
  setInterval(async () => { await verifySystemPromptIntegrity() }, 5 * 60 * 1000)
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

  // Phase 2 (2026-06-17): 优雅关闭 — SIGTERM/SIGINT → close DB + Redis + drain 请求
  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'shutting down gracefully...')

    // 1. 停 accept 新连接，等 in-flight 请求完成 (max 10s)
    try {
      await app.close()
      app.log.info('http server closed')
    } catch (e) {
      app.log.error({ err: (e as Error).message }, 'error closing http server')
    }

    // 2. 关闭 DB
    try {
      sqlite.close()
      app.log.info('sqlite closed')
    } catch (e) {
      app.log.error({ err: (e as Error).message }, 'error closing sqlite')
    }

    // 3. 断开 Redis
    try {
      await redisDisconnect()
      app.log.info('redis disconnected')
    } catch (e) {
      app.log.error({ err: (e as Error).message }, 'error disconnecting redis')
    }

    app.log.info('shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  try {
    // Graceful shutdown
    const shutdown = async () => {
      console.log('[server] graceful shutdown...')
      await app.close()
      process.exit(0)
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
    
    // Catch unhandled crashes and log them before exit
    process.on('uncaughtException', (err) => {
      console.error('[FATAL] uncaughtException:', err.message)
      console.error(err.stack?.slice(0, 500) || 'no stack')
      try { require('fs').appendFileSync('/tmp/dasheng-fatal.log', new Date().toISOString() + ' FATAL uncaughtException: ' + err.message + '\n' + (err.stack || '').slice(0, 2000) + '\n') } catch {}
      setTimeout(() => process.exit(1), 100)
    })
    process.on('unhandledRejection', (reason) => {
      console.error('[FATAL] unhandledRejection:', (reason as any)?.message || reason)
      console.error((reason as any)?.stack?.slice(0, 500) || 'no stack')
      try { require('fs').appendFileSync('/tmp/dasheng-fatal.log', new Date().toISOString() + ' FATAL unhandledRejection: ' + ((reason as any)?.message || String(reason)) + '\n' + ((reason as any)?.stack || '').slice(0, 2000) + '\n') } catch {}
      setTimeout(() => process.exit(1), 100)
    })

    await app.listen({ host: config.BACKEND_HOST, port: config.BACKEND_PORT, listenTextResolver: () => '' })
    app.log.info(
      { host: config.BACKEND_HOST, port: config.BACKEND_PORT, env: config.NODE_ENV },
      'DaShengOS backend listening',
    )
    app.log.info(`OpenAPI: http://${config.BACKEND_HOST}:${config.BACKEND_PORT}/docs`)

    // v6.1: 完整性守卫 — 启动时验证关键文件，缺失时自动从备份恢复
    const { runIntegrityCheck, snapshotPersistEnv } = await import('./core/integrity-guard.js')
    const guardResult = runIntegrityCheck()
    if (!guardResult.ok) {
      app.log.error({ blocked: guardResult.blocked }, '关键文件缺失，拒绝启动！请从 backups/ 手动恢复')
      process.exit(1)
    }
    if (guardResult.recovered.length > 0) {
      app.log.warn({ recovered: guardResult.recovered }, '部分文件已从备份自动恢复')
    }
    snapshotPersistEnv()

    // Track C.1: 加载定时任务 + MCP 服务器
    const { loadAutomations } = await import('./core/scheduler.js')
    loadAutomations()

    // Track C.4: 加载已注册的 MCP 服务器 + 启动心跳
    // Track C.4: 种子数据 + 路径愈合 (持久化层)
    const { seedMCPServers } = await import('./core/mcp-seed.js')
    const seedResult = seedMCPServers()

    // Track C.4b: 自动备份系统 (每6小时快照 DB+.env+prompt+MCP)
    const { startAutoBackup } = await import('./core/auto-backup.js')
    startAutoBackup()
    const { startCloudCleanup } = await import('./core/cloud-runner.js')
    startCloudCleanup()

    // Secret Broker v6.0: .env → 加密存储迁移
    const { migrateFromEnv } = await import('./core/secret-broker.js')
    migrateFromEnv()
    if (seedResult.inserted.length > 0) app.log.info(seedResult, 'MCP 种子数据已补全')
    if (seedResult.healed.length > 0) app.log.info(seedResult, 'MCP 路径已愈合')

    const { loadMCPServersOnStartup, startMCPHeartbeat } = await import('./core/mcp-client.js')
    const mcpLoaded = await loadMCPServersOnStartup()
    app.log.info({ loaded: mcpLoaded }, 'MCP 服务器已加载')
    // Heartbeat starts after MCPs are fully loaded (10s delay for initialization)
    setTimeout(() => startMCPHeartbeat(), 5000)

    // Track C.5: 记忆系统初始化 + 自检心跳
    const { initMemoryTables, seedMemoryDefaults } = await import('./core/memory-init.js')
    const memResult = initMemoryTables()
    app.log.info({ created: memResult.created.length }, '记忆表已初始化')
    if (memResult.errors.length > 0) {
      app.log.warn({ errors: memResult.errors }, '部分记忆表创建失败')
    }
    seedMemoryDefaults()

    const { startMemoryHeartbeat } = await import('./core/memory-heartbeat.js')
    startMemoryHeartbeat()

    // Track C.6: 自进化引擎初始化 (策略模式+错误修复+自动技能)
    const { initEvolutionDB } = await import('./core/self-evolve.js')
    initEvolutionDB()
    app.log.info('[Evolver] 自进化引擎 DB 已初始化')

    // Track C.5: 记忆系统自检心跳
  } catch (err) {
    app.log.error(err, 'failed to start')
    process.exit(1)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
