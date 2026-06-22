// packages/backend/src/providers/plugins/google/provider.ts · D3.5 (2026-06-19)
// Google Cloud Vertex AI — 通过 OpenAI 兼容端点访问 Gemini 系列模型
// 注册: https://console.cloud.google.com/vertex-ai

import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import { openAIStream, type StreamChunk } from '../../streaming.js'

// ── 配置 ──────────────────────────────────────────────

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions'
const MODELS_PATH = '/v1/models'

const MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gemini-2.0-flash-lite': 'gemini-2.0-flash-lite',
  'gemini-1.5-pro': 'gemini-1.5-pro',
  'gemini-1.5-flash': 'gemini-1.5-flash',
}

// ── 构建完整 URL ────────────────────────────────────

function chatUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${CHAT_COMPLETIONS_PATH}`
}

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}${MODELS_PATH}`
}

// ── 非流式 ──────────────────────────────────────────

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const baseUrl = process.env.GOOGLE_BASE_URL || 'https://us-central1-aiplatform.googleapis.com'
  const model = req.model || process.env.GOOGLE_DEFAULT_MODEL || 'gemini-2.0-flash'

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

  const resp = await fetch(chatUrl(baseUrl), {
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
    throw new Error(`Google AI HTTP ${resp.status}: ${t.slice(0, 200)}`)
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
    model: data.model || model,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    finish_reason: choice?.finish_reason || 'stop',
    tool_calls: choice?.message?.tool_calls || undefined,
  }
}

// ── 流式 ────────────────────────────────────────────

async function* chatStreamImpl(req: ChatRequest, apiKey: string, signal?: AbortSignal): AsyncGenerator<StreamChunk> {
  const baseUrl = process.env.GOOGLE_BASE_URL || 'https://us-central1-aiplatform.googleapis.com'
  const model = req.model || process.env.GOOGLE_DEFAULT_MODEL || 'gemini-2.0-flash'

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

  yield* openAIStream(chatUrl(baseUrl), apiKey, body, signal)
}

// ── 模型列表 ────────────────────────────────────────

async function listModelsImpl(apiKey: string): Promise<string[]> {
  try {
    const baseUrl = process.env.GOOGLE_BASE_URL || 'https://us-central1-aiplatform.googleapis.com'
    const resp = await fetch(modelsUrl(baseUrl), {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) return Object.keys(MODEL_MAP)
    const data = await resp.json() as { data: Array<{ id: string }> }
    if (data?.data?.length) return data.data.map(m => m.id)
    return Object.keys(MODEL_MAP)
  } catch { return Object.keys(MODEL_MAP) }
}

// ── 连通性测试 ─────────────────────────────────────

async function testImpl(apiKey: string): Promise<{ ok: boolean; latency_ms: number; model_count?: number; error?: string }> {
  const t0 = Date.now()
  try {
    const models = await listModelsImpl(apiKey)
    return { ok: models.length > 0, latency_ms: Date.now() - t0, model_count: models.length }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

// ── Provider Profile ────────────────────────────────

const profile: ProviderProfile = {
  name: 'google',
  displayName: 'Google Vertex AI (Gemini)',
  description: 'Google Cloud Vertex AI · Gemini 2.0 Flash / 1.5 Pro / 1.5 Flash',
  signupUrl: 'https://console.cloud.google.com/vertex-ai',
  authType: 'api_key',
  envVars: ['GOOGLE_API_KEY'],
  baseUrl: 'https://us-central1-aiplatform.googleapis.com',
  defaultModel: 'gemini-2.0-flash',
  fallbackModels: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  contextWindow: 1_048_576,
  supportsTools: true,
  supportsVision: true,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}

export default profile
