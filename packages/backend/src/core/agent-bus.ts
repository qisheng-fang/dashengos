// packages/backend/src/core/agent-bus.ts · DaShengOS v8.3
// Agent 间消息总线 — pub/sub + direct RPC
// 对标 OpenClaw Agent Swarm 通信层
// 2026-06-28

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

// Types
export type BusMessageType = 'task' | 'result' | 'status' | 'error' | 'heartbeat' | 'discovery'

export interface BusMessage {
  id: string
  type: BusMessageType
  source: string           // agent ID
  target: string | '*'     // agent ID or '*' for broadcast
  topic: string            // e.g. 'task.analysis', 'result.code_review'
  payload: Record<string, unknown>
  timestamp: number
  ttl: number              // milliseconds, 0 = no expiry
  correlationId?: string   // for request-response pairing
}

export interface BusSubscription {
  id: string
  agentId: string
  topic: string            // can be 'task.*' or exact
  handler: (msg: BusMessage) => Promise<void> | void
  filter?: (msg: BusMessage) => boolean
}

export interface BusStats {
  messagesSent: number
  messagesReceived: number
  activeSubscriptions: number
  activeAgents: Set<string>
  pendingRequests: number
}

// Message bus singleton
class AgentBus extends EventEmitter {
  private subscriptions = new Map<string, BusSubscription[]>()
  private pendingRequests = new Map<string, {
    resolve: (msg: BusMessage) => void
    reject: (err: Error) => void
    timer: NodeJS.Timeout
  }>()
  private messageHistory: BusMessage[] = []
  private stats: BusStats = {
    messagesSent: 0, messagesReceived: 0, activeSubscriptions: 0,
    activeAgents: new Set(), pendingRequests: 0,
  }

  // Publish message to topic
  publish(
    source: string,
    topic: string,
    payload: Record<string, unknown>,
    target: string = '*',
    ttl = 30000
  ): string {
    const msg: BusMessage = {
      id: 'msg_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 8),
      type: this.inferType(topic),
      source, target, topic, payload,
      timestamp: Date.now(), ttl,
    }

    this.stats.messagesSent++
    this.messageHistory.push(msg)
    if (this.messageHistory.length > 1000) this.messageHistory.shift()

    // Deliver to matching subscriptions
    this.deliver(msg)

    // Emit for logging/monitoring
    this.emit('message', msg)
    this.emit('topic:' + topic, msg)

    return msg.id
  }

