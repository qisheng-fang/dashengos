// packages/cli/src/client.ts · DaShengOS SSE 流式客户端
import { getValidToken } from './auth.js'
import { getConfig } from './config.js'

export interface StreamEvent {
  type: 'status' | 'token' | 'tool_start' | 'tool_end' | 'thinking' | 'searching' | 'done' | 'error' | 'usage' | 'step_log'
  text?: string
  tool?: string
  args?: string
  result?: string
  ok?: boolean
  summary?: string
  error?: string
  usage?: { prompt: number; completion: number; total: number }
  step?: { index: number; phase: string; detail: string; elapsed_ms: number }
}

export type StreamHandler = (event: StreamEvent) => void

export async function streamChat(
  message: string,
  onEvent: StreamHandler,
  opts?: { history?: Array<{ role: string; content: string }>; threadId?: string; signal?: AbortSignal },
): Promise<string> {
  const cfg = getConfig()
  const token = await getValidToken()

  const body: Record<string, unknown> = {
    message,
    ...(opts?.history?.length ? { history: opts.history } : {}),
    ...(opts?.threadId ? { threadId: opts.threadId } : {}),
    ...(cfg.model ? { model: cfg.model } : {}),
  }

  const resp = await fetch(`${cfg.backendUrl}/api/v1/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: opts?.signal,
  })

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`)
  }

  if (!resp.body) throw new Error('响应无 body')

  let fullResponse = ''
  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith(':')) continue

      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
        continue
      }

      if (line.startsWith('data: ')) {
        const json = line.slice(6)
        if (json === '[DONE]') continue

        try {
          const obj = JSON.parse(json)
          processSSE(currentEvent, obj, onEvent, (t) => { fullResponse += t })
        } catch {
          // non-JSON
        }
        currentEvent = ''
      }
    }
  }

  return fullResponse
}

function processSSE(
  eventName: string,
  obj: Record<string, unknown>,
  onEvent: StreamHandler,
  addText: (t: string) => void,
) {
  switch (eventName) {
    case 'token':
      // {"c": "text content"}
      const tok = (obj.c as string) || (obj.t as string) || ''
      addText(tok)
      onEvent({ type: 'token', text: tok })
      break
    case 'status':
      // {"t": "status text"} or {"s": "status text"}
      onEvent({ type: 'status', text: (obj.t as string) || (obj.s as string) || '' })
      break
    case 'thinking':
      // {"t": "thinking text"}
      onEvent({ type: 'thinking', text: (obj.t as string) || '' })
      break
    case 'searching':
      // {"q": "search query"}
      onEvent({ type: 'searching', text: (obj.q as string) || '' })
      break
    case 'tool_start':
      // {"n": name, "a": args}
      onEvent({ type: 'tool_start', tool: (obj.n as string) || '', args: (obj.a as string) || '' })
      break
    case 'tool_end':
      // {"n": name, "ok": bool, "s": summary}
      onEvent({
        type: 'tool_end',
        tool: (obj.n as string) || '',
        ok: obj.ok as boolean,
        summary: (obj.s as string) || '',
      })
      break
    case 'done':
      onEvent({ type: 'done' })
      break
    case 'error':
      // {"e": "error message"}
      onEvent({ type: 'error', error: (obj.e as string) || (obj.message as string) || '未知错误' })
      break
    case 'usage':
      // {"prompt": N, "completion": N, "total": N}
      onEvent({
        type: 'usage',
        usage: {
          prompt: (obj.prompt as number) || 0,
          completion: (obj.completion as number) || 0,
          total: (obj.total as number) || 0,
        },
      })
      break
    case 'step_log':
      onEvent({ type: 'step_log', step: obj as any })
      break
    default:
      // fallback: any text-like field
      if (obj.c) {
        addText(obj.c as string)
        onEvent({ type: 'token', text: obj.c as string })
      } else if (obj.t) {
        onEvent({ type: 'status', text: obj.t as string })
      }
  }
}

/** 单次调用（通过 stream 聚合） */
export async function chatOnce(
  message: string,
  opts?: { history?: Array<{ role: string; content: string }>; threadId?: string },
): Promise<string> {
  let full = ''
  await streamChat(message, (evt) => {
    if (evt.type === 'token') full += evt.text || ''
  }, opts)
  return full || '（无响应）'
}
