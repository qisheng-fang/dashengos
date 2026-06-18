// packages/backend/src/api/metrics.ts · v0.3 spec §19 (Prometheus /metrics)
//
// Phase 8: GET /metrics 端点 (public, 不走 rate limit)
//   Prometheus server 每 15s 抓一次, 不能被自己限流

import type { FastifyInstance } from 'fastify'
import { registry } from '../core/metrics.js'

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', { config: { rateLimit: false } }, async (_req, reply) => {
    reply.header('Content-Type', registry.contentType)
    return registry.metrics()
  })
}
