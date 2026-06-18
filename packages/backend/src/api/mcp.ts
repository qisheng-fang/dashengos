// packages/backend/src/api/mcp.ts · v0.3 spec §10 (5 端点)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const RegisterSchema = z.object({
  name: z.string().min(1).max(128),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  signature: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  tools_whitelist: z.array(z.string()).default([]),
})

export async function mcpRoutes(app: FastifyInstance) {
  // GET /mcp/servers
  app.get('/servers', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const db = app.sqlite as { prepare: (sql: string) => { all: () => unknown[] } }
    const rows = db.prepare('SELECT * FROM mcp_servers').all()
    return reply.send({ servers: rows })
  })

  // POST /mcp/servers (admin)
  app.post('/servers', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    return reply.code(201).send({ id: 'mcp_' + Date.now(), ...parsed.data, status: 'REGISTERED' })
  })

  // POST /mcp/servers/:id/start
  app.post('/servers/:id/start', { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send({ id: (req.params as { id: string }).id, status: 'STARTED' })
  })

  // POST /mcp/servers/:id/stop
  app.post('/servers/:id/stop', { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send({ id: (req.params as { id: string }).id, status: 'STOPPED' })
  })

  // GET /mcp/servers/:id/tools
  app.get('/servers/:id/tools', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = app.sqlite as { prepare: (sql: string) => { all: (...args: unknown[]) => unknown[] } }
    const rows = db.prepare('SELECT * FROM mcp_tools WHERE server_id = ?').all(id)
    return reply.send({ tools: rows })
  })
}
