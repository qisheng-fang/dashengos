// DaShengOS v6.1 — OpenCLaw Protocol API
// Cross-platform agent communication bus (Hermes alignment)
import type { FastifyInstance } from 'fastify'
import { getOpenClawBus, KNOWN_PLATFORMS } from '../core/openclaw-protocol.js'
import type { OpenClawAddress, OpenClawPeer } from '../core/openclaw-protocol.js'

export async function openclawRoutes(app: FastifyInstance) {
  // GET /status — bus status
  app.get('/openclaw/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const bus = getOpenClawBus()
    return reply.send({
      status: 'active',
      peers: bus.listPeers().length,
      capabilities: bus.getCapabilities().length,
      platforms: Object.keys(KNOWN_PLATFORMS).length,
    })
  })

  // GET /openclaw/peers — 列出已连接的对等节点
  app.get('/openclaw/peers', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bus = getOpenClawBus()
    const { platform } = req.query as { platform?: string }
    const peers = bus.listPeers(platform ? { platform } : undefined)
    return reply.send({
      peers: peers.map(p => ({
        address: p.address,
        capabilities: p.capabilities.map(c => c.name),
        status: p.status,
        latency_ms: p.latency_ms,
        connected_at: p.connected_at,
      })),
      total: peers.length,
    })
  })

  // GET /openclaw/capabilities — 能力发现
  app.get('/openclaw/capabilities', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bus = getOpenClawBus()
    const { platform } = req.query as { platform?: string }
    const caps = bus.discoverCapabilities(platform ? { platform } : undefined)
    return reply.send({ capabilities: caps, total: caps.length })
  })

  // GET /openclaw/platforms — 已知平台
  app.get('/openclaw/platforms', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ platforms: KNOWN_PLATFORMS })
  })

  // POST /openclaw/route — 路由消息到对等节点
  app.post('/openclaw/route', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bus = getOpenClawBus()
    const { dst, method, params, auth_token } = req.body as {
      dst: OpenClawAddress
      method: string
      params: Record<string, any>
      auth_token?: string
    }
    if (!dst || !method) {
      return reply.code(400).send({ error: 'dst and method required' })
    }
    const response = await bus.route({ dst, method, params, auth_token })
    return reply.send(response)
  })

  // POST /openclaw/discover — 全局能力发现
  app.post('/openclaw/discover', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bus = getOpenClawBus()
    const { platform } = req.body as { platform?: string }
    const response = await bus.route({
      dst: { platform: platform || '*', host: '*', agent: '*' },
      method: 'discover',
      params: {},
    })
    return reply.send(response)
  })

  // POST /openclaw/broadcast — 广播消息到平台
  app.post('/openclaw/broadcast', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bus = getOpenClawBus()
    const { platform, method, params } = req.body as {
      platform: string
      method: string
      params: Record<string, any>
    }
    if (!platform || !method) {
      return reply.code(400).send({ error: 'platform and method required' })
    }
    const response = await bus.route({
      dst: { platform, host: '*', agent: '*' },
      method,
      params,
    })
    return reply.send(response)
  })
}
