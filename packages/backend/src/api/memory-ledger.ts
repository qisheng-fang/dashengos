import type { FastifyInstance } from 'fastify'
import { getLedgerHistory, queryMemoryView, runMemoryMaintenance } from '../core/memory-ledger.js'

export async function memoryLedgerRoutes(app: FastifyInstance) {
  app.get('/ledger', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = req.user as any
    return { entries: getLedgerHistory(userId, 50) }
  })
  app.get('/view', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = req.user as any
    const q = (req.query as any) || {}
    return { results: queryMemoryView({ userId, dimensions: ['recency', 'importance'], limit: 10, ...q }) }
  })
  app.post('/maintenance', { preHandler: [app.authenticate] }, async (req) => {
    const { userId } = req.user as any
    return runMemoryMaintenance(userId)
  })
}
