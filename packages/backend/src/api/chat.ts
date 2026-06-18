// packages/backend/src/api/chat.ts · v3.0 流式版 (2026-06-18)
//  v2.0: DeerFlow + 文档闭环
//  v3.0: ★ SSE 流式输出 — token 级实时响应（对标 WorkBuddy）

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { Buffer } from 'node:buffer'
import { connect as netConnect } from 'node:net'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { searchAndFormat } from '../core/web-search.js'
// import { getStatusText } from '../providers/streaming.js' // unused

const SOCKET_PATH = '/tmp/dasheng/deerflow.sock'
const DOCS_DIR = '/tmp/dasheng-docs'

function jsonRpcCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(SOCKET_PATH)
    const requestId = randomUUID()
    const payload = JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })

    let buffer = ''
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('deerflow timeout')) }, 30_000)

    socket.on('connect', () => socket.write(payload + '\n'))
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n').filter(l => l.trim())
      for (const line of lines) {
        try {
          const response = JSON.parse(line)
          if (response.id === requestId) {
            clearTimeout(timeout)
            socket.end()
            if (response.error) reject(new Error(response.error.message ?? 'deerflow error'))
            else resolve(response.result)
            return
          }
        } catch { /* continue */ }
      }
    })
    socket.on('error', (err) => { clearTimeout(timeout); socket.destroy(); reject(new Error(`deerflow unreachable: ${err.message}`)) })
  })
}

async function pollTask(taskId: string, maxAttempts = 90): Promise<unknown> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const status = await jsonRpcCall('research.status', { taskId }) as Record<string, unknown>
      const stat = status.status as string
      if (stat === 'completed' || stat === 'error') return status
    } catch { /* retry */ }
  }
  throw new Error('poll timeout')
}

const ChatSchema = z.object({
  message: z.string().min(1).max(10000),
  threadId: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional().default([]),
})

// ===== 文档生成闭环 =====

// 检测用户是否需要生成文档 (报告/PPT/表格/文档)
const DOC_KEYWORDS = [
  '生成报告', '写报告', '做报告', '生成文档', '写文档',
  '生成ppt', '做ppt', '写ppt', '生成pptx',
  '生成表格', '做表格', '生成excel', '导出',
  '生成word', '做word', '生成docx',
  '行业报告', '市场报告', '调研报告', '分析报告',
  '下载', '导出报告', '导出文档',
]

function detectDocIntent(message: string): { intent: boolean; format: 'docx' | 'pptx' | 'xlsx' } {
  const m = message.toLowerCase()
  if (DOC_KEYWORDS.some(k => m.includes(k))) {
    if (m.includes('ppt')) return { intent: true, format: 'pptx' }
    if (m.includes('表格') || m.includes('excel') || m.includes('xlsx')) return { intent: true, format: 'xlsx' }
    return { intent: true, format: 'docx' }
  }
  return { intent: false, format: 'docx' }
}

// 从 markdown/文本报告中提取结构化 sections
function parseReportToSections(report: string, title: string): Array<{ heading: string; content: string }> {
  const sections: Array<{ heading: string; content: string }> = []
  const lines = report.split('\n')
  let currentHeading = '概述'
  let currentContent: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 检测标题行 (## 或 ### 或 数字标题)
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n') })
      }
      currentHeading = trimmed.replace(/^#+\s*/, '')
      currentContent = []
    } else if (/^\d+[\.\、]\s/.test(trimmed)) {
      // 1. 标题 或 1、标题
      if (currentContent.length > 0) {
        sections.push({ heading: currentHeading, content: currentContent.join('\n') })
      }
      const match = trimmed.match(/^\d+[\.\、]\s*(.+)/)
      currentHeading = match ? match[1] : trimmed
      currentContent = []
    } else {
      currentContent.push(trimmed)
    }
  }

  // 最后一节
  if (currentContent.length > 0 || currentHeading !== '概述') {
    sections.push({ heading: currentHeading, content: currentContent.join('\n') || currentContent.join('\n') })
  }

  // 如果没有任何结构，把全文当一节
  if (sections.length === 0) {
    sections.push({ heading: title, content: report })
  }

  return sections
}

