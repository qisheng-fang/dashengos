// packages/backend/src/api/langgraph.ts · DaShengOS v6.0
import type { FastifyInstance } from 'fastify'
import { LANGGRAPH_TOOLS, executeLangGraphTool } from '../core/tools/langgraph-bridge.js'

export async function langgraphRoutes(app: FastifyInstance) {
  app.get('/tools', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ tools: LANGGRAPH_TOOLS })
  })
  app.get('/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    let installed = false
    try {
      const { execSync } = await import('node:child_process')
      execSync('python3 -c "import langgraph"', { timeout: 5000 })
      installed = true
    } catch {}
    return reply.send({ installed, tools: LANGGRAPH_TOOLS.length })
  })
  app.post('/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { tool, args } = req.body as { tool: string; args: Record<string, any> }
    return reply.send(await executeLangGraphTool(tool, args || {}))
  })
}
