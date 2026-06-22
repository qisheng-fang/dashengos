// packages/backend/src/api/providers.ts · D3.5 (2026-06-17)
// /api/providers 端点 - 列出所有 provider + 切换 + 测活

import type { FastifyInstance } from 'fastify'
import { listProviders, getProvider, getApiKey, loadProviders, markApiKeyFailed } from '../providers/index.js'
import { CredentialPool } from '../providers/credential-pool.js'
import { sqlite } from '../storage/db.js'
import { randomUUID } from 'node:crypto'

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

  // ── 模型管理 API (WorkBuddy 风格: 随时切换 + 自定义) ──

  // 列出所有可用模型 (内置 + 自定义 + 当前选中)
  app.get('/api/models', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub?: string } | undefined
    const userId = user?.sub || 'anonymous'

    // 1. 内置模型 (从已配 provider 的默认模型)
    const providers = listProviders()
    const builtIn = providers
      .filter(p => p.configured)
      .map(p => {
        const full = getProvider(p.name)
        return {
          id: `builtin_${p.name}`,
          label: `${p.displayName} · ${full?.defaultModel || 'default'}`,
          providerName: p.name,
          modelId: full?.defaultModel || '',
          baseUrl: full?.baseUrl || '',
          isCustom: false,
          isActive: false,
        }
      })

    // 2. 自定义模型 (从 custom_models 表)
    let custom: any[] = []
    try {
      custom = sqlite.prepare(
        'SELECT id, label, provider_name, model_id, base_url, api_key, is_active FROM custom_models WHERE user_id = ? ORDER BY sort_order ASC'
      ).all(userId) as any[]
      // 清理敏感数据: 只返回 api_key 的存在状态，不返回实际值
      custom = custom.map(c => ({
        ...c,
        hasApiKey: !!c.api_key,
        apiKey: undefined,
        isCustom: true,
        providerName: c.provider_name,
        modelId: c.model_id,
        baseUrl: c.base_url,
        isActive: !!c.is_active,
      }))
    } catch { /* 表可能不存在 */ }

    // 3. 当前活跃模型
    const activeCustom = custom.find(c => c.isActive)
    const activeBuiltIn = builtIn[0] // 默认第一个

    return reply.send({
      builtIn,
      custom,
      active: activeCustom || activeBuiltIn,
    })
  })

  // 设置当前活跃模型
  app.put('/api/models/active', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub?: string } | undefined
    const userId = user?.sub || 'anonymous'
    const { modelId, providerName } = req.body as { modelId: string; providerName: string }

    // 先取消所有活跃状态
    try {
      sqlite.prepare('UPDATE custom_models SET is_active = 0 WHERE user_id = ?').run(userId)
    } catch { /* ok */ }

    // 如果是自定义模型，标记为活跃
    try {
      const existing = sqlite.prepare(
        'SELECT id FROM custom_models WHERE user_id = ? AND model_id = ? AND provider_name = ?'
      ).get(userId, modelId, providerName) as { id: string } | undefined

      if (existing) {
        sqlite.prepare('UPDATE custom_models SET is_active = 1 WHERE id = ?').run(existing.id)
      } else {
        // 自动创建一条记录
        const id = randomUUID()
        const now = Date.now()
        sqlite.prepare(
          `INSERT INTO custom_models (id, user_id, label, provider_name, model_id, is_active, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`
        ).run(id, userId, modelId, providerName, modelId, now, now)
      }
    } catch { /* ok */ }

    return reply.send({ ok: true, modelId, providerName })
  })

  // 添加/更新自定义模型
  app.put('/api/models/custom', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub?: string } | undefined
    const userId = user?.sub || 'anonymous'
    const { id, label, providerName, modelId, baseUrl, apiKey } = req.body as {
      id?: string; label: string; providerName: string; modelId: string; baseUrl?: string; apiKey?: string
    }

    if (!label || !modelId) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'label 和 modelId 为必填项' })
    }

    const now = Date.now()
    const modelId2 = id || randomUUID()
    try {
      sqlite.prepare(
        `INSERT INTO custom_models (id, user_id, label, provider_name, model_id, base_url, api_key, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label=excluded.label, provider_name=excluded.provider_name, model_id=excluded.model_id, base_url=excluded.base_url, api_key=COALESCE(excluded.api_key, custom_models.api_key), updated_at=excluded.updated_at`
      ).run(modelId2, userId, label, providerName || 'custom', modelId, baseUrl || '', apiKey || '', now, now)
      return reply.send({ ok: true, id: modelId2 })
    } catch (e: any) {
      return reply.code(500).send({ code: 'MODEL_SAVE_ERROR', error: e.message })
    }
  })

  // 删除自定义模型
  app.delete('/api/models/custom/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = req.user as { sub?: string } | undefined
    const userId = user?.sub || 'anonymous'
    const { id } = req.params as { id: string }

    try {
      sqlite.prepare('DELETE FROM custom_models WHERE id = ? AND user_id = ?').run(id, userId)
      return reply.send({ ok: true })
    } catch (e: any) {
      return reply.code(500).send({ code: 'MODEL_DELETE_ERROR', error: e.message })
    }
  })
}
