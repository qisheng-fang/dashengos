// packages/backend/src/api/transformers.ts
// DaShengOS v6.0 — Transformers API
import type { FastifyInstance } from 'fastify'
import { TRANSFORMERS_TOOLS, executeTransformersTool } from '../core/tools/transformers.js'

export async function transformersRoutes(app: FastifyInstance) {

  // GET /api/v1/transformers/tools
  app.get('/tools', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ tools: TRANSFORMERS_TOOLS })
  })

  // POST /api/v1/transformers/execute
  app.post('/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { tool, args } = req.body as { tool: string; args: Record<string, any> }
    if (!tool) return reply.code(400).send({ error: '缺少 tool 参数' })
    const result = await executeTransformersTool(tool, args || {})
    return reply.send(result)
  })

  // GET /api/v1/transformers/status
  app.get('/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    let jsAvailable = false
    let pyAvailable = false
    try {
      await import('@xenova/transformers')
      jsAvailable = true
    } catch { /* no js */ }
    try {
      const { execSync } = await import('node:child_process')
      execSync('python3 -c "import transformers; print(transformers.__version__)"', { timeout: 5000 })
      pyAvailable = true
    } catch { /* no py */ }
    return reply.send({
      jsAvailable,
      pyAvailable,
      tools: TRANSFORMERS_TOOLS.length,
      message: pyAvailable ? 'Python transformers 可用' : jsAvailable ? 'JS transformers 可用' : 'transformers 未安装'
    })
  })
}
