// DaShengOS v6.1 — OpenCLaw Protocol Adapter
// Cross-platform agent communication bus (Hermes alignment)
// WebSocket + Unix socket transport · JSON-RPC 2.0 compatible
// Enables: agent↔agent, platform↔platform, tool↔tool routing

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

// ─── Message Types ────────────────────────────────────────

export type OpenClawTransport = 'ws' | 'unix' | 'inproc'

export interface OpenClawEnvelope {
  // JSON-RPC 2.0 compatible
  jsonrpc: '2.0'
  id: string
  // OpenClaw extensions
  claw_version: 1
  timestamp: number
  ttl: number            // hop limit (prevents infinite loops)
  // Routing
  src: OpenClawAddress    // origin
  dst: OpenClawAddress    // target (wildcard supported)
  via: string[]           // trace
  // Payload
  method: string          // action
  params: Record<string, any>
  // Security
  auth_token?: string
  signature?: string
}

export interface OpenClawAddress {
  platform: string        // 'dasheng' | 'hermes' | 'openclaw' | 'codex'
  host: string            // hostname
  agent: string           // agent ID
  capability?: string     // optional: specific capability
}

export interface OpenClawResponse {
  jsonrpc: '2.0'
  id: string
  result?: any
  error?: { code: number; message: string; data?: any }
  src: OpenClawAddress
  dst: OpenClawAddress
  via: string[]
  timestamp: number
  duration_ms: number
}

export interface OpenClawCapability {
  id: string
  name: string
  description: string
  methods: string[]
  platforms: string[]
  version: string
}

export interface OpenClawPeer {
  address: OpenClawAddress
  capabilities: OpenClawCapability[]
  connected_at: number
  last_heartbeat: number
  status: 'online' | 'degraded' | 'offline'
  latency_ms: number
}

// ─── Protocol Constants ───────────────────────────────────

export const CLAW_VERSION = 1
export const DEFAULT_TTL = 5
export const HEARTBEAT_INTERVAL_MS = 15000
export const PEER_TIMEOUT_MS = 45000
export const MAX_HOPS = 10

// Known platform routing table (Hermes-compatible)
export const KNOWN_PLATFORMS: Record<string, { name: string; description: string; capabilities: string[] }> = {
  dasheng: {
    name: 'DaShengOS',
    description: 'AI Workbench · LangGraph orchestration · Tool registry · Skill network',
    capabilities: ['chat', 'agent', 'tool', 'file', 'browser', 'sandbox', 'mcp', 'skill'],
  },
  hermes: {
    name: 'Hermes',
    description: 'Open-source agent gateway · Provider routing · Window management',
    capabilities: ['chat', 'agent', 'provider', 'window', 'oauth', 'web'],
  },
  openclaw: {
    name: 'OpenCLaw',
    description: 'Cross-platform agent protocol bridge',
    capabilities: ['relay', 'discovery', 'auth', 'translate'],
  },
  codex: {
    name: 'Codex CLI',
    description: 'OpenAI Codex terminal agent',
    capabilities: ['chat', 'code', 'shell', 'file', 'browser'],
  },
}

// ─── Message Bus ──────────────────────────────────────────

export class OpenClawBus extends EventEmitter {
  private peers = new Map<string, OpenClawPeer>()
  private pending = new Map<string, { resolve: Function; reject: Function; timer: NodeJS.Timeout }>()
  private localAddress: OpenClawAddress
  private capabilities: OpenClawCapability[] = []
  private heartbeatTimer?: NodeJS.Timeout
  private routeTable = new Map<string, OpenClawAddress[]>()

  constructor(localAddress: OpenClawAddress) {
    super()
    this.localAddress = localAddress
    this.setMaxListeners(100)
  }

  // ─── Peer management ──────────────────────────────

  registerPeer(peer: OpenClawPeer): void {
    const key = this.peerKey(peer.address)
    this.peers.set(key, peer)
    this.updateRouteTable(peer)
    this.emit('peer:joined', peer)
  }

  unregisterPeer(address: OpenClawAddress): void {
    const key = this.peerKey(address)
    this.peers.delete(key)
    this.emit('peer:left', address)
  }

  getPeer(address: OpenClawAddress): OpenClawPeer | undefined {
    return this.peers.get(this.peerKey(address))
  }

  listPeers(filter?: Partial<OpenClawAddress>): OpenClawPeer[] {
    let result = [...this.peers.values()]
    if (filter) {
      if (filter.platform) result = result.filter(p => p.address.platform === filter.platform)
      if (filter.agent) result = result.filter(p => p.address.agent === filter.agent)
      if (filter.host) result = result.filter(p => p.address.host === filter.host)
    }
    return result
  }

