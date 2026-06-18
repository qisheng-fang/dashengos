// apps/backend/src/services/deerflow/metrics.ts · v0.3 spec §37.5
// Prometheus 指标 (counters + histogram + gauge)
// 老板原则 #2: 0 行业务逻辑,薄薄一层指标收集

import { Counter, Histogram, Gauge, Registry, collectDefaultMetrics } from 'prom-client'

export const deerflowRegistry = new Registry()
collectDefaultMetrics({ register: deerflowRegistry })

// 14 RPC 方法调用计数
export const rpcCalls = new Counter({
  name: 'dasheng_deerflow_rpc_calls_total',
  help: 'Total DeerFlow RPC calls',
  labelNames: ['method', 'status'],
  registers: [deerflowRegistry],
})

// RPC 延迟直方图
export const rpcLatency = new Histogram({
  name: 'dasheng_deerflow_rpc_latency_seconds',
  help: 'DeerFlow RPC latency',
  labelNames: ['method'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [deerflowRegistry],
})

// Worker 池状态
export const poolSize = new Gauge({
  name: 'dasheng_deerflow_pool_size',
  help: 'Current DeerFlow worker pool size',
  labelNames: ['state'],
  registers: [deerflowRegistry],
})

// Sub-agent 任务
export const subAgentTasks = new Counter({
  name: 'dasheng_deerflow_subagent_tasks_total',
  help: 'Total sub-agent tasks',
  labelNames: ['agent', 'status'],
  registers: [deerflowRegistry],
})

// Token 消耗
export const tokensUsed = new Counter({
  name: 'dasheng_deerflow_tokens_total',
  help: 'Total tokens used by DeerFlow',
  labelNames: ['agent', 'type'],
  registers: [deerflowRegistry],
})

// 包装 helper
export async function instrumentCall<T>(method: string, fn: () => Promise<T>): Promise<T> {
  const end = rpcLatency.startTimer({ method })
  try {
    const result = await fn()
    rpcCalls.inc({ method, status: 'success' })
    return result
  } catch (err) {
    rpcCalls.inc({ method, status: 'error' })
    throw err
  } finally {
    end()
  }
}
