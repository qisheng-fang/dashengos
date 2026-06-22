// packages/backend/src/providers/plugins/qwen-local/provider.ts
// Qwen3.6-35B-A3B 越狱版 · 本地 llama.cpp server (OpenAI 兼容)
// 部署端口: http://127.0.0.1:8080

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

const DEFAULT_URL = 'http://127.0.0.1:8080'

function getBaseUrl(): string {
  return process.env.QWEN_LOCAL_HOST || DEFAULT_URL
}

async function chatImpl(req: ChatRequest, _apiKey: string): Promise<ChatResponse> {
  const model = req.model || 'qwen3.6-35b-a3b'
  const url = `${getBaseUrl()}/v1/chat/completions`

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

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000), // 本地模型可能较慢
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Qwen Local HTTP ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as {
    choices: Array<{ message: { content: string; tool_calls?: any }; finish_reason: string }>
    model: string; usage: any
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

/** 流式输出 — 复用 OpenAI 兼容流 */
async function* chatStreamImpl(
  req: ChatRequest, _apiKey: string, signal?: AbortSignal
): AsyncGenerator<StreamChunk> {
  const model = req.model || 'qwen3.6-35b-a3b'
  const url = `${getBaseUrl()}/v1/chat/completions`

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

  yield* openAIStream(url, '', body, signal)
}

async function listModelsImpl(_apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch(`${getBaseUrl()}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
    })
    if (!resp.ok) return ['qwen3.6-35b-a3b']
    const data = await resp.json() as { data?: Array<{ id: string }> }
    return data.data?.map(m => m.id) || ['qwen3.6-35b-a3b']
  } catch {
    return ['qwen3.6-35b-a3b']
  }
}

async function testImpl(_apiKey: string): Promise<{
  ok: boolean; latency_ms: number; model_count?: number; error?: string
}> {
  const t0 = Date.now()
  try {
    const resp = await fetch(`${getBaseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.6-35b-a3b',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      const t = await resp.text().catch(() => '')
      return { ok: false, latency_ms: Date.now() - t0, error: `HTTP ${resp.status}: ${t.slice(0, 100)}` }
    }
    return { ok: true, latency_ms: Date.now() - t0 }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

const profile: ProviderProfile = {
  name: 'qwen-local',
  displayName: 'Qwen3.6 越狱版 (本地)',
  description: 'llama.cpp · IQ2_M 量化 · 推理增强 · ~3-4 tok/s · 隐私优先',
  signupUrl: '',
  authType: 'none',
  envVars: ['QWEN_LOCAL_HOST'],
  baseUrl: DEFAULT_URL,
  defaultModel: 'qwen3.6-35b-a3b',
  fallbackModels: ['qwen3.6-35b-a3b'],
  contextWindow: 32_768,
  supportsTools: false,  // IQ2_M 量化模型不支持原生 function calling
  supportsVision: true,  // Qwen3.6 有 mmproj 视觉投影
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
