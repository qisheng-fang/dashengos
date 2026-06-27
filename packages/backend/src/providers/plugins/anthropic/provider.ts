// Anthropic Claude Provider — v6.2 with proper tool format + streaming
import type { ProviderProfile, ChatRequest, ChatResponse } from '../../base.js'
import type { StreamChunk } from '../../streaming.js'
import { convertToolsForProvider, normalizeProviderResponse } from '../../tool-adapter.js'

const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

async function chatImpl(req: ChatRequest, apiKey: string): Promise<ChatResponse> {
  const model = req.model || DEFAULT_MODEL
  const body: any = {
    model,
    max_tokens: req.max_tokens ?? 4096,
    messages: req.messages,
    stream: false,
  }
  if (req.temperature != null) body.temperature = req.temperature

  // v6.2: Use tool adapter for format conversion
  if (req.tools?.length) {
    body.tools = convertToolsForProvider('anthropic', req.tools as any)
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`Anthropic ${resp.status}: ${t.slice(0, 200)}`)
  }
  const d = await resp.json()

  // v6.2: Normalize response through tool adapter
  const normalized = normalizeProviderResponse('anthropic', d)
  return {
    content: normalized.content,
    model: normalized.model,
    usage: normalized.usage,
    finish_reason: normalized.finish_reason,
    tool_calls: normalized.tool_calls.length > 0 ? normalized.tool_calls : undefined,
  }
}

// v6.2: Proper Anthropic streaming via SSE
async function* chatStreamImpl(
  req: ChatRequest,
  apiKey: string,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const model = req.model || DEFAULT_MODEL
  const body: any = {
    model,
    max_tokens: req.max_tokens ?? 4096,
    messages: req.messages,
    stream: true,
  }
  if (req.temperature != null) body.temperature = req.temperature
  if (req.tools?.length) {
    body.tools = convertToolsForProvider('anthropic', req.tools as any)
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(300_000),
  })

  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`Anthropic stream ${resp.status}: ${t.slice(0, 200)}`)
  }

  const reader = resp.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let currentToolUse: any = null
  let toolInputBuffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (!data || data === '[DONE]') continue

        try {
          const event = JSON.parse(data)

          switch (event.type) {
            case 'content_block_start':
              if (event.content_block?.type === 'tool_use') {
                currentToolUse = {
                  id: event.content_block.id,
                  name: event.content_block.name || '',
                  input: {},
                }
                toolInputBuffer = ''
              }
              break

            case 'content_block_delta':
              if (event.delta?.type === 'text_delta') {
                yield { type: 'token', content: event.delta.text }
              } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
                toolInputBuffer += event.delta.partial_json || ''
              }
              break

            case 'content_block_stop':
              if (currentToolUse && toolInputBuffer) {
                try {
                  currentToolUse.input = JSON.parse(toolInputBuffer)
                } catch {
                  currentToolUse.input = {}
                }
                yield {
                  type: 'tool_call',
                  content: JSON.stringify(currentToolUse),
                  meta: {
                    tool_call_id: currentToolUse.id,
                    function_name: currentToolUse.name,
                    function_args: JSON.stringify(currentToolUse.input),
                  },
                }
                currentToolUse = null
                toolInputBuffer = ''
              }
              break

            case 'message_delta':
              if (event.delta?.stop_reason === 'tool_use') {
                // Tool use complete — already yielded above
              }
              break

            case 'message_stop':
              // Stream complete
              break
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  yield { type: 'done', content: '' }
}

async function listModelsImpl(_k: string): Promise<string[]> {
  return [
    'claude-sonnet-4-20250514',
    'claude-3.5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3.5-sonnet-20241022',
  ]
}

async function testImpl(apiKey: string) {
  const t0 = Date.now()
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: 'claude-3.5-haiku-20241022',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    })
    return {
      ok: r.ok,
      latency_ms: Date.now() - t0,
      error: r.ok ? undefined : `HTTP ${r.status}`,
    }
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - t0, error: e.message?.slice(0, 100) }
  }
}

const profile: ProviderProfile = {
  name: 'anthropic',
  displayName: 'Anthropic Claude',
  description: 'Claude Sonnet 4 / Haiku / Opus — 原生工具调用 + 流式',
  signupUrl: 'https://console.anthropic.com/',
  authType: 'api_key',
  envVars: ['ANTHROPIC_API_KEY'],
  baseUrl: 'https://api.anthropic.com/v1',
  defaultModel: 'claude-sonnet-4-20250514',
  fallbackModels: ['claude-3.5-haiku-20241022'],
  contextWindow: 200_000,
  supportsTools: true,
  supportsVision: true,
  chat: chatImpl,
  chatStream: chatStreamImpl,
  listModels: listModelsImpl,
  test: testImpl,
}
export default profile