// 业务闭环：生成文档文件
async function generateDocument(
  report: string,
  format: 'docx' | 'pptx' | 'xlsx',
  title: string,
): Promise<{ ok: boolean; filePath?: string; fileName?: string; size?: number; error?: string }> {
  const { generateDOCX, generatePPTX, generateXLSX } = await import('../core/document-generator.js')

  try {
    fs.mkdirSync(DOCS_DIR, { recursive: true })

    if (format === 'pptx') {
      const sections = parseReportToSections(report, title)
      const slides = sections.map(s => ({ title: s.heading, content: s.content }))
      const result = await generatePPTX({ title, slides })
      return { ok: true, ...result }
    }

    if (format === 'xlsx') {
      // 尝试从报告提取表格数据
      const sections = parseReportToSections(report, title)
      const rows = sections.map(s => [s.heading, s.content.slice(0, 500)])
      const result = await generateXLSX({
        sheets: [{ name: '报告数据', headers: ['章节', '内容'], rows }],
      })
      return { ok: true, ...result }
    }

    // 默认: DOCX
    const sections = parseReportToSections(report, title)
    const result = await generateDOCX({ title, sections })
    return { ok: true, ...result }
  } catch (error: any) {
    return { ok: false, error: error.message }
  }
}

// ===== 主路由 =====

