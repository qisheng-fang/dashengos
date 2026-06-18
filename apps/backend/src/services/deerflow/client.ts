// apps/backend/src/services/deerflow/client.ts · v0.3 spec §35.3
// TypeScript 端 JSON-RPC over Unix socket 客户端
// 老板原则 #2: 0 行业务逻辑,薄薄一层协议适配
// 自动重连 + 14 RPC 方法类型化

import { Socket } from 'node:net'
import { connect } from 'node:net'
import { createInterface } from 'node:readline'
import { logger } from '../../core/logger.js'

const SOCKET_PATH = process.env.DEERFLOW_SOCKET_PATH || '/tmp/dasheng/deerflow.sock'
const RECONNECT_DELAY_MS = 1000
const REQUEST_TIMEOUT_MS = 30_000

export interface ResearchParams {
  taskId?: string
  query: string
  subAgents?: string[]
  maxSteps?: number
}
export interface ResearchResult {
  taskId: string
  status: string
}

type RpcHandler = (params: any) => Promise<any>

export class DeerFlowClient {
  private socket: Socket | null = null
  private handlers = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private nextId = 1
  private connected = false
  private connecting: Promise<void> | null = null
  private writer: any = null

  async connect(): Promise<void> {
    if (this.connected) return
    if (this.connecting) return this.connecting
    this.connecting = this._connect()
    return this.connecting
  }

  private async _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect({ path: SOCKET_PATH })
      this.socket = sock
      sock.once('connect', () => {
        this.connected = true
        this.writer = sock
        this.connecting = null
        logger.info({ path: SOCKET_PATH }, 'deerflow connected')
        resolve()
      })
      sock.once('error', (err) => {
        this.connected = false
        this.connecting = null
        logger.error({ err: err.message }, 'deerflow connect failed')
        reject(err)
        // 1s 后重试
        setTimeout(() => this._connect().catch(() => {}), RECONNECT_DELAY_MS)
      })
      sock.on('close', () => {
        this.connected = false
        this.connecting = null
        setTimeout(() => this._connect().catch(() => {}), RECONNECT_DELAY_MS)
      })
      const rl = createInterface({ input: sock })
      rl.on('line', (line) => {
        try {
          const resp = JSON.parse(line)
          const h = this.handlers.get(resp.id)
          if (h) {
            this.handlers.delete(resp.id)
            if (resp.error) h.reject(new Error(`${resp.error.code}: ${resp.error.message}`))
            else h.resolve(resp.result)
          }
        } catch (e) {
          logger.error({ line, err: (e as Error).message }, 'invalid JSON-RPC response')
        }
      })
    })
  }

  async request(method: string, params: Record<string, any> = {}): Promise<any> {
    if (!this.connected) await this.connect()
    const id = this.nextId++
    const req = { jsonrpc: '2.0', id, method, params }
    return new Promise<any>((resolve, reject) => {
      this.handlers.set(id, { resolve, reject })
      const timeout = setTimeout(() => {
        this.handlers.delete(id)
        reject(new Error(`DeerFlow RPC timeout: ${method}`))
      }, REQUEST_TIMEOUT_MS)
      this.writer.write(JSON.stringify(req) + '\n')
      // wrap resolve to clear timeout
      const origResolve = resolve
      const origReject = reject
      this.handlers.set(id, {
        resolve: (v) => { clearTimeout(timeout); origResolve(v) },
        reject: (e) => { clearTimeout(timeout); origReject(e) },
      })
    })
  }

  // ---- 14 个 typed 包装 (spec §35.4) ----
  async healthPing() {
    return this.request('health.ping')
  }
  async researchRun(p: ResearchParams): Promise<ResearchResult> {
    return this.request('research.run', p)
  }
  async researchCancel(taskId: string) {
    return this.request('research.cancel', { taskId })
  }
  async researchStatus(taskId: string) {
    return this.request('research.status', { taskId })
  }
  async researchResult(taskId: string) {
    return this.request('research.result', { taskId })
  }
  async researchStream(taskId: string) {
    return this.request('research.stream', { taskId })
  }
  async agentList() {
    return this.request('agent.list')
  }
  async agentRun(agentId: string, input: string, context: any = {}) {
    return this.request('agent.run', { agentId, input, context })
  }
  async skillList(category?: string) {
    return this.request('skill.list', { category })
  }
  async skillLoad(skillId: string) {
    return this.request('skill.load', { skillId })
  }
  async sandboxExec(code: string, lang = 'python', timeoutMs = 60_000) {
    return this.request('sandbox.exec', { code, lang, timeout: timeoutMs })
  }
  async browserNavigate(url: string, action?: string) {
    return this.request('browser.navigate', { url, action })
  }
  async browserExtract(url: string, selector?: string) {
    return this.request('browser.extract', { url, selector })
  }
  async fileRead(path: string) {
    return this.request('file.read', { path })
  }
  async fileWrite(path: string, content: string) {
    return this.request('file.write', { path, content })
  }
  async auditWrite(level: string, type: string, payload: any) {
    return this.request('audit.write', { level, type, payload })
  }
  async secretRead(name: string) {
    return this.request('secret.read', { name })
  }
  async secretList() {
    return this.request('secret.list')
  }

  async close() {
    if (this.socket) this.socket.destroy()
    this.connected = false
  }
}

// 全局单例
let _client: DeerFlowClient | null = null
export function getDeerFlowClient(): DeerFlowClient {
  if (!_client) _client = new DeerFlowClient()
  return _client
}
