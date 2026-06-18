// apps/backend/src/services/deerflow/worker-pool.ts · v0.3 spec §37.2
// TypeScript 端 Worker 池 (Phase 3 简化: 1 个进程足够,
// 真生产用 K8s HPA 扩缩容)
//
// 老板原则 #2: 0 行业务逻辑,薄薄一层资源管理
// 真生产扩多副本: §37.4 K8s HPA

import { spawn, ChildProcess } from 'node:child_process'
import { logger } from '../../core/logger.js'

export interface WorkerPoolConfig {
  /** daemon 命令 (默认: python -m deerflow.daemon) */
  cmd: string[]
  /** 预热 worker 数 (Phase 3 简化: 1) */
  minSize: number
  /** 最大 worker 数 (Phase 3 简化: 1) */
  maxSize: number
  /** 空闲超时 ms (默认 60s) */
  idleTimeoutMs: number
  /** 启动超时 ms (默认 10s) */
  startupTimeoutMs: number
}

const DEFAULT_CONFIG: WorkerPoolConfig = {
  cmd: (process.env.DEERFLOW_DAEMON_CMD || 'python3 -m deerflow.daemon').split(' '),
  minSize: 1,
  maxSize: parseInt(process.env.DEERFLOW_MAX_WORKERS || '1', 10),
  idleTimeoutMs: 60_000,
  startupTimeoutMs: 10_000,
}

interface Worker {
  id: string
  proc: ChildProcess
  busy: boolean
  lastUsed: number
}

export class DeerFlowWorkerPool {
  private workers: Worker[] = []
  private waiting: ((w: Worker) => void)[] = []
  private reapTimer: NodeJS.Timeout | null = null

  constructor(private config: WorkerPoolConfig = DEFAULT_CONFIG) {
    this.preheat()
    this.startReaper()
  }

  private preheat() {
    for (let i = 0; i < this.config.minSize; i++) {
      this.spawnWorker()
    }
  }

  private spawnWorker(): Worker {
    const id = `deerflow-worker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    logger.info({ id, cmd: this.config.cmd }, 'spawning deerflow worker')
    const proc = spawn(this.config.cmd[0], this.config.cmd.slice(1), {
      env: { ...process.env, DEERFLOW_WORKER_ID: id },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const w: Worker = { id, proc, busy: false, lastUsed: Date.now() }
    proc.once('exit', (code) => this.handleExit(w, code))
    proc.stdout?.on('data', (d) => logger.debug({ id }, d.toString().trim()))
    proc.stderr?.on('data', (d) => logger.warn({ id, err: d.toString().trim() }))
    this.workers.push(w)
    return w
  }

  acquire(): Promise<Worker> {
    // Phase 3 简化: 1 worker 串行,后续 P3.10 扩真池
    const idle = this.workers.find((w) => !w.busy)
    if (idle) {
      idle.busy = true
      idle.lastUsed = Date.now()
      return Promise.resolve(idle)
    }
    if (this.workers.length < this.config.maxSize) {
      const w = this.spawnWorker()
      w.busy = true
      w.lastUsed = Date.now()
      return Promise.resolve(w)
    }
    return new Promise((resolve) => this.waiting.push(resolve))
  }

  release(worker: Worker) {
    worker.busy = false
    worker.lastUsed = Date.now()
    const next = this.waiting.shift()
    if (next) {
      next(worker)
      worker.busy = true
    }
  }

  private startReaper() {
    this.reapTimer = setInterval(() => {
      const now = Date.now()
      for (const w of [...this.workers]) {
        if (!w.busy && now - w.lastUsed > this.config.idleTimeoutMs && this.workers.length > this.config.minSize) {
          logger.info({ id: w.id }, 'reaping idle worker')
          w.proc.kill('SIGTERM')
          this.workers = this.workers.filter((x) => x !== w)
        }
      }
    }, 30_000)
  }

  private handleExit(worker: Worker, code: number | null) {
    logger.warn({ id: worker.id, code }, 'deerflow worker exited')
    this.workers = this.workers.filter((w) => w !== worker)
    // 自动重启到 minSize
    if (this.workers.length < this.config.minSize) {
      this.spawnWorker()
    }
  }

  get stats() {
    return {
      total: this.workers.length,
      busy: this.workers.filter((w) => w.busy).length,
      idle: this.workers.filter((w) => !w.busy).length,
      waiting: this.waiting.length,
    }
  }

  async shutdown() {
    if (this.reapTimer) clearInterval(this.reapTimer)
    for (const w of this.workers) {
      w.proc.kill('SIGTERM')
    }
    await Promise.all(this.workers.map((w) => new Promise<void>((resolve) => w.proc.once('exit', () => resolve()))))
    this.workers = []
  }
}

let _pool: DeerFlowWorkerPool | null = null
export function getDeerFlowPool(): DeerFlowWorkerPool {
  if (!_pool) _pool = new DeerFlowWorkerPool()
  return _pool
}
