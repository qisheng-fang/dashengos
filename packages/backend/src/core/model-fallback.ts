// packages/backend/src/core/model-fallback.ts · DaShengOS v6.0
// 模型故障转移链 — 当主模型失败时自动切换备份
// 2026-06-23

import { getActiveProvider, getProvider, getApiKey } from '../providers/index.js'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface FallbackResult {
  success: boolean
  provider: string
  model: string
  content: string
  reasoningContent?: string
  toolCalls?: Array<{ id: string; name: string; args: Record<string, any> }>
  attempts: number
  errors: string[]
  totalLatencyMs: number
}

export interface FallbackConfig {
  maxAttempts: number
  providers: Array<{
    name: string
    models: string[]          // 优先尝试的模型列表
  }>
}

// ═══════════════════════════════════════════════════════════
// 默认故障转移链
// ═══════════════════════════════════════════════════════════

const DEFAULT_FALLBACK: FallbackConfig = {
  maxAttempts: 4,
  providers: [
    { name: 'deepseek', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
    { name: 'siliconflow', models: ['Qwen/Qwen2.5-72B-Instruct'] },
    { name: 'agnes_ai', models: ['agnes-2.0-flash'] },
  ],
}

// ═══════════════════════════════════════════════════════════
// 健康检查缓存
// ═══════════════════════════════════════════════════════════

const healthCache = new Map<string, { ok: boolean; checkedAt: number }>()
const HEALTH_CACHE_TTL = 60000 // 1 分钟

async function isProviderHealthy(providerName: string): Promise<boolean> {
  const cached = healthCache.get(providerName)
  if (cached && Date.now() - cached.checkedAt < HEALTH_CACHE_TTL) {
    return cached.ok
  }

  try {
    const provider = getProvider(providerName)
    if (!provider?.test) return false
    const apiKey = getApiKey(provider) || ''
    if (!apiKey) return false
    const result = await provider.test(apiKey)
    healthCache.set(providerName, { ok: result.ok, checkedAt: Date.now() })
    return result.ok
  } catch {
    healthCache.set(providerName, { ok: false, checkedAt: Date.now() })
    return false
  }
}

// ═══════════════════════════════════════════════════════════
// 核心故障转移
// ═══════════════════════════════════════════════════════════

export async function executeWithFallback(opts: {
  messages: Array<{ role: string; content: string }>
  tools?: Array<any>
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  config?: FallbackConfig
  onAttempt?: (provider: string, model: string, attempt: number) => void
}): Promise<FallbackResult> {
  const config = opts.config || DEFAULT_FALLBACK
  const errors: string[] = []
  const t0 = Date.now()

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    // 根据尝试次数选择 provider
    let providerName: string | null = null
    let modelName: string | null = null
    let providerIndex = 0

    for (const p of config.providers) {
      if (attempt < (providerIndex + 1) * p.models.length) {
        providerName = p.name
        const modelIdx = attempt - providerIndex * (config.providers[providerIndex - 1]?.models.length || 0)
        modelName = p.models[Math.min(modelIdx, p.models.length - 1)]
        break
      }
      providerIndex++
    }

    if (!providerName || !modelName) break

    // 跳过不健康的 provider
    const healthy = await isProviderHealthy(providerName)
    if (!healthy) {
      errors.push(`${providerName} 不健康，跳过`)
      continue
    }

    opts.onAttempt?.(providerName, modelName, attempt + 1)

    try {
      const provider = getProvider(providerName)
      if (!provider?.chat) {
        errors.push(`${providerName} 不支持 chat`)
        continue
      }

      const apiKey = getApiKey(provider) || ''
      if (!apiKey) {
        errors.push(`${providerName} 无 API key`)
        continue
      }

      const result = await provider.chat({
        model: modelName,
        messages: opts.messages,
        tools: opts.tools,
        max_tokens: opts.maxTokens || 4096,
        temperature: opts.temperature || 0.3,
      })

      return {
        success: true,
        provider: providerName,
        model: modelName,
        content: result.content,
        reasoningContent: result.reasoning_content,
        toolCalls: result.tool_calls,
        attempts: attempt + 1,
        errors,
        totalLatencyMs: Date.now() - t0,
      }
    } catch (err: any) {
      errors.push(`${providerName}/${modelName}: ${err.message?.slice(0, 150)}`)
      // 标记不健康
      healthCache.set(providerName, { ok: false, checkedAt: Date.now() })
    }
  }

  return {
    success: false,
    provider: '',
    model: '',
    content: '',
    attempts: config.maxAttempts,
    errors,
    totalLatencyMs: Date.now() - t0,
  }
}

/**
 * 流式故障转移 (仅支持第一个成功的 provider)
 */
export async function* executeWithFallbackStream(opts: {
  messages: Array<{ role: string; content: string }>
  tools?: Array<any>
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  config?: FallbackConfig
  onAttempt?: (provider: string, model: string, attempt: number) => void
}): AsyncGenerator<{ type: 'content' | 'thinking' | 'error' | 'done'; text?: string; provider?: string; model?: string; errors?: string[] }> {
  const config = opts.config || DEFAULT_FALLBACK
  const errors: string[] = []

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    let providerName: string | null = null
    let modelName: string | null = null
    let providerIndex = 0

    for (const p of config.providers) {
      if (attempt < (providerIndex + 1) * p.models.length) {
        providerName = p.name
        const modelIdx = attempt - providerIndex * (config.providers[providerIndex - 1]?.models.length || 0)
        modelName = p.models[Math.min(modelIdx, p.models.length - 1)]
        break
      }
      providerIndex++
    }

    if (!providerName || !modelName) break

    const healthy = await isProviderHealthy(providerName)
    if (!healthy) { errors.push(`${providerName} 不健康`); continue }

    opts.onAttempt?.(providerName, modelName, attempt + 1)

    try {
      const provider = getProvider(providerName)
      if (!provider?.chatStream) { errors.push(`${providerName} 不支持流式`); continue }

      const apiKey = getApiKey(provider) || ''
      if (!apiKey) { errors.push(`${providerName} 无 key`); continue }

      for await (const chunk of provider.chatStream(
        { model: modelName, messages: opts.messages, tools: opts.tools, max_tokens: opts.maxTokens || 4096, temperature: opts.temperature || 0.3 },
        apiKey,
        opts.signal
      )) {
        if (chunk.type === 'thinking') yield { type: 'thinking', text: (chunk.meta as any)?.reasoning_text }
        else if (chunk.type === 'content') yield { type: 'content', text: chunk.text }
      }
      yield { type: 'done', provider: providerName, model: modelName }
      return
    } catch (err: any) {
      errors.push(`${providerName}/${modelName}: ${err.message?.slice(0, 100)}`)
      healthCache.set(providerName, { ok: false, checkedAt: Date.now() })
    }
  }

  yield { type: 'error', errors, text: '所有模型提供商均失败: ' + errors.join('; ') }
}

console.log('[ModelFallback] 故障转移链已就绪: DeepSeek → SiliconFlow → Agnes AI')
