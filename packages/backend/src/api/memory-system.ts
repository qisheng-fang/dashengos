// DaShengOS v6.1 — 记忆系统管理 API (合并 memory.ts + memory-system.ts)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sqlite } from '../storage/db.js'
import { initMemoryTables, seedMemoryDefaults } from '../core/memory-init.js'
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

export async function memorySystemRoutes(app: FastifyInstance) {
  // == admin: 初始化记忆表 ==
  app.post('/init', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    const result = initMemoryTables()
    seedMemoryDefaults()
    return reply.send({ ok: true, ...result })
  })

  // == 记忆系统状态 ==
  app.get('/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const tables = [
      'cross_session_memory', 'memory_ledger', 'memory_embeddings',
      'dynamic_user_profiles', 'memory_summaries', 'context_compression_log',
      'orchestration_runs',
    ]
    const status: Record<string, { exists: boolean; rows: number }> = {}
    for (const table of tables) {
      try {
        const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)
        if (row) {
          const count = sqlite.prepare(`SELECT COUNT(*) as c FROM [${table}]`).get() as { c: number }
          status[table] = { exists: true, rows: count.c }
        } else { status[table] = { exists: false, rows: 0 } }
      } catch { status[table] = { exists: false, rows: 0 } }
    }
    const tablesExist = Object.values(status).filter(s => s.exists).length
    return reply.send({ tables: tables.length, tables_exist: tablesExist, healthy: tablesExist === tables.length, status })
  })

  // == 列出所有记忆 ==
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const memories = listMemories(req.user!.id)
    return reply.send({ memories })
  })

  // == 搜索记忆 ==
  app.get('/search', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = SearchQuerySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', errors: parsed.error.issues })
    const memories = searchMemory(req.user!.id, parsed.data.q, parsed.data.limit)
    return reply.send({ memories, query: parsed.data.q })
  })

  // == 获取上下文 ==
  app.get('/context', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ContextQuerySchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const context = getContext(req.user!.id, parsed.data.topic)
    return reply.send({ context })
  })

  // == 手动触发会话摘要 ==
  app.post('/summarize/:sessionId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = sqlite
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, req.user!.id) as { id: string } | undefined
    if (!session) return reply.code(404).send({ code: 'SESSION_NOT_FOUND' })
    const memory = await autoSummarize(sessionId)
    if (!memory) return reply.code(500).send({ code: 'SUMMARIZE_FAILED', message: '无法生成摘要' })
    return reply.code(201).send(memory)
  })

  // == 创建手动记忆 ==
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ManualMemorySchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED', errors: parsed.error.issues })
    const memory = createManualMemory(req.user!.id, parsed.data.session_id ?? null, parsed.data.summary, parsed.data.keywords, parsed.data.importance)
    return reply.code(201).send(memory)
  })

  // == 删除记忆 ==
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const ok = deleteMemory(id, req.user!.id)
    if (!ok) return reply.code(404).send({ code: 'MEMORY_NOT_FOUND' })
    return reply.code(204).send()
  })
}
