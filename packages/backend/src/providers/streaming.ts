// packages/backend/src/providers/streaming.ts · SSE 流式输出 (2026-06-18)
//  供所有 OpenAI 兼容 provider 共用
//  解析 OpenAI stream 格式 → 结构化 StreamChunk AsyncGenerator

import { sqlite } from '../storage/db.js'
export interface StreamChunk {
  /** 事件类型 */
  type: 'token' | 'status' | 'usage' | 'tool_call' | 'done' | 'error' | 'thinking'
  /** 内容（token 文本 / 状态描述 / 错误信息） */
  content: string
  /** 元数据（仅 usage/tool_call 类型使用） */
  meta?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    tool_call_id?: string
    tool_name?: string
    tool_args?: string
    finish_reason?: string
    model?: string
  }
}

/** OpenAI 兼容 API 的流式调用 */
export async function* openAIStream(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(body.stream ? { Accept: 'text/event-stream' } : {}),
    },
    body: JSON.stringify({ ...body, stream: true }),
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
  let reasoningAcc = ''
  let model = ''
  let usageData: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {}
  const toolCallIdMap: Record<string, string> = {}  // index → id for tool call coalescing

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // 按 SSE 双换行分割
      const lines = buffer.split('\n\n')
      // 保留最后一个不完整的 chunk
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue

        const dataStr = line.slice(5).trim()
        if (dataStr === '[DONE]') {
          yield { type: 'usage', content: '', meta: { ...usageData, model } }
          yield { type: 'done', content: '', meta: { finish_reason: 'stop', model } }
          return
        }

        try {
          const json = JSON.parse(dataStr) as Record<string, any>
          const choice = json.choices?.[0]
          if (!choice) continue

          model = json.model || model

          // 收集 usage 数据
          if (json.usage) {
            usageData = {
              prompt_tokens: json.usage.prompt_tokens || usageData.prompt_tokens,
              completion_tokens: json.usage.completion_tokens || usageData.completion_tokens,
              total_tokens: json.usage.total_tokens || usageData.total_tokens,
            }
          }

          // delta 内容
          const delta = choice.delta

          // v6.0: DeepSeek V4 reasoning_content is model thinking → hide from user, show content only
          // Handle reasoning_content FIRST (always accumulate, never show to user)
          if (delta?.reasoning_content) {
            reasoningAcc = (reasoningAcc || '') + delta.reasoning_content;
            if (reasoningAcc.length < 80 || reasoningAcc.length % 200 < 10) {
              yield { type: 'thinking', content: 'Agent推理中...', meta: { model, reasoning_text: delta.reasoning_content } }
            }
          }
          // Handle content SECOND (this is the visible output)
          if (delta?.content) {
            yield { type: 'token', content: delta.content, meta: { model } }
          }

          // tool_call 流式片段 — handle multiple parallel tool calls with index
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!tc) continue
              const index = tc.index ?? 0
              // Track index→id mapping: OpenAI only sends id in first delta per index
              const idxKey = 'tc_idx_' + index
              if (tc.id) (toolCallIdMap as any)[idxKey] = tc.id
              const callId = tc.id || (toolCallIdMap as any)[idxKey] || ('tc_' + index)
              if (tc.function?.name) {
                yield {
                  type: 'status',
                  content: `🔧 调用工具[${index}]: ${tc.function.name}`,
                  meta: {},
                }
                yield {
                  type: 'tool_call',
                  content: tc.function.name,
                  meta: {
                    tool_call_id: callId,
                    tool_name: tc.function.name,
                    tool_args: '',
                  },
                }
              }
              if (tc.function?.arguments) {
                yield {
                  type: 'tool_call',
                  content: tc.function.arguments,
                  meta: {
                    tool_call_id: callId,
                    tool_name: tc.function?.name || '',
                    tool_args: tc.function.arguments,
                  },
                }
              }
            }
          }

          // finish_reason
          if (choice.finish_reason && choice.finish_reason !== 'stop' && choice.finish_reason !== null) {
            yield { type: 'done', content: '', meta: { finish_reason: choice.finish_reason, model } }
          }
        } catch {
          /* 非JSON行，跳过 */
        }
      }
    }

    // 处理最后可能剩余的 buffer
    if (buffer.trim()) {
      try {
        const dataStr = buffer.startsWith('data:') ? buffer.slice(5).trim() : buffer
        if (dataStr !== '[DONE]') {
          const json = JSON.parse(dataStr)
          const choice = json.choices?.[0]?.delta
          if (choice?.content) {
            yield { type: 'token', content: choice.content, meta: { model } }
          }
        }
      } catch { /* ignore */ }
    }

    // 最终 usage + done
    yield { type: 'usage', content: '', meta: { ...usageData, model } }
    yield { type: 'done', content: '', meta: { finish_reason: 'stop', model } }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 将 AsyncGenerator 转为 Node.js ReadableStream
 * 用于 Fastify reply.raw 的流式响应
 */
export function generatorToReadable(
  gen: AsyncGenerator<StreamChunk>,
): ReadableStream {
  return new ReadableStream({
    async pull(controller) {
      const result = await gen.next()
      if (result.done) {
        controller.close()
        return
      }
      const chunk = result.value
      // 转为 SSE 格式
      const sseLine = formatSSE(chunk)
      controller.enqueue(new TextEncoder().encode(sseLine))
    },
    async cancel() {
      await gen.return?.(undefined)
    },
  })
}

