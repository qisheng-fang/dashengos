// packages/backend/src/providers/plugins/deepseek/provider.ts · D3.4 (2026-06-17)
// DeepSeek 深度求索 - OpenAI 兼容 API
// 注册: https://platform.deepseek.com/api_keys

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

// Map our friendly names to actual DeepSeek API model names
const MODEL_MAP: Record<string, string> = {
  'deepseek-v4-flash': 'deepseek-chat',
  'deepseek-v4-pro': 'deepseek-reasoner',
  'deepseek-chat': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
}

function resolveModel(requested: string): string {
  return MODEL_MAP[requested] || 'deepseek-chat'
}

// reasoning_content is now propagated by the agent loop directly — no global state needed

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const model = resolveModel(req.model || 'deepseek-chat')

  const body: Record<string, any> = {
    model,
    messages: req.messages,
    max_tokens: req.max_tokens ?? 4096,
    temperature: req.temperature ?? 0.3,
    stream: false,
  }

  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools
    body.tool_choice = req.tool_choice || 'auto'
  }

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
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
    throw new Error(`DeepSeek HTTP ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as {
    choices: Array<{
      message: { content: string; reasoning_content?: string; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }
      finish_reason: string
    }>
    model: string
    usage: any
  }
  const choice = data.choices?.[0]
  return {
    content: choice?.message?.content || '',
    reasoning_content: choice?.message?.reasoning_content || undefined,
    model: data.model,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: choice?.finish_reason || 'stop',
    tool_calls: choice?.message?.tool_calls || undefined,
  }
}

/** 流式输出 */
async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const model = resolveModel(req.model || 'deepseek-chat')

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

  let streamReasoning = ''
  for await (const chunk of openAIStream('https://api.deepseek.com/v1/chat/completions', apiKey, body, signal)) {
    if (chunk.type === 'thinking') streamReasoning += (chunk.meta as any)?.reasoning_text || ''
    yield chunk
  }
}

async function listModelsImpl(_apiKey: string): Promise<string[]> {
  return ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']
}

async function testImpl(apiKey: string): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const t0 = Date.now()
  try {
    const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: resolveModel('deepseek-v4-flash'),
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
  name: 'deepseek',
  displayName: 'DeepSeek (深度求索)',
  description: 'OpenAI 兼容 API · 国产最强推理模型 · deepseek-chat / deepseek-reasoner',
  signupUrl: 'https://platform.deepseek.com/api_keys',
  authType: 'api_key',
  envVars: ['DEEPSEEK_API_KEY'],
  baseUrl: 'https://api.deepseek.com/v1',
  defaultModel: 'deepseek-v4-pro',
  fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
  contextWindow: 64_000,
  supportsTools: true,
  supportsVision: false,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