export async function chatRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const { message, threadId: clientThreadId } = parsed.data
    const threadId = clientThreadId ?? `th_${Date.now().toString(36)}`
    const docIntent = detectDocIntent(message)

    // ★ 关键优化：简单问候不走 DeerFlow，直接走 LLM（秒回）
    // 检查消息本身是否是简单问候（不依赖 history 长度）
    const isGreetingOnly = /^(你好|hi|hello|嗨|hey|在吗|哈喽|哈啰|谢谢|再见|bye|早上好|中午好|晚上好|晚安)[\s！!。,，。]*$/i.test(message.trim())
    const isVeryShort = message.trim().length <= 4 && /^[\u4e00-\u9fa5a-zA-Z\s！!。,，。?？]*$/.test(message.trim())
    const isSimpleGreeting = isGreetingOnly || isVeryShort

    if (isSimpleGreeting) {
      try {
        const answer = await directLLM(message, parsed.data.history)
        return reply.send({
          threadId,
          status: 'completed',
          report: answer,
          sources: ['direct_llm'],
        })
      } catch (e: any) {
        req.log.warn({ err: e.message }, 'simple greeting directLLM failed')
      }
    }

    // ★ 关键优化：跑 DeerFlow 的同时 directLLM 异步跑
    // 谁先完成用谁；DeerFlow 阻塞时间 < 18s，绝不超时

    let report = ''
    let sources: string[] = []

    const llmPromise = (async (): Promise<string> => {
      return await directLLM(message, parsed.data.history)
    })()

    const deerflowPromise = (async (): Promise<string | null> => {
      try {
        const createResult = await jsonRpcCall('research.run', {
          query: message, threadId, subAgents: [], maxSteps: 20,
        }) as Record<string, unknown>
        const taskId = createResult.taskId as string
        const finalStatus = await pollTask(taskId, 8)
        const status = finalStatus as Record<string, unknown>
        const rep = (status.report as string) || ''
        if (rep && rep !== '任务超时') {
          req.log.info({ threadId }, 'deerflow completed')
          return rep
        }
        return null
      } catch (e: any) {
        req.log.warn({ err: e.message }, 'deerflow failed')
        return null
      }
    })()

    // LLM 超时 180s（覆盖完整长报告生成），DeerFlow 18s 强制降级
    const llmTimeout = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), 180_000)
    })
    const dfTimeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 18_000)
    })

    // ★ 关键：等待两者，先到先得
    const llmResult = await Promise.race([llmPromise, llmTimeout]).catch(() => null)
    const dfResult = await Promise.race([deerflowPromise, dfTimeout])

    if (dfResult && dfResult.length > (llmResult?.length || 0) * 1.2) {
      // DeerFlow 报告明显更丰富时优先
      report = dfResult
      sources = ['agent_pipeline']
    } else if (llmResult) {
      report = llmResult
      const searched = await needsWebSearch(message)
      sources = searched ? ['web_search', 'llm_synthesis'] : ['direct_llm']
    } else if (dfResult) {
      report = dfResult
      sources = ['agent_pipeline']
    } else {
      // ★ 兜底：所有都失败时返回友好消息（不返 503）
      req.log.error({ message }, 'all engines failed, returning fallback message')
      return reply.send({
        threadId,
        status: 'completed',
        report: '抱歉，AI 引擎暂时繁忙。请稍后再试，或检查网络连接。\n\n如果问题持续：\n1. 确认 DeerFlow daemon 在运行：`/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3 -m deerflow.daemon`\n2. 检查 SiliconFlow API key 是否过期\n3. 查看后端日志：`tail -f /tmp/dasheng/backend.log`',
        sources: ['fallback'],
      })
    }

    // ── 构建响应 ──
    const response: Record<string, unknown> = {
      threadId,
      status: 'completed',
      report,
      sources,
    }

    // ── 业务闭环：自动生成可下载文档 ──
    if (docIntent.intent && report.length > 100) {
      try {
        const docTitle = extractTitle(message, report)
        const docResult = await generateDocument(report, docIntent.format, docTitle)
        if (docResult.ok && docResult.filePath) {
          response.artifacts = [{
            type: 'document',
            format: docIntent.format,
            fileName: docResult.fileName,
            size: docResult.size,
            downloadUrl: `/api/v1/chat/download/${docResult.fileName}`,
          }]
          response.report = `${report}\n\n---\n📄 已生成可下载文件：[${docResult.fileName}](/api/v1/chat/download/${docResult.fileName}) (${formatSize(docResult.size || 0)})`
        } else {
          response.artifacts = [{ type: 'document', format: docIntent.format, error: docResult.error }]
        }
      } catch (docErr: any) {
        req.log.warn({ err: docErr.message }, 'doc gen failed (non-fatal)')
      }
    }

    return reply.send(response)
  })

  // ── Agent Runtime 端点（tool_call 自主循环） ──
  app.post('/agent', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const { message, history } = parsed.data
    const user = req.user as { sub?: string; id?: string; role?: string }
    const userId = user?.sub || user?.id || 'anonymous'
    const workspaceDir = '/Users/apple/Desktop/ai-workbench-v2'

    try {
      const { runAgentLoop } = await import('../core/agent/loop.js')
      const result = await runAgentLoop(message, history, {
        userId,
        workspaceDir,
        elevatedMode: false, // default: only low+medium risk tools
        maxIterations: 25,
      })

      // Audit log for agent operations
      try {
        const { audit } = await import('../core/audit.js')
        await audit.log({
          type: 'tool.exec',
          severity: result.success ? 'INFO' : 'WARN',
          action: 'chat.agent',
          user_id: userId,
          target: 'agent_loop',
          args_json: JSON.stringify({ steps: result.steps.length }),
          result_summary: `${result.success ? 'completed' : 'error'} in ${result.steps.reduce((s, t) => s + t.durationMs, 0)}ms`,
          duration_ms: result.steps.reduce((s, t) => s + t.durationMs, 0),
        })
      } catch {/* audit failure is non-fatal */}

      // If confirmation needed, return special status
      if (result.needsConfirmation && result.needsConfirmation.length > 0) {
        return reply.send({
          threadId: `th_${Date.now().toString(36)}`,
          status: 'awaiting_confirmation',
          report: result.response,
          confirmations: result.needsConfirmation,
          steps: result.steps.length,
        })
      }

      return reply.send({
        threadId: `th_${Date.now().toString(36)}`,
        status: result.success ? 'completed' : 'error',
        report: result.response,
        error: result.error,
        steps: result.steps.length,
        tokensUsed: result.totalTokens,
      })
    } catch (e: any) {
      req.log.error({ err: e.message }, 'Agent loop crashed')
      return reply.code(500).send({
        code: 'AGENT_CRASH',
        error: e.message?.slice(0, 300),
      })
    }
  })

  // ── ★ SSE 流式端点 — token 级实时响应 ──
  //  POST /api/v1/chat/stream
  //  返回 text/event-stream: status/token/usage/tool_call/done/error 事件
  app.post('/stream', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const { message, threadId: clientThreadId, history } = parsed.data
    void clientThreadId // SSE 端点不依赖 threadId 做持久化

    // 设置 SSE 响应头
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',          // 禁止 Nginx 缓冲
      'Access-Control-Allow-Origin': '*',
    })

    const controller = new AbortController()
    req.raw.on('close', () => controller.abort())

    try {
      const { getActiveProvider, getApiKey } = await import('../providers/index.js')
      const provider = getActiveProvider()
      const apiKey = getApiKey(provider) ?? ''

      if (provider.authType === 'api_key' && !apiKey) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ e: `[${provider.name}] API Key 未配置` })}\n\n`)
        reply.raw.write('event: done\ndata: {}\n\n')
        reply.raw.end()
        return
      }

      const model = process.env[provider.name.toUpperCase() + '_DEFAULT_MODEL'] || provider.defaultModel

      // 构建消息（复用 directLLM 的逻辑）
      const systemPrompt = buildSystemPrompt(message)
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.slice(-20),
        { role: 'user' as const, content: message },
      ]

      // 检查 provider 是否支持流式
      if (!provider.chatStream) {
        // 不支持流式 → 回退到非流式 + 分块发送
        reply.raw.write(`event: status\ndata: ${JSON.stringify({ t: '等待模型响应...' })}\n\n`)

        const response = await provider.chat(
          { model, messages, max_tokens: 4096, temperature: 0.7 },
          apiKey,
        )

        // 分块发送内容（模拟流式效果）
        const text = response.content || ''
        const chunkSize = 4
        for (let i = 0; i < text.length; i += chunkSize) {
          const chunk = text.slice(i, i + chunkSize)
          reply.raw.write(`event: token\ndata: ${JSON.stringify({ c: chunk, m: { model: response.model } })}\n\n`)
        }

        reply.raw.write(`event: usage\ndata: ${JSON.stringify(response.usage)}\n\n`)
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ finish_reason: response.finish_reason, model: response.model })}\n\n`)
        reply.raw.end()
        return
      }

      // ★ 真正的 SSE 流式输出
      for await (const chunk of provider.chatStream(
        { model, messages, max_tokens: 8192, temperature: 0.7 },
        apiKey,
        controller.signal,
      )) {
        if (controller.signal.aborted) break
        const sseLine = formatSSEChunk(chunk)
        if (sseLine) reply.raw.write(sseLine)
      }

      reply.raw.end()
    } catch (e: any) {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ e: e.message?.slice(0, 300) || '未知错误' })}\n\n`)
        reply.raw.write('event: done\ndata: {}\n\n')
        reply.raw.end()
      }
    }
  })

  // ── 文档下载端点 ──
  app.get('/download/:fileName', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { fileName } = req.params as { fileName: string }
    const filePath = `${DOCS_DIR}/${fileName}`

    // 安全检查：禁止目录穿越
    if (fileName.includes('..') || fileName.includes('/')) {
      return reply.code(400).send({ code: 'INVALID_FILENAME' })
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ code: 'FILE_NOT_FOUND' })
    }

    const ext = fileName.split('.').pop()?.toLowerCase()
    const mimeTypes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    }
    const contentType = mimeTypes[ext || ''] || 'application/octet-stream'

    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`)
      .send(fs.readFileSync(filePath))
  })

  app.get('/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try { await jsonRpcCall('health.ping', {}); return reply.send({ status: 'ok' }) }
    catch (e: any) { return reply.code(503).send({ status: 'error', error: e.message }) }
  })
}

