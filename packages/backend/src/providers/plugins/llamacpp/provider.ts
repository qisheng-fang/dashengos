// packages/backend/src/providers/plugins/llamacpp/provider.ts
// llama.cpp 本地推理模型 provider (2026-06-22)
// 对接 llama.cpp server 的 OpenAI 兼容 API
// 支持 reasoning_content (推理思考) 流式输出

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import type { StreamChunk } from '../../streaming.js'

const LLAMACPP_DEFAULT_URL = 'http://127.0.0.1:8080'
const LLAMACPP_DEFAULT_MODEL = '/Users/apple/WorkBuddy/2026-06-22-08-50-40/model/Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive-IQ2_M.gguf'

function getUrl(): string {
  return process.env.LLAMACPP_HOST || LLAMACPP_DEFAULT_URL
}

function getModel(): string {
  return process.env.LLAMACPP_DEFAULT_MODEL || LLAMACPP_DEFAULT_MODEL
}

// ── 非流式聊天 ──
async function chatImpl(req: ChatRequest, _apiKey: string): Promise<ChatResponse> {
  const model = req.model || getModel()
  const body: Record<string, any> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    stream: false,
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  const resp = await fetch(`${getUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000), // 5 分钟，本地推理较慢
  })

  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`llama.cpp HTTP ${resp.status}: ${t.slice(0, 200)}`)
  }

  const data = await resp.json() as {
    choices: Array<{
      message: { content: string; reasoning_content?: string; tool_calls?: any[] }
      finish_reason: string
    }>
    model: string
    usage: any
  }

  const choice = data.choices?.[0]
  const content = choice?.message?.content || ''
  // reasoning_content 不拼入 content，仅用于推理过程

  return {
    content,
    model: data.model,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: choice?.finish_reason || 'stop',
    tool_calls: choice?.message?.tool_calls || undefined,
  }
}

// ── 流式聊天 — 自定义实现，支持 reasoning_content ──
async function* chatStreamImpl(
  req: ChatRequest,
  _apiKey: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const model = req.model || getModel()
  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    stream: true,
  }
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  const resp = await fetch(`${getUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '')
    yield { type: 'error', content: `HTTP ${resp.status}: ${errText.slice(0, 200)}` }
    return
  }

  if (!resp.body) {
    yield { type: 'error', content: 'No response body' }
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let modelId = ''
  let usageData: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {}
  let reasoningTokenCount = 0
  let contentStarted = false

  // 推理阶段状态文案轮转
  const REASONING_STATUSES = [
    '💭 思考中...',
    '🧠 正在推理分析...',
    '⚡ 梳理思路...',
    '🔍 验证逻辑...',
  ]
  let lastStatusIdx = -1

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue

        const dataStr = line.slice(5).trim()
        if (dataStr === '[DONE]') {
          yield { type: 'usage', content: '', meta: { ...usageData, model: modelId } }
          yield { type: 'done', content: '', meta: { finish_reason: 'stop', model: modelId } }
          return
        }

        try {
          const json = JSON.parse(dataStr) as Record<string, any>
          const choice = json.choices?.[0]
          if (!choice) continue

          modelId = json.model || modelId

          if (json.usage) {
            usageData = {
              prompt_tokens: json.usage.prompt_tokens || usageData.prompt_tokens,
              completion_tokens: json.usage.completion_tokens || usageData.completion_tokens,
              total_tokens: json.usage.total_tokens || usageData.total_tokens,
            }
          }

          const delta = choice.delta

          // ── 推理 token (reasoning_content) ──
          // 不输出给用户，但定期发送状态事件让用户知道在思考
          if (delta?.reasoning_content) {
            reasoningTokenCount++
            const statusIdx = Math.min(
              Math.floor(reasoningTokenCount / 50),
              REASONING_STATUSES.length - 1,
            )
            if (statusIdx > lastStatusIdx) {
              lastStatusIdx = statusIdx
              yield {
                type: 'status',
                content: REASONING_STATUSES[statusIdx],
                meta: {},
              }
            }
          }

          // ── 正式回复 token (content) ──
          if (delta?.content) {
            if (!contentStarted) {
              contentStarted = true
              yield { type: 'status', content: '✍️ 生成回复中...', meta: {} }
            }
            yield { type: 'token', content: delta.content, meta: { model: modelId } }
          }

          // ── tool_call 流式片段 ──
          if (delta?.tool_calls?.[0]) {
            const tc = delta.tool_calls[0]
            if (tc.function?.name) {
              yield {
                type: 'status',
                content: `🔧 调用工具: ${tc.function.name}`,
                meta: {},
              }
            }
            if (tc.function?.arguments) {
              const callId = tc.id || `${tc.function?.name || 'tool'}_${Date.now()}`
              yield {
                type: 'tool_call',
                content: tc.function.arguments,
                meta: {
                  tool_call_id: callId,
                  tool_name: tc.function?.name || '',
                  tool_args: tc.function?.arguments || '',
                },
              }
            }
          }

          // ── finish_reason ──
          if (choice.finish_reason) {
            yield {
              type: 'done',
              content: '',
              meta: {
                finish_reason: choice.finish_reason as string,
                model: modelId,
                ...usageData,
              },
            }
            return
          }
        } catch {
          /* 非 JSON 行，跳过 */
        }
      }
    }

    // 流自然结束
    yield { type: 'usage', content: '', meta: { ...usageData, model: modelId } }
    yield { type: 'done', content: '', meta: { finish_reason: 'stop', model: modelId } }
  } finally {
    reader.releaseLock()
  }
}

// ── 模型列表 ──
async function listModelsImpl(_apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch(`${getUrl()}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) return [getModel()]
    const data = await resp.json() as {
      data?: Array<{ id: string }>
      models?: Array<{ name: string }>
    }
    // OpenAI 格式
    if (data.data?.length) return data.data.map(m => m.id)
    // Ollama 兼容格式
    if (data.models?.length) return data.models.map(m => m.name)
    return [getModel()]
  } catch {
    return [getModel()]
  }
}

// ── 连通性测试 ──
async function testImpl(_apiKey: string): Promise<{
  ok: boolean
  latency_ms: number
  model_count?: number
  error?: string
}> {
  const t0 = Date.now()
  try {
    const models = await listModelsImpl('')
    return { ok: models.length > 0, latency_ms: Date.now() - t0, model_count: models.length }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

// ── Provider Profile ──
const profile: ProviderProfile = {
  name: 'llamacpp',
  displayName: 'llama.cpp (本地推理)',
  description: '本地 llama.cpp server · OpenAI 兼容 API · 推理模型 · 隐私优先 · 无需 API key',
  signupUrl: 'https://github.com/ggerganov/llama.cpp',
  authType: 'none',
  envVars: ['LLAMACPP_HOST'],
  baseUrl: LLAMACPP_DEFAULT_URL,
  defaultModel: LLAMACPP_DEFAULT_MODEL,
  fallbackModels: [LLAMACPP_DEFAULT_MODEL],
  contextWindow: 4096,
  supportsTools: false,
  supportsVision: false,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
