// packages/backend/src/core/agent-health.ts · DaShengOS v8.3
// Agent 健康检查 + 注册发现 — 对标 OpenClaw Agent Swarm
// 2026-06-28

import { EventEmitter } from 'node:events'
import { sqlite } from '../storage/db.js'
import { agentBus } from './agent-bus.js'

// Types
export type AgentStatus = 'online' | 'offline' | 'degraded' | 'starting' | 'error'

export interface AgentHealthRecord {
  id: string
  agentId: string
  name: string
  type: string            // 'researcher', 'writer', 'analyst', 'coder', etc.
  status: AgentStatus
  capabilities: string[]  // ['code_review', 'web_search', 'file_ops', ...]
  endpoint: string        // internal routing endpoint (e.g. 'inproc://researcher')
  lastHeartbeat: number
  registeredAt: number
  errorCount: number
  avgResponseMs: number
}

export interface HealthCheckResult {
  agentId: string
  alive: boolean
  status: AgentStatus
  latencyMs: number
  lastError?: string
  checkedAt: number
}

// Agent health registry
class AgentHealthRegistry extends EventEmitter {
  private agents = new Map<string, AgentHealthRecord>()
  private heartbeatInterval: NodeJS.Timeout | null = null
  private readonly HEARTBEAT_TIMEOUT = 30000  // 30s without heartbeat → degraded
  private readonly OFFLINE_TIMEOUT = 120000   // 2 min → offline

  // Initialize tables
  initTables(): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS agent_health (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT DEFAULT 'offline',
        capabilities TEXT DEFAULT '[]',
        endpoint TEXT DEFAULT '',
        last_heartbeat INTEGER DEFAULT 0,
        registered_at INTEGER DEFAULT (unixepoch()),
        error_count INTEGER DEFAULT 0,
        avg_response_ms REAL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_agent_health_status ON agent_health(status);
    `)
  }

  // Register an agent
  register(
    agentId: string,
    name: string,
    type: string,
    capabilities: string[] = [],
    endpoint = 'inproc://' + agentId
  ): AgentHealthRecord {
    const record: AgentHealthRecord = {
      id: 'ah_' + agentId,
      agentId, name, type,
      status: 'starting',
      capabilities,
      endpoint,
      lastHeartbeat: Date.now(),
      registeredAt: Date.now(),
      errorCount: 0,
      avgResponseMs: 0,
    }

    this.agents.set(agentId, record)

    // Persist
    sqlite.prepare(`
      INSERT OR REPLACE INTO agent_health (id, agent_id, name, type, status, capabilities, endpoint, last_heartbeat, registered_at, error_count, avg_response_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id, agentId, name, type, 'starting',
      JSON.stringify(capabilities), endpoint,
      Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000),
      0, 0
    )

    // Subscribe to heartbeat topic
    agentBus.subscribe(agentId, 'heartbeat.' + agentId, () => {
      this.heartbeat(agentId)
    })

    // Announce registration
    agentBus.publish(agentId, 'discovery.register', {
      agentId, name, type, capabilities, endpoint,
    })

