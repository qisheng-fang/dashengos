// packages/backend/src/api/social.ts · Track B (2026-06-15)
// 3 社媒 Agent Fastify 路由 (前缀 /api/v1/social)
//
// GET  /                    列 3 social agents
// GET  /:id                 取单个 social agent
// GET  /:id/tools           列 agent 的工具定义
// POST /:id/execute         调 agent 的 tool
// GET  /workers/health      5 worker 健康检查 (sau/douyin/wechat/video_parser/pixelle)

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSocialAgent, getSocialAgentRegistry, getSocialAgentsAsBuiltin, socialWorker } from '../agents/social/index.js'

const ExecuteSchema = z.object({
  tool: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
})

export async function socialRoutes(app: FastifyInstance) {
  // GET / — 列 3 social agents
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      agents: getSocialAgentsAsBuiltin(),
      count: Object.keys(getSocialAgentRegistry()).length,
    })
  })

  // GET /:id — 取单个 agent
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    return reply.send({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      category: agent.category,
      capabilities: agent.capabilities,
      tools: agent.tools,
    })
  })

  // GET /:id/tools — 列 agent 的工具定义
  app.get('/:id/tools', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    return reply.send({
      agent_id: agent.id,
      tools: agent.tools,
      count: agent.tools.length,
    })
  })

  // POST /:id/execute — 调 agent 的 tool
  app.post('/:id/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = ExecuteSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_FAILED',
        issues: parsed.error.issues,
      })
    }
    const agent = getSocialAgent(id)
    if (!agent) {
      return reply.code(404).send({ code: 'SOCIAL_AGENT_NOT_FOUND' })
    }
    const result = await agent.execute(parsed.data.tool, parsed.data.params)
    const status = result.ok ? 200 : 502
    return reply.code(status).send({
      agent_id: id,
      tool: parsed.data.tool,
      ...result,
    })
  })

  // GET /workers/health — 5 worker 健康检查 (debug 用, 帮老板查 worker 状态)
  app.get('/workers/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const health = await socialWorker.healthAll()
    const all_ok = Object.values(health).every((h) => h.ok)
    return reply.code(all_ok ? 200 : 503).send({
      all_ok,
      workers: health,
      timestamp: Date.now(),
    })
  })
}
