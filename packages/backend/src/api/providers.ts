// packages/backend/src/api/providers.ts · D3.5 (2026-06-17)
// /api/providers 端点 - 列出所有 provider + 切换 + 测活

import type { FastifyInstance } from 'fastify'
import { listProviders, getProvider, getApiKey, loadProviders, markApiKeyFailed } from '../providers/index.js'
import { CredentialPool } from '../providers/credential-pool.js'

export async function providersRoutes(app: FastifyInstance) {
  // 启动时加载 provider
  await loadProviders()

  // 列出所有 provider — D6-2 公开 (前端 Settings 轮询)
  app.get('/api/providers', async () => {
    const list = listProviders()
    const active = process.env.LLM_PROVIDER || 'siliconflow'
    return {
      active,
      configured: list.filter(p => p.configured).length,
      total: list.length,
      providers: list,
    }
  })

  // 测活某个 provider — D6-2 鉴权
  app.post('/api/providers/:name/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const provider = getProvider(name)
    if (!provider) {
      reply.code(404)
      return { ok: false, error: `Provider not found: ${name}` }
    }
    const apiKey = getApiKey(provider) ?? ''
    if (provider.authType === 'api_key' && !apiKey) {
      return { ok: false, error: `${provider.envVars[0]} 未配置` }
    }
    try {
      const result = await provider.test(apiKey)
      return { provider: name, ...result }
    } catch (e: any) {
      markApiKeyFailed(provider, apiKey)
      return { ok: false, error: e.message?.slice(0, 200) }
    }
  })

  // 列模型 — D6-2 公开
  app.get('/api/providers/:name/models', async (req, reply) => {
    const { name } = req.params as { name: string }
    const provider = getProvider(name)
    if (!provider) {
      reply.code(404)
      return { ok: false, error: `Provider not found: ${name}` }
    }
    const apiKey = getApiKey(provider) ?? ''
    let models: string[] = []
    let source: 'live' | 'fallback' = 'fallback'
    try {
      models = await provider.listModels(apiKey)
      if (models.length > 0) source = 'live'
    } catch { /* use fallback */ }
    if (models.length === 0) models = provider.fallbackModels
    return { provider: name, source, count: models.length, models }
  })

  // 凭证池状态 — D6-2 鉴权
  app.get('/api/providers/:name/credentials', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const provider = getProvider(name)
    if (!provider) {
      reply.code(404)
      return { ok: false, error: `Provider not found: ${name}` }
    }
    if (provider.envVars.length === 0) {
      return { provider: name, pool: { total: 0, active: 0, strategy: 'n/a' } }
    }
    const envVal = process.env[provider.envVars[0]] || ''
    if (!envVal.includes(',')) {
      return { provider: name, pool: { total: 1, active: 1, strategy: 'single' }, message: '单 key,无需轮换' }
    }
    const pool = new CredentialPool(provider.envVars[0], 'round_robin')
    return { provider: name, pool: pool.status() }
  })

  // 切换 active provider — D6-2 鉴权
  app.post('/api/providers/active', { preHandler: [app.authenticate] }, async (req) => {
    const { name } = req.body as { name: string }
    if (!getProvider(name)) {
      return { ok: false, error: `Provider not found: ${name}` }
    }
    // 写到 .env (运行时立即生效,持久化下次启动)
    process.env.LLM_PROVIDER = name
    return { ok: true, active: name, message: '已切换 (运行时生效,持久化需要重启)' }
  })
}