  // Direct RPC: send and wait for response
  async request(
    source: string,
    target: string,
    topic: string,
    payload: Record<string, unknown>,
    timeoutMs = 30000
  ): Promise<BusMessage> {
    const msg: BusMessage = {
      id: 'req_' + Date.now().toString(36) + '_' + randomUUID().slice(0, 8),
      type: 'task', source, target, topic, payload,
      timestamp: Date.now(), ttl: timeoutMs,
    }

    this.stats.messagesSent++
    this.stats.pendingRequests++

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msg.id)
        this.stats.pendingRequests--
        reject(new Error('Request timeout: ' + topic + ' → ' + target))
      }, timeoutMs)

      this.pendingRequests.set(msg.id, { resolve, reject, timer })
      this.deliver(msg)
    })
  }

  // Respond to a request
  respond(requestId: string, source: string, topic: string, payload: Record<string, unknown>): boolean {
    const pending = this.pendingRequests.get(requestId)
    if (!pending) return false

    clearTimeout(pending.timer)
    this.pendingRequests.delete(requestId)
    this.stats.pendingRequests--

    const msg: BusMessage = {
      id: 'rsp_' + Date.now().toString(36),
      type: 'result', source, target: '*', topic,
      payload, timestamp: Date.now(), ttl: 0,
      correlationId: requestId,
    }
    this.stats.messagesReceived++
    pending.resolve(msg)
    return true
  }

  // Subscribe to topic (supports wildcards: 'task.*')
  subscribe(
    agentId: string,
    topic: string,
    handler: (msg: BusMessage) => Promise<void> | void,
    filter?: (msg: BusMessage) => boolean
  ): string {
    const sub: BusSubscription = {
      id: 'sub_' + Date.now().toString(36),
      agentId, topic, handler, filter,
    }

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, [])
    }
    this.subscriptions.get(topic)!.push(sub)
    this.stats.activeSubscriptions++
    this.stats.activeAgents.add(agentId)

    this.emit('subscribe', { agentId, topic })
    return sub.id
  }

  // Unsubscribe
  unsubscribe(subscriptionId: string): boolean {
    for (const [topic, subs] of this.subscriptions) {
      const idx = subs.findIndex(s => s.id === subscriptionId)
      if (idx >= 0) {
        subs.splice(idx, 1)
        this.stats.activeSubscriptions--
        if (subs.length === 0) this.subscriptions.delete(topic)
        return true
      }
    }
    return false
  }

  // Unsubscribe all for an agent
  unsubscribeAgent(agentId: string): number {
    let count = 0
    for (const [topic, subs] of this.subscriptions) {
      const before = subs.length
      const filtered = subs.filter(s => s.agentId !== agentId)
      count += before - filtered.length
      if (filtered.length === 0) this.subscriptions.delete(topic)
      else this.subscriptions.set(topic, filtered)
    }
    this.stats.activeSubscriptions -= count
    this.stats.activeAgents.delete(agentId)
    return count
  }

  // Get stats
  getStats(): BusStats {
    return { ...this.stats, activeAgents: new Set(this.stats.activeAgents) }
  }

  // Get recent messages for a topic
  getHistory(topic?: string, limit = 50): BusMessage[] {
    let msgs = this.messageHistory
    if (topic) msgs = msgs.filter(m => m.topic === topic)
    return msgs.slice(-limit)
  }

  // Internal delivery
  private deliver(msg: BusMessage): number {
    let count = 0
    for (const [topicPattern, subs] of this.subscriptions) {
      if (!this.topicMatches(msg.topic, topicPattern)) continue

      for (const sub of subs) {
        if (msg.target !== '*' && msg.target !== sub.agentId) continue
        if (sub.filter && !sub.filter(msg)) continue

        try {
          const result = sub.handler(msg)
          if (result instanceof Promise) {
            result.catch(err => this.emit('error', { msg, error: err }))
          }
          count++
          this.stats.messagesReceived++
        } catch (err) {
          this.emit('error', { msg, error: err })
        }
      }
    }
    return count
  }

  // Wildcard matching: 'task.analysis' matches 'task.*' or 'task.analysis'
  private topicMatches(topic: string, pattern: string): boolean {
    if (pattern === '*') return true
    if (pattern === topic) return true
    if (pattern.endsWith('.*')) {
      return topic.startsWith(pattern.slice(0, -2))
    }
    return false
  }

  // Infer message type from topic
  private inferType(topic: string): BusMessageType {
    if (topic.startsWith('task.')) return 'task'
    if (topic.startsWith('result.')) return 'result'
    if (topic.startsWith('status.')) return 'status'
    if (topic.startsWith('heartbeat.')) return 'heartbeat'
    if (topic.startsWith('discovery.')) return 'discovery'
    return 'task'
  }

  // Reset (for testing)
  reset(): void {
    this.subscriptions.clear()
    this.pendingRequests.clear()
    this.messageHistory = []
    this.stats = {
      messagesSent: 0, messagesReceived: 0, activeSubscriptions: 0,
      activeAgents: new Set(), pendingRequests: 0,
    }
    this.removeAllListeners()
  }
}

// Global singleton
export const agentBus = new AgentBus()

// Convenience helpers
export function publishTask(source: string, task: string, payload: Record<string, unknown>, target = '*'): string {
  return agentBus.publish(source, 'task.' + task, payload, target)
}

export function broadcastStatus(source: string, status: string, detail = ''): string {
  return agentBus.publish(source, 'status.' + status, { status, detail, agent: source, timestamp: Date.now() })
}

export function requestResult(source: string, target: string, task: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<BusMessage> {
  return agentBus.request(source, target, 'task.' + task, payload, timeoutMs)
}

console.log('[AgentBus] Message bus ready (pub/sub + RPC)')
