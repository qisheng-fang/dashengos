// packages/backend/src/providers/plugins/ollama/provider.ts · D3.4 (2026-06-17)
// Ollama 本地 - OpenAI 兼容 API
// 安装: https://ollama.com

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'

const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434'

function getOllamaUrl(): string {
  return process.env.OLLAMA_HOST || OLLAMA_DEFAULT_URL
}

async function chatImpl(req: ChatRequest, _apiKey: string): Promise<ChatResponse> {
  const model = req.model || 'qwen2.5:7b'
  const url = `${getOllamaUrl()}/v1/chat/completions`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: req.messages,
      max_tokens: req.max_tokens ?? 2048,
      temperature: req.temperature ?? 0.7,
      stream: false,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) {
    const t = await resp.text().catch(() => '')
    throw new Error(`Ollama HTTP ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as { choices: Array<{ message: { content: string }; finish_reason: string }>; model: string; usage: any }
  return {
    content: data.choices[0]?.message?.content || '',
    model: data.model,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: data.choices[0]?.finish_reason || 'stop',
  }
}

async function listModelsImpl(_apiKey: string): Promise<string[]> {
  try {
    const resp = await fetch(`${getOllamaUrl()}/api/tags`, { signal: AbortSignal.timeout(5_000) })
    if (!resp.ok) return []
    const data = await resp.json() as { models: Array<{ name: string }> }
    return data.models.map(m => m.name)
  } catch { return [] }
}

async function testImpl(_apiKey: string): Promise<{ ok: boolean; latency_ms: number; model_count?: number; error?: string }> {
  const t0 = Date.now()
  try {
    const models = await listModelsImpl('')
    return { ok: models.length > 0, latency_ms: Date.now() - t0, model_count: models.length }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

const profile: ProviderProfile = {
  name: 'ollama',
  displayName: 'Ollama (本地)',
  description: 'OpenAI 兼容 API · 本地模型 · 无需 API key · 隐私优先',
  signupUrl: 'https://ollama.com',
  authType: 'none',
  envVars: ['OLLAMA_HOST'],
  baseUrl: OLLAMA_DEFAULT_URL,
  defaultModel: 'qwen2.5:7b',
  fallbackModels: ['qwen2.5:7b', 'llama3:8b', 'mistral:7b', 'gemma2:9b'],
  contextWindow: 8_000,
  supportsTools: false,
  supportsVision: false,
  chat: chatImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