  // ─── Message routing ──────────────────────────────

  /**
   * Route a message through the bus.
   * Supports wildcard dst (agent: '*' → broadcast to platform)
   */
  async route(request: Omit<OpenClawEnvelope, 'id' | 'jsonrpc' | 'claw_version' | 'timestamp' | 'ttl' | 'via'>): Promise<OpenClawResponse> {
    const id = randomUUID()
    const envelope: OpenClawEnvelope = {
      jsonrpc: '2.0',
      id,
      claw_version: CLAW_VERSION,
      timestamp: Date.now(),
      ttl: DEFAULT_TTL,
      src: this.localAddress,
      dst: request.dst,
      via: [this.peerKey(this.localAddress)],
      method: request.method,
      params: request.params,
      auth_token: request.auth_token,
      signature: request.signature,
    }

    // Check TTL
    if (envelope.ttl <= 0) {
      return this.errorResponse(id, request.dst, -32001, 'TTL expired')
    }

    // Check if local
    if (this.isLocal(envelope.dst)) {
      return this.handleLocal(envelope)
    }

    // Route to peer
    const peer = this.findRoute(envelope.dst)
    if (!peer) {
      return this.errorResponse(id, envelope.dst, -32002, `No route to ${this.addrStr(envelope.dst)}`)
    }

    // Forward via bus (emit for transport layer)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        resolve(this.errorResponse(id, envelope.dst, -32003, 'Request timeout'))
      }, 30000)

      this.pending.set(id, { resolve, reject, timer: timeout })
      this.emit('message:out', envelope, peer)
    })
  }

  /**
   * Handle incoming message (called by transport layer)
   */
  async handleIncoming(envelope: OpenClawEnvelope): Promise<OpenClawResponse | void> {
    const startTime = Date.now()

    // Check if this is a response to a pending request
    if (this.pending.has(envelope.id)) {
      const pending = this.pending.get(envelope.id)!
      clearTimeout(pending.timer)
      this.pending.delete(envelope.id)
      pending.resolve({
        jsonrpc: '2.0',
        id: envelope.id,
        result: envelope.params,
        src: envelope.src,
        dst: envelope.dst,
        via: [...envelope.via, this.peerKey(this.localAddress)],
        timestamp: Date.now(),
        duration_ms: Date.now() - envelope.timestamp,
      })
      return
    }

    // Route to local handler or forward
    if (this.isLocal(envelope.dst)) {
      const response = await this.handleLocal(envelope)
      response.duration_ms = Date.now() - startTime
      return response
    }

    // Forward to next hop
    const nextPeer = this.findRoute(envelope.dst)
    if (nextPeer) {
      envelope.ttl--
      envelope.via.push(this.peerKey(this.localAddress))
      this.emit('message:out', envelope, nextPeer)
    }
  }

  // ─── Capability discovery ─────────────────────────

  registerCapability(cap: OpenClawCapability): void {
    this.capabilities.push(cap)
    this.emit('capability:registered', cap)
  }

  getCapabilities(): OpenClawCapability[] {
    return this.capabilities
  }

  discoverCapabilities(filter?: { platform?: string; capability?: string }): OpenClawCapability[] {
    let caps = this.capabilities
    const peers = this.listPeers()
    for (const peer of peers) {
      caps = caps.concat(
        peer.capabilities.map(c => ({ ...c, platforms: [peer.address.platform] }))
      )
    }
    if (filter?.platform) {
      caps = caps.filter(c => c.platforms.includes(filter.platform!))
    }
    return caps
  }

  // ─── Heartbeat ────────────────────────────────────

  startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, peer] of this.peers) {
        if (now - peer.last_heartbeat > PEER_TIMEOUT_MS) {
          peer.status = 'offline'
          this.emit('peer:offline', peer)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }
  }

  // ─── Helpers ──────────────────────────────────────

  private peerKey(addr: OpenClawAddress): string {
    return `${addr.platform}://${addr.host}/${addr.agent}`
  }

  private addrStr(addr: OpenClawAddress): string {
    return this.peerKey(addr)
  }

  private isLocal(addr: OpenClawAddress): boolean {
    return (
      addr.platform === this.localAddress.platform &&
      addr.host === this.localAddress.host &&
      (addr.agent === this.localAddress.agent || addr.agent === '*')
    )
  }

  private findRoute(addr: OpenClawAddress): OpenClawPeer | undefined {
    // Exact match
    const key = this.peerKey(addr)
    if (this.peers.has(key)) return this.peers.get(key)

    // Platform broadcast
    const wildcardKey = this.peerKey({ ...addr, agent: '*' })
    if (this.peers.has(wildcardKey)) return this.peers.get(wildcardKey)

    // Route table lookup
    const routes = this.routeTable.get(addr.platform) || []
    for (const route of routes) {
      const pk = this.peerKey(route)
      if (this.peers.has(pk)) return this.peers.get(pk)
    }

    return undefined
  }

  private updateRouteTable(peer: OpenClawPeer): void {
    const platform = peer.address.platform
    if (!this.routeTable.has(platform)) {
      this.routeTable.set(platform, [])
    }
    const routes = this.routeTable.get(platform)!
    const key = this.peerKey(peer.address)
    if (!routes.some(r => this.peerKey(r) === key)) {
      routes.push(peer.address)
    }
  }

  private async handleLocal(envelope: OpenClawEnvelope): Promise<OpenClawResponse> {
    const startTime = Date.now()
    try {
      // Emit for local handlers
      const listeners = this.listeners(`method:${envelope.method}`)
      let result: any = null

      if (listeners.length > 0) {
        const results = await Promise.all(
          listeners.map(l => (l as any)(envelope.params, envelope.src))
        )
        result = results.length === 1 ? results[0] : results
      } else if (envelope.method === 'ping') {
        result = { pong: true, timestamp: Date.now() }
      } else if (envelope.method === 'discover') {
        result = { capabilities: this.capabilities, peers: this.listPeers() }
      } else if (envelope.method === 'capabilities') {
        result = this.capabilities
      } else {
        return this.errorResponse(envelope.id, envelope.src, -32601, `Method not found: ${envelope.method}`)
      }

      return {
        jsonrpc: '2.0',
        id: envelope.id,
        result,
        src: this.localAddress,
        dst: envelope.src,
        via: [...envelope.via, this.peerKey(this.localAddress)],
        timestamp: Date.now(),
        duration_ms: Date.now() - startTime,
      }
    } catch (e: any) {
      return this.errorResponse(envelope.id, envelope.src, -32603, e.message)
    }
  }

  private errorResponse(id: string, dst: OpenClawAddress, code: number, message: string): OpenClawResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message },
      src: this.localAddress,
      dst,
      via: [],
      timestamp: Date.now(),
      duration_ms: 0,
    }
  }
}

