// packages/backend/src/api/mcp.ts · DaShengOS v0.3.1 MCP API
// 5 端点: 服务器注册/管理 + 工具查询 + 生命周期

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { sqlite } from '../storage/db.js'
import { startMCPServer, stopMCPServer, getMCPHealthStatus, startMCPHeartbeat, stopMCPHeartbeat } from '../core/mcp-client.js'

const RegisterSchema = z.object({
  name: z.string().min(1).max(128),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
})

export async function mcpRoutes(app: FastifyInstance) {
  // GET /servers — 列出所有已注册 MCP 服务器
  app.get('/servers', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const rows = sqlite.prepare(
        'SELECT id, name, command, args_json, status, last_health_check, created_at FROM mcp_servers ORDER BY created_at DESC'
      ).all()
      return reply.send({ servers: rows })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // POST /servers — 注册新 MCP 服务器 (admin)
  app.post('/servers', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const parsed = RegisterSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }

    const { name, command, args, env } = parsed.data
    const id = `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    try {
      sqlite.prepare(
        `INSERT INTO mcp_servers (id, name, command, args_json, env_json, signature_sha256, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'REGISTERED', ?)`
      ).run(id, name, command, JSON.stringify(args), env ? JSON.stringify(env) : null, 'sha256:placeholder', now)

      return reply.code(201).send({
        id,
        name,
        command,
        args,
        env: env || {},
        status: 'REGISTERED',
        created_at: now,
      })
    } catch (e: any) {
      return reply.code(409).send({ error: `Server already exists or DB error: ${e.message}` })
    }
  })

  // POST /servers/:id/start — 启动 MCP 服务器
  app.post('/servers/:id/start', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    try {
      const server = sqlite.prepare(
        'SELECT id, name, command, args_json, env_json FROM mcp_servers WHERE id = ?'
      ).get(id) as { id: string; name: string; command: string; args_json: string; env_json: string | null } | undefined

      if (!server) {
        return reply.code(404).send({ error: 'Server not found' })
      }

      const result = await startMCPServer({
        id: server.id,
        name: server.name,
        command: server.command,
        args: JSON.parse(server.args_json),
        env: server.env_json ? JSON.parse(server.env_json) : undefined,
      })

      return reply.send({
        id,
        status: result.success ? 'STARTED' : 'ERRORED',
        tools_count: result.tools.length,
        tools: result.tools.map(t => t.name),
        error: result.error,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // POST /servers/:id/stop — 停止 MCP 服务器
  app.post('/servers/:id/stop', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    try {
      await stopMCPServer(id)
      return reply.send({ id, status: 'STOPPED' })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // GET /servers/:id/tools — 获取 MCP 服务器的工具列表
  app.get('/servers/:id/tools', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    try {
      const tools = sqlite.prepare(
        'SELECT id, name, description, risk_level FROM mcp_tools WHERE server_id = ? AND enabled = 1'
      ).all(id)
      return reply.send({ server_id: id, tools })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // GET /tools — 列出所有已注册的 MCP 工具（全局视图）
  app.get('/tools', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const tools = sqlite.prepare(
        `SELECT t.id, t.name, t.description, t.risk_level, t.server_id, s.name as server_name
         FROM mcp_tools t JOIN mcp_servers s ON t.server_id = s.id
         WHERE t.enabled = 1 AND s.status = 'STARTED'
         ORDER BY t.name`
      ).all()
      return reply.send({ tools })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // GET /health — MCP 服务器实时健康状态
  app.get('/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const servers = getMCPHealthStatus()
      const online = servers.filter(s => s.online).length
      const total = servers.length
      return reply.send({
        status: online === total ? 'healthy' : online > 0 ? 'degraded' : 'offline',
        online,
        total,
        servers,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // POST /heartbeat/start — 启动心跳检测
  app.post('/heartbeat/start', { preHandler: [app.authenticate] }, async (_req, reply) => {
    startMCPHeartbeat()
    return reply.send({ heartbeat: 'started', interval: '30s' })
  })

  // POST /heartbeat/stop — 停止心跳检测
  app.post('/heartbeat/stop', { preHandler: [app.authenticate] }, async (_req, reply) => {
    stopMCPHeartbeat()
    return reply.send({ heartbeat: 'stopped' })
  })
}
