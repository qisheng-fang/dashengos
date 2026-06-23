// DaShengOS v6.0 — Memory heartbeat debug endpoint
import type { FastifyInstance } from 'fastify'
import { runMemoryHealthCheck, getLastMemoryReport } from '../core/memory-heartbeat.js'

export async function memoryHeartbeatRoutes(app: FastifyInstance) {
  app.get('/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    // Force a fresh check
    const fresh = runMemoryHealthCheck()
    return reply.send({
      fresh,
      cached: getLastMemoryReport(),
    })
  })
}
