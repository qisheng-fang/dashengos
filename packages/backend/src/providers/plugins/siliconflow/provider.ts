// packages/backend/src/providers/plugins/siliconflow/provider.ts · D3.4 (2026-06-17)
// SiliconFlow 硅基流动 - OpenAI 兼容 API
// 注册: https://cloud.siliconflow.cn/account/ak

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const model = req.model || 'Qwen/Qwen2.5-72B-Instruct'

  // Build request body — support function calling (Agent Runtime)
  const body: Record<string, any> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 4096, // higher default for agent mode
    temperature: req.temperature ?? 0.3,  // lower temp for agent tasks
    stream: false,
  }

  // Pass tools if provided (OpenAI function_call format)
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
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
    throw new Error(`SiliconFlow HTTP ${resp.status}: ${t.slice(0, 200)}`)
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

/** 流式输出 — 返回 AsyncGenerator<StreamChunk> */
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const model = req.model || 'Qwen/Qwen2.5-72B-Instruct'

  const body: Record<string, unknown> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature ?? 0.3,
    stream: true,
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  yield* openAIStream('https://api.siliconflow.cn/v1/chat/completions', apiKey, body, signal)
}

async function listModelsImpl(apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch('https://api.siliconflow.cn/v1/models', {
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
  name: 'siliconflow',
  displayName: 'SiliconFlow (硅基流动)',
  description: 'OpenAI 兼容 API · 国内直连 · Qwen / DeepSeek / GLM 全模型',
  signupUrl: 'https://cloud.siliconflow.cn/account/ak',
  authType: 'api_key',
  envVars: ['SILICONFLOW_API_KEY'],
  baseUrl: 'https://api.siliconflow.cn/v1',
  defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
  fallbackModels: [
    'Qwen/Qwen2.5-72B-Instruct',
    'Qwen/Qwen2.5-32B-Instruct',
    'Qwen/Qwen2.5-7B-Instruct',
    'deepseek-ai/DeepSeek-V2.5',
    'Pro/Qwen/Qwen2-VL-7B-Instruct',
  ],
  contextWindow: 32_000,
  supportsTools: true,
  supportsVision: true,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
