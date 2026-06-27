// packages/backend/src/api/langgraph.ts · DaShengOS v6.1
import type { FastifyInstance } from 'fastify'
import { LANGGRAPH_TOOLS, executeLangGraphTool } from '../core/tools/langgraph-bridge.js'
import { classifyIntent, getRoutingTable, buildOrchestrationGraph, executeGraphViaPython, renderGraphMermaid } from '../core/orchestrator/langgraph-bridge.js'


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
  // ─── Orchestrator Routes ──────────────────────────────────
  app.get('/orchestrator/routes', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ routes: getRoutingTable() })
  })

  app.post('/orchestrator/classify', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { query } = req.body as { query: string }
    if (!query) return reply.code(400).send({ error: 'query required' })
    const route = classifyIntent(query)
    return reply.send({ route })
  })

  app.post('/orchestrator/graph', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { query } = req.body as { query: string }
    if (!query) return reply.code(400).send({ error: 'query required' })
    const route = classifyIntent(query)
    if (!route) return reply.code(400).send({ error: 'Could not classify intent' })
    const graph = buildOrchestrationGraph(route)
    const mermaid = renderGraphMermaid(route)
    return reply.send({ route, graph, mermaid })
  })

  app.post('/orchestrator/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { query, sessionId } = req.body as { query: string; sessionId?: string }
    if (!query) return reply.code(400).send({ error: 'query required' })
    const route = classifyIntent(query)
    if (!route) return reply.code(400).send({ error: 'Could not classify intent' })
    const result = await executeGraphViaPython({
      query,
      sessionId: sessionId || 'default',
      route,
    })
    return reply.send(result)
  })

}
