// packages/backend/src/api/memory.ts · v0.3 Phase A.2
// 三层记忆系统 API: 列表 / 搜索 / 上下文 / 手动摘要 / 删除

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  listMemories,
  searchMemory,
  getContext,
  autoSummarize,
  createManualMemory,
  deleteMemory,
} from '../core/memory.js'

const ManualMemorySchema = z.object({
  summary: z.string().min(1).max(2000),
  keywords: z.string().min(1).max(500),
  session_id: z.string().optional(),
  importance: z.number().min(0).max(1).default(0.5),
})

const SearchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().min(1).max(50).default(10),
})

const ContextQuerySchema = z.object({
  topic: z.string().max(500).optional(),
})

export async function memoryRoutes(app: FastifyInstance) {
  // GET / — 列出当前用户所有记忆
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const memories = listMemories(req.user!.id)
    return reply.send({ memories })
  })

  // GET /search?q=xxx — 搜索记忆
  app.get('/search', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = SearchQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', errors: parsed.error.issues })
    }
    const memories = searchMemory(req.user!.id, parsed.data.q, parsed.data.limit)
    return reply.send({ memories, query: parsed.data.q })
  })

  // GET /context — 获取可注入的上下文
  app.get('/context', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ContextQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const context = getContext(req.user!.id, parsed.data.topic)
    return reply.send({ context })
  })

  // POST /summarize/:sessionId — 手动触发会话摘要
  app.post('/summarize/:sessionId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }

    // 验证会话属于当前用户
    const { sqlite } = await import('../storage/db.js')
    const session = sqlite
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, req.user!.id) as { id: string } | undefined
    if (!session) {
      return reply.code(404).send({ code: 'SESSION_NOT_FOUND' })
    }

    const memory = await autoSummarize(sessionId)
    if (!memory) {
      return reply.code(500).send({ code: 'SUMMARIZE_FAILED', message: '无法生成摘要' })
    }
    return reply.code(201).send(memory)
  })

  // POST / — 创建手动记忆
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ManualMemorySchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', errors: parsed.error.issues })
    }
    const memory = createManualMemory(
      req.user!.id,
      parsed.data.session_id ?? null,
      parsed.data.summary,
      parsed.data.keywords,
      parsed.data.importance,
    )
    return reply.code(201).send(memory)
  })

  // DELETE /:id — 删除记忆
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = deleteMemory(id, req.user!.id)
    if (!ok) {
      return reply.code(404).send({ code: 'MEMORY_NOT_FOUND' })
    }
    return reply.code(204).send()
  })
}