// ─── Singleton ────────────────────────────────────────────

let defaultBus: OpenClawBus | null = null

export function getOpenClawBus(): OpenClawBus {
  if (!defaultBus) {
    const hostname = (() => {
      try { return require('node:os').hostname() } catch { return 'localhost' }
    })()
    defaultBus = new OpenClawBus({
      platform: 'dasheng',
      host: hostname,
      agent: 'omni-brain',
    })

    // Register DaShengOS capabilities
    defaultBus.registerCapability({
      id: 'dasheng-chat',
      name: 'Chat',
      description: 'LLM-powered chat with tool calling',
      methods: ['chat', 'stream', 'analyze'],
      platforms: ['dasheng', 'hermes'],
      version: '6.1.0',
    })
    defaultBus.registerCapability({
      id: 'dasheng-agent',
      name: 'Agent Orchestration',
      description: 'Multi-agent LangGraph orchestration',
      methods: ['orchestrate', 'classify', 'execute', 'status'],
      platforms: ['dasheng'],
      version: '6.1.0',
    })
    defaultBus.registerCapability({
      id: 'dasheng-tool',
      name: 'Tool Registry',
      description: 'Sandboxed tool execution + file ops + browser',
      methods: ['exec', 'read_file', 'write_file', 'browse', 'search'],
      platforms: ['dasheng', 'hermes', 'codex'],
      version: '6.1.0',
    })
    defaultBus.registerCapability({
      id: 'dasheng-skill',
      name: 'Skill Network',
      description: '126 installed skills via marketplace',
      methods: ['skill:install', 'skill:execute', 'skill:list', 'skill:search'],
      platforms: ['dasheng', 'hermes'],
      version: '6.1.0',
    })
    defaultBus.registerCapability({
      id: 'dasheng-window',
      name: 'Window Manager',
      description: 'Native macOS window control',
      methods: ['window:list', 'window:focus', 'window:move', 'window:layout'],
      platforms: ['dasheng'],
      version: '6.1.0',
    })

    defaultBus.startHeartbeat()
  }
  return defaultBus
}
