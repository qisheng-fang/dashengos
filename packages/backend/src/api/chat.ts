// packages/backend/src/api/chat.ts · v3.0 流式版 (2026-06-18)
//  v2.0: DeerFlow + 文档闭环
//  v3.0: ★ SSE 流式输出 — token 级实时响应（对标 WorkBuddy）

import { recordMetric } from '../core/otel-exporter.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sqlite } from '../storage/db.js'
import { Buffer } from 'node:buffer'
import { connect as netConnect } from 'node:net'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { searchAndFormat } from '../core/web-search.js'
import { getMultimodalCapability } from '../core/multimodal-bridge.js'
import { extractAndSaveCrossSessionMemory } from '../core/harness/index.js'
import { processAgentOutput, createGatewayContext } from '../core/output-gateway/index.js'
import { getToolsForLLM, executeTool } from '../core/tools/registry.js'
import { buildSuperSystemPrompt, buildLightSystemPrompt } from '../core/harness/system-prompt.js'
// import { getStatusText } from '../providers/streaming.js' // unused

const DOCS_DIR = '/tmp/dasheng-docs'

const ChatSchema = z.object({
  model: z.string().optional(),
  message: z.string().min(1).max(10000),
  threadId: z.string().optional(),
  mode: z.enum(['yolo', 'ask', 'safe']).optional().default('ask'),
  projectPath: z.string().optional().default(''),
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


// ===== Output Gateway 辅助函数 =====
// 所有返回给用户的 report 必须经过此管道处理

function processReportThroughGateway(
  report: string,
  userId: string,
  sessionId: string,
): string {
  try {
    const ctx = createGatewayContext({
      userId,
      sessionId,
      workspaceDir: process.env.WORKSPACE_DIR || '/Users/apple/Desktop/ai-workbench-v2',
      approvalMode: 'yolo',
    })
    const result = processAgentOutput(
      { kind: 'message', content: report },
      ctx,
    )
    if (result.status === 'allow' && typeof result.safeContent === 'string') {
      return result.safeContent
    }
  } catch { /* non-critical, return original */ }
  return report
}

export async function chatRoutes(app: FastifyInstance) {
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const user = req.user as { sub?: string; id?: string; role?: string }
    const uid = user?.sub || user?.id || 'anonymous'
    const { message, threadId: clientThreadId, mode: approvalMode } = parsed.data
    const threadId = clientThreadId ?? `th_${Date.now().toString(36)}`
    const docIntent = detectDocIntent(message)

    // ★ 关键优化：简单问候不走 DeerFlow，直接走 LLM（秒回）
    // 检查消息本身是否是简单问候（不依赖 history 长度）
    const isGreetingOnly = /^(你好|hi|hello|嗨|hey|在吗|哈喽|哈啰|谢谢|再见|bye|早上好|中午好|晚上好|晚安)[\s！!。,，。]*$/i.test(message.trim())
    const isVeryShort = message.trim().length <= 4 && /^[\u4e00-\u9fa5a-zA-Z\s！!。,，。?？]*$/.test(message.trim())
    const isSimpleGreeting = isGreetingOnly || isVeryShort

    if (isSimpleGreeting) {
      try {
        // Inject memory context for personalized responses
        let augmentedMessage = message
        try {
          const { loadMemoryContext } = await import('../core/harness/memory.js')
          const user = req.user as { sub?: string; id?: string }
          const uid = user?.sub || user?.id || 'anonymous'
          const mem = loadMemoryContext(uid)
          const cross = (mem.crossSessionMemory || []).filter((e: any) => e.category === 'preference' || e.category === 'fact' || e.category === 'decision')
          if (cross.length > 0) {
            augmentedMessage = `[用户记忆: ${cross.map((f: any) => f.summary).join(' | ')}]

${message}`
          }
        } catch { /* memory injection non-critical */ }
        const answer = await directLLM(augmentedMessage, parsed.data.history)
        recordMetric('chat_requests_total', 1, 'counter', {})
        return reply.send({
          threadId,
          status: 'completed',
          report: processReportThroughGateway(answer, uid, threadId),
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

    // LLM 超时 180s（覆盖完整长报告生成）
    const llmTimeout = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('LLM timeout')), 180_000)
    })

    const llmResult = await Promise.race([llmPromise, llmTimeout]).catch(() => null)

    if (llmResult) {
      report = llmResult
      const searched = await needsWebSearch(message)
      sources = searched ? ['web_search', 'llm_synthesis'] : ['direct_llm']
    } else {
      // ★ 兜底：所有都失败时返回友好消息（不返 503）
      req.log.error({ message }, 'LLM engine failed, returning fallback message')
      return reply.send({
        threadId,
        status: 'completed',
        report: processReportThroughGateway('抱歉，AI 引擎暂时繁忙。请稍后再试。\\n\\n如果问题持续：\\n1. 检查 API key 是否过期\\n2. 查看后端日志', uid, threadId),
        sources: ['fallback'],
      })
    }


    // ── Output Gateway: 去AI格式化 + 脱敏 ──
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

    // 跨对话记忆持久化 (v6.3)
    try {
      const user = req.user as { sub?: string; id?: string; role?: string }
      const uid = user?.sub || user?.id || 'anonymous'
      extractAndSaveCrossSessionMemory({
        userId: uid, sessionId: threadId,
        userMessage: message,
        assistantResponse: report,
      })
    } catch { /* non-fatal */ }

    return reply.send(response)
  })

  // ── Agent Runtime 端点（tool_call 自主循环） ──
  app.post('/agent', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const { message, history, mode: approvalMode, model } = parsed.data
    const user = req.user as { sub?: string; id?: string; role?: string }
    const userId = user?.sub || user?.id || 'anonymous'
    const workspaceDir = '/Users/apple/Desktop/ai-workbench-v2'

    try {
      const { runOrchestrator } = await import('../core/orchestrator/index.js')
      const sessionId = crypto.randomUUID?.() || 'sess_' + Date.now()
      const result = await runOrchestrator(message, history, {
        userId,
        sessionId,
        workspaceDir,
      })

      // Audit log for agent operations
      try {
        const { audit } = await import('../core/audit.js')
        await audit.log({
          type: 'tool.exec',
          severity: result.success ? 'INFO' : 'WARN',
          action: 'chat.agent',
          user_id: userId,
          target: 'orchestrator',
          args_json: JSON.stringify({ phases: result.phases }),
          result_summary: `${result.success ? 'completed' : 'error'}`,
          duration_ms: 0,
        })
      } catch {/* audit failure is non-fatal */}

      // 跨对话记忆持久化
      if (result.success) {
        try {
          extractAndSaveCrossSessionMemory({
            userId, sessionId,
            userMessage: message,
            assistantResponse: result.response,
            toolCalls: [result.response].filter(Boolean).length > 0 ? ['agent_response'] : undefined,
          })
        } catch { /* non-fatal */ }
      }

      return reply.send({
        threadId: `th_${Date.now().toString(36)}`,
        status: result.success ? 'completed' : 'error',
        report: processReportThroughGateway(result.response || '' , userId, `th_${Date.now().toString(36)}`),
        error: result.error,
        filesWritten: result.filesWritten,
        phases: result.phases,
      })
    } catch (e: any) {
      req.log.error({ err: e.message }, 'Agent loop crashed')
      return reply.code(500).send({
        code: 'AGENT_CRASH',
        error: e.message?.slice(0, 300),
      })
    }
  })

  // ── ★ SSE 流式端点 — Agent Loop 驱动 ──
  //  POST /api/v1/chat/stream
  //  返回 text/event-stream: status/token/tool_start/tool_end/thinking/searching/done/error
  app.post('/stream', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ChatSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })

    const { message, history, mode: approvalMode, model } = parsed.data

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
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

      const user = req.user as { sub?: string; id?: string; role?: string; username?: string } | undefined
      const userId = user?.sub || user?.id || 'anonymous'
      const sessionId = crypto.randomUUID?.() || 'sess_' + Date.now()

      const harnessPrompt = await (async () => {
  const base = await buildSystemPrompt(message)
  try {
    const { buildDynamicToolOntology } = await import('../core/harness/tool-ontology.js')
    const ontology = buildDynamicToolOntology(message)
    return base.replace('{{TOOL_ONTOLOGY}}', ontology)
  } catch {
    return base.replace('{{TOOL_ONTOLOGY}}', '## TOOLS: Use function calling. Available tools listed in function definitions.')
  }
})()

      // 发送初始状态
      reply.raw.write(`event: status\ndata: ${JSON.stringify({ t: 'DaShengOS Agent 引擎启动...' })}\n\n`)

      const { runOrchestrator } = await import('../core/orchestrator/index.js')
      const rawHistory = history.slice(-50).map(h => ({ role: h.role, content: h.content }))

      const result = await runOrchestrator(message, rawHistory, {
        approvalMode: approvalMode || 'ask',
        userId,
        sessionId,
        workspaceDir: '/Users/apple/Desktop/ai-workbench-v2',
        model,
      },
        (event) => {
          if (controller.signal.aborted || reply.raw.writableEnded) return
          switch (event.type) {
            case 'status':
              reply.raw.write(`event: status\ndata: ${JSON.stringify({ t: event.text })}\n\n`); break
            case 'tool_start':
              reply.raw.write(`event: tool_start\ndata: ${JSON.stringify({ n: (event as any).name, a: (event as any).args })}\n\n`); break
            case 'tool_end':
              reply.raw.write(`event: tool_end\ndata: ${JSON.stringify({ n: (event as any).name, ok: (event as any).success, s: (event as any).summary })}\n\n`); break
            case 'tool_confirm':
              reply.raw.write(`event: tool_confirm\ndata: ${JSON.stringify({ tool: (event as any).tool, args: (event as any).args })}\n\n`); break
            case 'error':
              reply.raw.write(`event: error\ndata: ${JSON.stringify({ e: (event as any).message || event.text })}\n\n`); break
            case 'thinking':
              reply.raw.write(`event: thinking\ndata: ${JSON.stringify({ t: event.text })}\n\n`); break
            case 'searching':
              reply.raw.write(`event: searching\ndata: ${JSON.stringify({ q: (event as any).query || event.text })}\n\n`); break
          }
        },
        (token) => {
          if (!controller.signal.aborted && !reply.raw.writableEnded) {
            reply.raw.write(`event: token\ndata: ${JSON.stringify({ c: token })}\n\n`)
          }
        },
      )

      // 跨对话记忆持久化 (v6.3: 修复 toolNames 空数组 + 始终记录)
      if (result.success) {
        try {
          extractAndSaveCrossSessionMemory({
            userId, sessionId,
            userMessage: message,
            assistantResponse: result.response,
            toolCalls: [result.response].filter(Boolean).length > 0 ? ['agent_response'] : undefined,
          })
        } catch { /* non-fatal */ }
      }

      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: usage\ndata: ${JSON.stringify({ prompt: 0, completion: 0 })}\n\n`)
        reply.raw.write(`event: done\ndata: ${JSON.stringify({ finish_reason: 'stop' })}\n\n`)
        reply.raw.end()
      }
    } catch (e) {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: error\ndata: ${JSON.stringify({ e: (e as Error).message?.slice(0, 300) || '未知错误' })}\n\n`)
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
    return reply.send({ status: 'ok', version: '0.3.0', uptime: process.uptime() })
  })
  // GET /welcome — 返回可配置的欢迎语
  app.get('/welcome', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      copilot: '欢迎来到 DaShengOS 指挥中心 🧠\n\n告诉我你想做什么，我会自动调度工具和 Agent 来帮你。',
      content: 'DaShengOS · AI 全域代理工作台已就绪',
      tips: ['试试说"帮我做一份行业报告"', '上传文件让我帮你分析', '创建定时任务自动化工作'],
    })
  })

  // GET /conversations — 返回最近会话列表（轻量版，复用 sessions 表）
  app.get('/conversations', { preHandler: [app.authenticate] }, async (req, reply) => {
    const rows = sqlite
      .prepare('SELECT id, title, updated_at as updated, created_at FROM sessions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 20')
      .all(req.user!.id, 'ACTIVE')
    return reply.send({ conversations: rows })
  })

  // GET /conversations/:id — 返回单个会话详情
  app.get('/conversations/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = sqlite.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(id, req.user!.id)
    if (!session) return reply.code(404).send({ code: 'NOT_FOUND' })
    const messages = sqlite.prepare('SELECT id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 100').all(id)
    return reply.send({ ...session as any, messages })
  })


  // ★ v8.0: Multimodal chat with image upload (JSON + base64)
  app.post('/with-images', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { message?: string; images?: Array<{data: string; mimeType: string}>; history?: any[]; threadId?: string }
    const message = body.message || ''
    const images = body.images || []
    const history = body.history || []
    const clientThreadId = body.threadId
    const threadId = clientThreadId || 'th_' + Date.now().toString(36)
    if (!message && images.length === 0) {
      return reply.code(400).send({ code: 'EMPTY_REQUEST', details: 'No message or images' })
    }
    const llmMessages: Array<any> = []
    llmMessages.push({ role: 'system', content: 'You are DaShengOS, an AI assistant with vision capabilities.' })
    for (const h of history.slice(-20)) { llmMessages.push({ role: h.role, content: h.content }) }
    const userContent: Array<{type: string; text?: string; image_url?: {url: string; detail?: string}}> = []
    if (message) userContent.push({ type: 'text', text: message })
    for (const img of images) {
      const mime = img.mimeType || 'image/png'
      userContent.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + img.data, detail: 'auto' } })
    }
    llmMessages.push({ role: 'user', content: userContent })
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return reply.code(500).send({ code: 'NO_API_KEY' })
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', messages: llmMessages, max_tokens: 2048, temperature: 0.7 }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!resp.ok) { const e = await resp.text(); return reply.code(502).send({ code: 'LLM_ERROR', details: e.slice(0, 500) }) }
      const d = await resp.json() as any
      const answer = d.choices?.[0]?.message?.content || ''
      recordMetric('chat_requests_total', 1, 'counter', { mode: 'multimodal' })
      return reply.send({ threadId, status: 'completed', report: answer, sources: ['vision_llm'] })
    } catch (e: any) { return reply.code(500).send({ code: 'LLM_CALL_FAILED', details: e.message }) }
  })

  // ★ v8.0: Vision capability check
  app.get('/vision-capability', { preHandler: [app.authenticate] }, async (_req) => {
    const cap = getMultimodalCapability('openai')
    return { vision: cap.vision, audio: cap.audio, video: cap.video, maxImageSize: cap.maxImageSize, supportedFormats: cap.supportedFormats.images }
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

/** 构建 system prompt — 使用 Harness 框架动态注入 */
function buildSystemPrompt(message: string, userId?: string): string {
  try {
    let memory = null
    if (userId) {
      try {
        const { loadMemoryContext } = require('../core/harness/memory.js')
        memory = loadMemoryContext(userId)
      } catch { /* non-critical */ }
    }
    return buildSuperSystemPrompt({
      mode: 'agent',
      taskType: /报告|report|分析|行业|市场|趋势|研究/.test(message) ? 'analysis' : 'chat',
      query: message,
      memory,
      wikiPages: memory?.wikiPages?.length ? memory.wikiPages : undefined,
    })
  } catch {
    return buildLightSystemPrompt()
  }
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
            model: effectiveModel === 'deepseek-reasoner' ? 'deepseek-chat' : effectiveModel,
            messages: [
              { role: 'system', content: buildSystemPrompt(message) },
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
        const choice = data.choices?.[0]; return choice?.message?.content || choice?.message?.reasoning_content || ''
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
    ? `DaShengOS v7.0 Report Mode. Brand: 爱尤趣.\n\nSearch results:\n\n${searchContext}\n\nGenerate HTML report based on facts above. Design spec: ${htmlStyleGuide}\n\nStructure:\n- 用专业行业分析师的口吻\n- 引用具体数据来源（标注来源）\n- ${wantsHTML ? '使用 HTML 格式输出（完整的 <!DOCTYPE html>...结构）' : '使用 Markdown'}\n- ${wantsDetailed ? '3000-5000 字，包含 ≥4 个数据可视化元素' : '1500-2500 字，包含 ≥3 个数据可视化元素'}\n- 至少包含：执行摘要 / 市场规模 / 趋势 / 竞品 / 机会 / 建议 6 大块`
    : isBusinessRequest
    ? `DaShengOS v7.0 Business Report. Brand: 爱尤趣.\n\nUser query requires professional analysis. Generate HTML report. Design: ${htmlStyleGuide}\n\nStructure:\n- 用专业、客观的语调\n- ${wantsHTML ? '使用 HTML 格式输出（完整的 <!DOCTYPE html>...结构）' : '使用 Markdown'}\n- ${wantsDetailed ? '3000-5000 字，包含 ≥4 个数据可视化元素（条形图/饼图/进度条/数据卡片）' : '1500-2500 字，包含 ≥3 个数据可视化元素'}\n- 至少包含：执行摘要 / 市场规模 / 趋势 / 竞品 / 机会 / 建议 6 大块\n- 结尾给出可执行的建议清单`
    : buildSystemPrompt(message)

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
      model: effectiveModel === 'deepseek-reasoner' ? 'deepseek-chat' : effectiveModel,
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