/** 将 StreamChunk 编码为 SSE 行格式 */
function formatSSE(chunk: StreamChunk): string {
  switch (chunk.type) {
    case 'token':
      return `event: token\ndata: ${JSON.stringify({ c: chunk.content, m: chunk.meta })}\n\n`
    case 'status':
      return `event: status\ndata: ${JSON.stringify({ t: chunk.content })}\n\n`
    case 'usage':
      return `event: usage\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    case 'tool_call':
      return `event: tool_call\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    case 'error':
      return `event: error\ndata: ${JSON.stringify({ e: chunk.content })}\n\n`
    case 'done':
      return `event: done\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    default:
      return ''
  }
}

/** 动态状态映射 — 模拟 WorkBuddy 风格的状态文案 */
const STATUS_MAP: Record<string, string> = {
  reading_file: '📖 已读取文件，分析上下文中...',
  writing_file: '✏️ 正在写入文件...',
  editing_file: '✂️ 正在编辑文件...',
  listing_files: '📁 正在浏览目录结构...',
  searching_content: '🔍 正在搜索代码内容...',
  running_command: '⚡ 正在执行命令...',
  checking_port: '🌐 正在检查端口状态...',
  reading_logs: '📋 正在读取日志...',
  querying_db: '🗄️ 正在查询数据库...',
  fetching_web: '🌍 正在抓取网页内容...',
  searching_web: '🔎 正在搜索网络信息...',
  executing_skill: '🛠️ 正在执行技能...',
  thinking: '💭 AI 思考中...',
  analyzing: '🧠 正在深度分析...',
  generating: '✨ 正在生成内容...',
  diagnosing: '🩺 正在诊断系统问题...',
  repairing: '🔧 正在修复问题...',
  waiting_model: '等待模型响应...',
  preparing_task: '正在准备任务...',
  decoding_intent: '领导潜台词解码中...',
  cost_judge: '不确定是否值得深入时，让 DaShengOS 给低成本初判',
}

/** 获取动态状态文本（带随机变化） */
export function getStatusText(key: string, extra?: string): string {
  const base = STATUS_MAP[key] || STATUS_MAP.thinking
  if (extra) return `${base} · ${extra}`
  return base
}

// ═══════════════════════════════════════════════════════
// Status Messages (re-added after git restore)
// ═══════════════════════════════════════════════════════

const STATUS_MAP_FALLBACK: Record<string, string> = {
  reading_file: '📖 已读取文件，分析上下文中...',
  writing_file: '✏️ 正在写入文件...',
  editing_file: '✂️ 正在编辑文件...',
  listing_files: '📁 正在浏览目录结构...',
  searching_content: '🔍 正在搜索代码内容...',
  running_command: '⚡ 正在执行命令...',
  checking_port: '🌐 正在检查端口状态...',
  reading_logs: '📋 正在读取日志...',
  querying_db: '🗄️ 正在查询数据库...',
  fetching_web: '🌍 正在抓取网页内容...',
  searching_web: '🔎 正在搜索网络信息...',
  executing_skill: '🛠️ 正在执行技能...',
  thinking: '💭 AI 思考中...',
  analyzing: '🧠 正在深度分析...',
  generating: '✨ 正在生成内容...',
  diagnosing: '🩺 正在诊断系统问题...',
  repairing: '🔧 正在修复问题...',
  waiting_model: '等待模型响应...',
  preparing_task: '正在准备任务...',
  decoding_intent: '领导潜台词解码中...',
  cost_judge: '不确定是否值得深入时，让 DaShengOS 给低成本初判',
}

let _statusMapCache: Record<string, string> | null = null
let _statusMapCacheTime = 0
const STATUS_CACHE_TTL = 60_000

export function loadStatusMap(): Record<string, string> {
  const now = Date.now()
  if (_statusMapCache && (now - _statusMapCacheTime) < STATUS_CACHE_TTL) return _statusMapCache
  try {
    const rows = sqlite.prepare('SELECT key, value FROM status_messages').all() as Array<{ key: string; value: string }>
    if (rows.length > 0) {
      const map: Record<string, string> = { ...STATUS_MAP_FALLBACK }
      for (const r of rows) map[r.key] = r.value
      _statusMapCache = map; _statusMapCacheTime = now; return map
    }
  } catch { /* 表可能不存在 */ }
  return STATUS_MAP_FALLBACK
}

export function saveStatusMessage(key: string, value: string): void {
  try {
    sqlite.prepare(`INSERT INTO status_messages (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(key, value, Date.now())
    _statusMapCache = null
  } catch (e) { console.error('[Status] saveStatusMessage failed:', e) }
}

export function seedStatusMessages(): void {
  try {
    const exists = sqlite.prepare('SELECT COUNT(*) as c FROM status_messages').get() as { c: number }
    if (exists && exists.c > 0) return
    for (const [key, value] of Object.entries(STATUS_MAP_FALLBACK)) saveStatusMessage(key as string, value)
    console.log('[Status] 流式状态文案已初始化到数据库')
  } catch (e) { console.error('[Status] seedStatusMessages failed:', e) }
}