    this.emit('register', record)
    return record
  }

  // Receive heartbeat
  heartbeat(agentId: string): boolean {
    const agent = this.agents.get(agentId)
    if (!agent) return false

    agent.lastHeartbeat = Date.now()
    const prevStatus = agent.status
    if (prevStatus === 'offline' || prevStatus === 'error') {
      agent.status = 'online'
      this.emit('recovery', { agentId, previousStatus: prevStatus })
    }

    // Update DB
    sqlite.prepare('UPDATE agent_health SET status = ?, last_heartbeat = ? WHERE agent_id = ?')
      .run('online', Math.floor(Date.now() / 1000), agentId)

    return true
  }

  // Mark agent as online
  setOnline(agentId: string): void {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.status = 'online'
      agent.lastHeartbeat = Date.now()
    }
  }

  // Record an error
  recordError(agentId: string, _error: string): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.errorCount++
    if (agent.errorCount >= 5) {
      agent.status = 'degraded'
    }
    if (agent.errorCount >= 10) {
      agent.status = 'error'
    }
    sqlite.prepare('UPDATE agent_health SET error_count = ?, status = ? WHERE agent_id = ?')
      .run(agent.errorCount, agent.status, agentId)
  }

  // Record response time
  recordResponse(agentId: string, latencyMs: number): void {
    const agent = this.agents.get(agentId)
    if (!agent) return
    agent.avgResponseMs = (agent.avgResponseMs * 0.7) + (latencyMs * 0.3)
  }

  // Check all agents health
  checkAll(): HealthCheckResult[] {
    const now = Date.now()
    const results: HealthCheckResult[] = []

    for (const [agentId, agent] of this.agents) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat
      let status = agent.status

      if (timeSinceHeartbeat > this.OFFLINE_TIMEOUT) {
        status = 'offline'
      } else if (timeSinceHeartbeat > this.HEARTBEAT_TIMEOUT) {
        status = 'degraded'
      }

      agent.status = status

      results.push({
        agentId,
        alive: status !== 'offline',
        status,
        latencyMs: timeSinceHeartbeat,
        checkedAt: now,
      })
    }

    return results
  }

  // Get specific agent health
  getAgent(agentId: string): AgentHealthRecord | undefined {
    return this.agents.get(agentId)
  }

  // Get all agents
  getAll(): AgentHealthRecord[] {
    return Array.from(this.agents.values())
  }

  // Get online agents with specific capability
  findCapable(capability: string): AgentHealthRecord[] {
    return Array.from(this.agents.values())
      .filter(a => a.status === 'online' && a.capabilities.includes(capability))
  }

  // Get agents by type
  getByType(type: string): AgentHealthRecord[] {
    return Array.from(this.agents.values()).filter(a => a.type === type)
  }

  // Start periodic health checks
  startHealthChecks(intervalMs = 15000): void {
    if (this.heartbeatInterval) return
    this.heartbeatInterval = setInterval(() => {
      const results = this.checkAll()
      const offline = results.filter(r => !r.alive)
      if (offline.length > 0) {
        this.emit('unhealthy', offline)
        for (const r of offline) {
          sqlite.prepare('UPDATE agent_health SET status = ? WHERE agent_id = ?')
            .run('offline', r.agentId)
        }
      }
    }, intervalMs)
  }

  // Stop health checks
  stopHealthChecks(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // Unregister agent
  unregister(agentId: string): boolean {
    const had = this.agents.delete(agentId)
    if (had) {
      agentBus.unsubscribeAgent(agentId)
      sqlite.prepare('DELETE FROM agent_health WHERE agent_id = ?').run(agentId)
      agentBus.publish('system', 'discovery.unregister', { agentId })
    }
    return had
  }

  // Get summary
  getSummary(): { total: number; online: number; degraded: number; offline: number; errors: number } {
    let online = 0, degraded = 0, offline = 0, errors = 0
    for (const agent of this.agents.values()) {
      switch (agent.status) {
        case 'online': online++; break
        case 'degraded': degraded++; break
        case 'offline': offline++; break
        case 'error': errors++; break
      }
    }
    return { total: this.agents.size, online, degraded, offline, errors }
  }

  // Load persisted agents from DB
  loadPersisted(): void {
    const rows = sqlite.prepare('SELECT * FROM agent_health').all() as any[]
    for (const row of rows) {
      this.agents.set(row.agent_id, {
        id: row.id,
        agentId: row.agent_id,
        name: row.name,
        type: row.type,
        status: 'offline',  // start offline, need re-registration
        capabilities: JSON.parse(row.capabilities || '[]'),
        endpoint: row.endpoint || 'inproc://' + row.agent_id,
        lastHeartbeat: (row.last_heartbeat || 0) * 1000,
        registeredAt: (row.registered_at || 0) * 1000,
        errorCount: row.error_count || 0,
        avgResponseMs: row.avg_response_ms || 0,
      })
    }
    console.log('[AgentHealth] Loaded ' + rows.length + ' persisted agents')
  }
}

// Global singleton
export const agentHealth = new AgentHealthRegistry()

console.log('[AgentHealth] Health registry ready')
