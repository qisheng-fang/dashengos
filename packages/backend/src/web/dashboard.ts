// packages/backend/src/web/dashboard.ts · D6 (2026-06-18)
// 单一端点 GET /api/v1/dashboard - 前端一次拉 status + doctor summary + provider list + oauth status
//   4 块元数据一起给, 前端 OAuthManager + SidebarStatusStrip 都用这个
//
// 30s 进程内缓存: 4 块都是元数据, 老板轮询看变化没意义
//
// 鉴权: 走 preHandler: [app.authenticate] (D6-2 加的), 拿 req.user 拼 user_id

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { listProviders, loadProviders } from '../providers/index.js'
import { listAllCredentials } from '../oauth/base.js'
import type { OAuthPlatform } from '../oauth/base.js'

// 平台名白名单
const PLATFORMS: OAuthPlatform[] = ['wechat_mp', 'feishu', 'wechat_video', 'shopify']

interface CachedDashboard {
  ts: number
  data: Record<string, unknown>
}

let cache: CachedDashboard | null = null
const CACHE_TTL_MS = 30_000

async function buildStatusBlock(): Promise<Record<string, unknown>> {
  // 简化版 status - 不查 python_deps (那个 5s 慢), 留给 /api/status
  const { existsSync } = await import('node:fs')
  const { execSync } = await import('node:child_process')

  function checkPort(port: number): { running: boolean; pid?: number } {
    try {
      const out = execSync(`lsof -ti:${port}`, { stdio: 'pipe', timeout: 3000 }).toString().trim()
      if (!out) return { running: false }
      const pid = parseInt(out.split('\n')[0] || '0', 10)
      return { running: true, pid }
    } catch {
      return { running: false }
    }
  }

  const fastify = checkPort(8000)
  const vite = checkPort(3000)
  const socketPath = '/tmp/dasheng/deerflow.sock'
  const deerflowRunning = existsSync(socketPath)

  return {
    version: '0.3.0',
    uptime_sec: Math.floor(process.uptime()),
    backend: { running: fastify.running, port: 8000, pid: fastify.pid },
    services: {
      fastify: { running: fastify.running, port: 8000 },
      vite: { running: vite.running, port: 3000 },
      deerflow: { running: deerflowRunning, socket: socketPath },
    },
    storage: {
      docs_dir: existsSync('/tmp/dasheng-docs'),
      socket_dir: existsSync('/tmp/dasheng'),
    },
  }
}

async function buildProviderBlock(): Promise<Record<string, unknown>> {
  const all = listProviders()
  const active = process.env.LLM_PROVIDER || 'siliconflow'
  return {
    active,
    configured: all.filter((p) => p.configured).length,
    total: all.length,
    providers: all.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      authType: p.authType,
      configured: p.configured,
      defaultModel: (p as any).defaultModel,
      modelCount: (p as any).fallbackModels?.length ?? 0,
    })),
  }
}

async function buildOAuthBlock(userId: string): Promise<Record<string, unknown>> {
  const all = listAllCredentials().filter((c) => c.user_id === userId)
  const connections = PLATFORMS.map((p) => {
    const cred = all.find((c) => c.platform === p)
    if (!cred) {
      return { platform: p, connected: false }
    }
    return {
      platform: p,
      connected: true,
      openid: cred.openid ? cred.openid.slice(0, 12) + (cred.openid.length > 12 ? '...' : '') : undefined,
      expires_at: cred.expires_at || undefined,
      updated_at: cred.updated_at,
      expiring_soon: cred.expires_at ? cred.expires_at - Date.now() < 24 * 60 * 60 * 1000 : false,
    }
  })
  return {
    user_id: userId,
    connections,
    connected_count: connections.filter((c) => c.connected).length,
    total: PLATFORMS.length,
  }
}

async function buildDoctorSummary(): Promise<Record<string, unknown>> {
  // 简化版 doctor - 4 个核心 check, 不跑 python/port/socket 详细检测
  // 详细版走 /api/doctor (D2 完整实现)
  const { existsSync } = await import('node:fs')
  const hasPython = existsSync('/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3')
  const hasDb = existsSync('/Users/apple/Desktop/ai-workbench-v2/packages/backend/data/dasheng.db')
    || existsSync('/Users/apple/Desktop/ai-workbench-v2/data/dasheng.db')
  const llmConfigured = !!process.env.SILICONFLOW_API_KEY
  return {
    python_ok: hasPython,
    db_ok: hasDb,
    llm_configured: llmConfigured,
    health: hasPython && hasDb && llmConfigured ? 'healthy' : 'degraded',
    full_check_url: '/api/doctor',
  }
}

export async function dashboardRoutes(app: FastifyInstance) {
  // 注册时确保 providers 加载
  await loadProviders()

  app.get(
    '/api/v1/dashboard',
    { preHandler: [app.authenticate] },
    async (req: FastifyRequest) => {
      const userId = req.user?.id ?? 'admin'

      // 缓存命中
      if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
        return { ...cache.data, _cache_hit: true, _cache_age_sec: Math.floor((Date.now() - cache.ts) / 1000) }
      }

      // 缓存失效 - 重算
      const [status, providers, oauth, doctor] = await Promise.all([
        buildStatusBlock(),
        buildProviderBlock(),
        buildOAuthBlock(userId),
        buildDoctorSummary(),
      ])

      const data = {
        ts: Date.now(),
        user: { id: userId, role: req.user?.role ?? 'USER' },
        status,
        providers,
        oauth,
        doctor,
      }
      cache = { ts: data.ts, data }
      return { ...data, _cache_hit: false }
    },
  )

  // 强制刷新缓存 (D6 给前端用, 老板点"重试"按钮调)
  app.post(
    '/api/v1/dashboard/refresh',
    { preHandler: [app.authenticate] },
    async () => {
      cache = null
      return { ok: true, message: 'dashboard 缓存已清, 下次 GET 会重算' }
    },
  )
}