// ── 工具函数 ──

function extractTitle(message: string, report: string): string {
  // 尝试从报告第一行提取标题
  const firstLine = report.split('\n')[0]?.replace(/^#+\s*/, '').trim()
  if (firstLine && firstLine.length > 2 && firstLine.length < 80) return firstLine
  // 从用户消息提取关键词
  const clean = message.replace(/[帮我请]|生成|一份|一个|一篇/g, '').trim()
  return clean.slice(0, 40) || '工作报告'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SEARCH_KEYWORDS = ['搜索', '查', '市场', '数据', '报告', '趋势', '竞品', '对比', '行业', '最新', '调查', '分析']

async function needsWebSearch(message: string): Promise<boolean> {
  return SEARCH_KEYWORDS.some(k => message.includes(k)) || message.length > 50
}

// ── 流式辅助函数 ──

/** 将 StreamChunk 格式化为 SSE 文本行 */
function formatSSEChunk(chunk: { type: string; content?: string; meta?: Record<string, unknown> }): string {
  switch (chunk.type) {
    case 'token': return `event: token\ndata: ${JSON.stringify({ c: chunk.content, m: chunk.meta })}\n\n`
    case 'status': return `event: status\ndata: ${JSON.stringify({ t: chunk.content })}\n\n`
    case 'usage': return `event: usage\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    case 'tool_call': return `event: tool_call\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    case 'error': return `event: error\ndata: ${JSON.stringify({ e: chunk.content })}\n\n`
    case 'done': return `event: done\ndata: ${JSON.stringify(chunk.meta || {})}\n\n`
    default: return ''
  }
}

/** 构建 system prompt（从 directLLM 提取） */
function buildSystemPrompt(message: string): string {
  // 检测消息类型
  const wantsHTML = /html|网页|web\s*页|html\s*格式/i.test(message)
  const wantsReport = /报告|report|分析|行业|市场|趋势|研究/.test(message)
  const isBusinessRequest = wantsReport || message.length > 50
  const isGreetingOnly = /^(你好|hi|hello|嗨|hey|在吗|哈喽|哈啰|谢谢|再见|bye|早上好|中午好|晚上好|晚安)[\s！!。,，。]*$/i.test(message.trim())

  if (isGreetingOnly) {
    return '你是 DaShengOS 智能工作台助手，品牌「爱尤趣」(情趣娃娃)。回复简洁、友好、专业。支持中文。'
  }

  if (wantsReport || isBusinessRequest) {
    return `你是 DaShengOS 智能工作台助手，专门为「爱尤趣」情趣娃娃品牌服务。\n用户提了一个业务级问题。请以**资深行业分析师 + 设计师**身份，给出专业、客观的回复。\n${wantsHTML ? '使用 HTML 格式输出' : '使用 Markdown'}\n包含：执行摘要 / 市场规模 / 趋势 / 竞品 / 机会 / 建议`
  }

  return '你是 DaShengOS 智能工作台助手，品牌「爱尤趣」(情趣娃娃)。回复简洁、友好、专业。支持中文。'
}

async function directLLM(message: string, history: Array<{role: string; content: string}> = []): Promise<string> {
  // D3.6 (2026-06-17): 改用 providers 插件化
  const { getActiveProvider, getApiKey, markApiKeyFailed } = await import('../providers/index.js')
  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (provider.authType === 'api_key' && !apiKey) {
    throw new Error(`[${provider.name}] ${provider.envVars[0]} 未配置`)
  }

  const baseUrl = provider.baseUrl
  const model = process.env[provider.name.toUpperCase() + '_DEFAULT_MODEL'] || provider.defaultModel

  // 简单问候快速通道:不走 web search,直接 LLM (重试 3 次,凭证池轮换)
  const isSimpleNow = /(你好|hi|hello|嗨|hey|在吗|哈喽|哈啰|谢谢|再见|bye|早上好|中午好|晚上好|晚安)[\s！!。,，。]*$/i.test(message.trim())
  if (isSimpleNow) {
    let lastErr = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const k = getApiKey(provider) ?? ''
      try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${k}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: '你是 DaShengOS 智能工作台助手，品牌「爱尤趣」(情趣娃娃)。回复简洁、友好、专业。支持中文。' },
              ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
              { role: 'user', content: message },
            ],
            max_tokens: 256,
            temperature: 0.7,
          }),
          signal: AbortSignal.timeout(30_000),
        })
        if (!resp.ok) {
          markApiKeyFailed(provider, k)
          lastErr = `LLM HTTP ${resp.status}`
          continue
        }
        const data = await resp.json() as any
        return data.choices[0]?.message?.content || ''
      } catch (e: any) {
        markApiKeyFailed(provider, k)
        lastErr = e.message
      }
    }
    throw new Error(`LLM failed after 3 attempts: ${lastErr}`)
  }

  const shouldSearch = await needsWebSearch(message)
  let searchContext = ''
  if (shouldSearch) {
    // ★ 不阻塞 LLM：web search 设 3s 硬超时，失败就跳过
    try {
      const searchPromise = searchAndFormat(message.slice(0, 80))
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(''), 3_000))
      searchContext = await Promise.race([searchPromise, timeoutPromise])
    } catch { /* ok */ }
  }

  // 检测用户特殊需求：HTML 格式 / 长报告 / 详细报告
  const wantsHTML = /html|网页|web\s*页|html\s*格式/i.test(message)
  const wantsDetailed = /详细|深入|完整|全面|完整|详尽|细化/.test(message)
  const wantsReport = /报告|report|分析|行业|市场|趋势|研究/.test(message)
  const isBusinessRequest = wantsReport || message.length > 50

  // ★ 业务级 system prompt：精美 HTML 设计 + 数据可视化
  const htmlStyleGuide = `
# 设计规范 (2026 UI 设计趋势)
- 主色调：品牌色 #FF6B35（爱尤趣） + 辅助色 #2C3E50（深空蓝） + 强调色 #F39C12（暖金）
- 字体：系统字体栈 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif
- 布局：渐变 hero + 卡片式网格 + 数据卡片大数字
- 图表：纯 CSS/SVG 实现的条形图、饼图、进度条（不要用图片或 canvas）
- 动效：CSS transition + hover 微动效
- 现代感：glassmorphism（毛玻璃）、gradient text、box-shadow 层次感

# 必含可视化元素
1. **Hero 区域**：渐变背景 + 大标题 + 关键数据一句话总结
2. **关键指标卡片 (KPI)**：3-4 个大数字卡片（市场规模 / 增长率 / 用户数等）
3. **数据条形图**：用纯 CSS 实现的市场份额/年份对比
4. **饼图或环形图**：用 SVG 实现的产品/渠道占比
5. **进度条**：市场渗透率/完成度
6. **趋势时间线**：用 CSS 实现的发展阶段
7. **数据表格**：斑马纹 + hover 高亮
8. **对比卡片**：竞品 SWOT 矩阵
9. **行动建议**：带图标的卡片网格

# 严禁
- ❌ 用 emoji 当图标
- ❌ 用占位符 lorem ipsum
- ❌ 写假数据（用真实公开行业数据或合理估算）
- ❌ 段落堆砌无视觉层次
- ❌ 缺少图表（必须 ≥ 4 个数据可视化元素）`

  const systemPrompt = searchContext
    ? `你是 DaShengOS 智能工作台助手，专门为「爱尤趣」情趣娃娃品牌服务。\n\n以下是关于用户问题的搜索结果：\n\n${searchContext}\n\n请基于这些真实信息给出**设计精美的 HTML 报告**：${htmlStyleGuide}\n\n结构要求：\n- 用专业行业分析师的口吻\n- 引用具体数据来源（标注来源）\n- ${wantsHTML ? '使用 HTML 格式输出（完整的 <!DOCTYPE html>...结构）' : '使用 Markdown'}\n- ${wantsDetailed ? '3000-5000 字，包含 ≥4 个数据可视化元素' : '1500-2500 字，包含 ≥3 个数据可视化元素'}\n- 至少包含：执行摘要 / 市场规模 / 趋势 / 竞品 / 机会 / 建议 6 大块`
    : isBusinessRequest
    ? `你是 DaShengOS 智能工作台助手，专门为「爱尤趣」情趣娃娃品牌服务。\n\n用户提了一个业务级问题。请以**资深行业分析师 + 设计师**身份，制作一份精美 HTML 报告：${htmlStyleGuide}\n\n结构要求：\n- 用专业、客观的语调\n- ${wantsHTML ? '使用 HTML 格式输出（完整的 <!DOCTYPE html>...结构）' : '使用 Markdown'}\n- ${wantsDetailed ? '3000-5000 字，包含 ≥4 个数据可视化元素（条形图/饼图/进度条/数据卡片）' : '1500-2500 字，包含 ≥3 个数据可视化元素'}\n- 至少包含：执行摘要 / 市场规模 / 趋势 / 竞品 / 机会 / 建议 6 大块\n- 结尾给出可执行的建议清单`
    : '你是 DaShengOS 智能工作台助手，品牌「爱尤趣」(情趣娃娃)。回复简洁、友好、专业。支持中文。'

  // 构建消息：system + history + 当前消息
  const messages: Array<{role: string; content: string}> = []

  messages.push({ role: 'system', content: systemPrompt })
  
  // 2. 对话历史（最近10轮）
  for (const h of history.slice(-20)) {
    messages.push({ role: h.role, content: h.content })
  }
  
  // 3. 当前消息
  messages.push({ role: 'user', content: message })

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: wantsDetailed ? 8000 : (searchContext || isBusinessRequest) ? 6000 : 2048,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`)
  const data = await resp.json() as Record<string, unknown>
  const choices = data.choices as Array<{ message: { content: string } }>
  return choices?.[0]?.message?.content || '收到。'
}
