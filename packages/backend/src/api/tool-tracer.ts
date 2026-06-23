import type { FastifyInstance } from 'fastify'
import { getSessionTraces, getToolStats, replaySession } from '../core/tool-tracer.js'
import { executeToolsParallel } from '../core/tools/registry.js'

export async function toolTracerRoutes(app: FastifyInstance) {
  app.get('/traces/:sessionId', { preHandler: [app.authenticate] }, async (req) => {
    const { sessionId } = req.params as any
    return { traces: getSessionTraces(sessionId, 100) }
  })
  app.get('/stats', { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as any) || {}
    return getToolStats(q.toolName, Number(q.hoursBack) || 24)
  })
  app.post('/replay/:sessionId', { preHandler: [app.authenticate] }, async (req) => {
    const { sessionId } = req.params as any
    const executor = async (name: string, args: any) => {
      const results = await executeToolsParallel(
        [{ name, args, id: 'replay' }],
        { userId: (req.user as any)?.userId || 'system', sessionId, workspaceDir: process.cwd(), maxTimeout: 30000 },
        new Set()
      )
      const r = results.get('replay:{}') || results.entries().next().value?.[1]
      return r || { success: false, error: 'Executor failed' }
    }
    return { results: await replaySession(sessionId, executor) }
  })
}
