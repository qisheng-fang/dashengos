import type { FastifyInstance } from 'fastify'
import { getRecentTraces, getTraceStats } from '../core/otel-tracer.js'
import { getRecentSignals, autoHeal } from '../core/self-heal/auto-recovery.js'

export async function otelRoutes(app: FastifyInstance) {
  app.get('/traces', { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as any) || {}
    return { traces: getRecentTraces(Number(q.limit) || 50) }
  })
  app.get('/stats', { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as any) || {}
    return getTraceStats(Number(q.hoursBack) || 1)
  })
  app.get('/signals', { preHandler: [app.authenticate] }, async (req) => {
    const q = (req.query as any) || {}
    return { signals: getRecentSignals(q.category, Number(q.minutesBack) || 5) }
  })
  app.post('/auto-heal', { preHandler: [app.authenticate] }, async (req) => {
    const { sessionId } = (req.body as any) || {}
    return autoHeal(sessionId || 'unknown')
  })
}
