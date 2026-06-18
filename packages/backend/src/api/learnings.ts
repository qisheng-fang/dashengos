// packages/backend/src/api/learnings.ts · Phase C.1 学习记录 API
import type { FastifyInstance } from 'fastify'
import { sqlite } from '../storage/db.js'
import { reflectOnSession, getLearningStats, suggestImprovements } from '../core/self-improve.js'

export async function learningRoutes(app: FastifyInstance) {
  // GET /learnings — 列出当前用户的最近学习记录
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const rows = sqlite
      .prepare(
        `SELECT id, user_id, session_id, agent_id, task_type, reflection,
                lessons, pattern, success_rating, tokens_saved, created_at
         FROM agent_learnings
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 50`,
      )
      .all(userId) as Array<Record<string, unknown>>

    const learnings = rows.map((r) => ({
      ...r,
      lessons: JSON.parse((r.lessons as string) || '[]'),
    }))

    return reply.send({ learnings })
  })

  // GET /learnings/stats — 学习统计
  app.get('/stats', { preHandler: [app.authenticate] }, async (req, reply) => {
    const stats = await getLearningStats(req.user!.id)
    return reply.send(stats)
  })

  // GET /learnings/suggest?taskType=xxx&input=yyy — 获取改进建议
  app.get('/suggest', { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = req.query as { taskType?: string; input?: string }
    const taskType = query.taskType || 'general'
    const suggestions = await suggestImprovements(req.user!.id, taskType, query.input)
    return reply.send({ taskType, suggestions })
  })

  // POST /learnings/reflect/:sessionId — 手动触发反思
  app.post('/reflect/:sessionId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const userId = req.user!.id

    // 验证 session 属于当前用户
    const session = sqlite
      .prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId)
    if (!session) {
      return reply.code(404).send({ code: 'SESSION_NOT_FOUND' })
    }

    const entry = await reflectOnSession(sessionId)
    if (!entry) {
      return reply.code(400).send({
        code: 'REFLECTION_FAILED',
        message: '无法生成反思 (可能无用户消息或已记录)',
      })
    }

    return reply.code(201).send(entry)
  })

  // DELETE /learnings/:id — 删除学习记录
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id

    const res = sqlite
      .prepare('DELETE FROM agent_learnings WHERE id = ? AND user_id = ?')
      .run(id, userId)

    if (res.changes === 0) {
      return reply.code(404).send({ code: 'LEARNING_NOT_FOUND' })
    }

    return reply.send({ deleted: true })
  })
}
