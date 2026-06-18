// packages/backend/src/providers/plugins/agnes_ai/provider.ts · D3.5 (2026-06-18)
// Agnes AI — OpenAI 兼容 API
// 注册: https://platform.agnes-ai.com/

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const model = req.model || 'agnes-2.0-flash'

  const body: Record<string, any> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 8192,
    temperature: req.temperature ?? 0.7,
    stream: false,
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  const resp = await fetch(`${process.env.AGNES_AI_BASE_URL || 'https://apihub.agnes-ai.com/v1'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`AgnesAI HTTP ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as {
    choices: Array<{
      message: { content: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
      finish_reason: string
    }>
    model: string
    usage: any
  }
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content || '',
    model: data.model,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: choice?.finish_reason || 'stop',
    tool_calls: choice?.message?.tool_calls || undefined,
  }
}

async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const model = req.model || 'agnes-2.0-flash'

  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 8192,
    temperature: req.temperature ?? 0.7,
    stream: true,
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  yield* openAIStream(
    `${process.env.AGNES_AI_BASE_URL || 'https://apihub.agnes-ai.com/v1'}/chat/completions`,
    apiKey,
    body,
    signal,
  )
}

async function listModelsImpl(apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch(`${process.env.AGNES_AI_BASE_URL || 'https://apihub.agnes-ai.com/v1'}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as { data: Array<{ id: string }> }
    return data.data.map(m => m.id)
  } catch { return [] }
}

async function testImpl(apiKey: string): Promise<{ ok: boolean; latency_ms: number; model_count?: number; error?: string }> {
  const t0 = Date.now()
  try {
    const models = await listModelsImpl(apiKey)
    return { ok: models.length > 0, latency_ms: Date.now() - t0, model_count: models.length }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

const profile: ProviderProfile = {
  name: 'agnes_ai',
  displayName: 'Agnes AI (凝思智能)',
  description: 'OpenAI 兼容 API · 支持 agnes-2.0-flash 文本 + 图像 + 视频',
  signupUrl: 'https://platform.agnes-ai.com/',
  authType: 'api_key',
  envVars: ['AGNES_AI_API_KEY'],
  baseUrl: 'https://apihub.agnes-ai.com/v1',
  defaultModel: 'agnes-2.0-flash',
  fallbackModels: [
    'agnes-2.0-flash',
    'agnes-1.5-flash',
  ],
  contextWindow: 262_144,
  supportsTools: true,
  supportsVision: false,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
