// DaShengOS v6.0 — 系统健康检查 API
// GET /api/v1/health — 全组件状态
// GET /api/v1/health/map — 拓扑地图数据
// GET /api/v1/health/log — 最近故障日志

import type { FastifyInstance } from 'fastify'
import { runFullHealthCheck } from '../core/system-health.js'
import fs from 'node:fs'

const FAILURE_LOG_PATH = '/tmp/dasheng-failures.jsonl'

interface FailureEntry {
  time: number
  item: string
  status: string
  detail: string
  suggestion?: string
}

function appendFailureLog(entry: FailureEntry) {
  try {
    fs.appendFileSync(FAILURE_LOG_PATH, JSON.stringify(entry) + '\n')
  } catch {}
}

function readFailureLog(limit = 30): FailureEntry[] {
  try {
    if (!fs.existsSync(FAILURE_LOG_PATH)) return []
    const lines = fs.readFileSync(FAILURE_LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map(l => JSON.parse(l)).reverse()
  } catch {
    return []
  }
}

export async function healthRoutes(app: FastifyInstance) {
  // 完整健康报告
  app.get('/health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const report = await runFullHealthCheck()
      
      // 记录失败项到持久日志
      for (const item of report.failures) {
        appendFailureLog({
          time: Date.now(),
          item: item.name,
          status: item.status,
          detail: item.detail,
          suggestion: item.suggestion,
        })
      }

      return reply.send(report)
    } catch (err: any) {
      return reply.code(500).send({
        overall: 'down',
        score: 0,
        error: err.message,
        items: [],
      })
    }
  })

  // 拓扑地图数据（精简版）
  app.get('/health/map', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const report = await runFullHealthCheck()
    
    // 构建拓扑节点
    const nodes = report.items.map(item => ({
      id: item.name.replace(/[:\s]/g, '_'),
      label: item.name,
      category: item.category,
      status: item.status,
      latencyMs: item.latencyMs,
      detail: item.detail,
    }))

    // 定义连线关系
    const edges = [
      { from: '前端端口__3000', to: '后端端口__8000', label: 'API代理' },
      { from: '后端端口__8000', to: 'Auth_认证', label: 'JWT' },
      { from: '后端端口__8000', to: 'SQLite_数据库', label: '读写' },
      { from: '后端端口__8000', to: 'Redis_缓存', label: '会话' },
      { from: '后端端口__8000', to: 'DeepSeek_API', label: 'LLM调用' },
      { from: '后端端口__8000', to: '外网连通', label: 'HTTP' },
      { from: '外网连通', to: 'DNS_解析', label: '解析' },
      { from: 'DeepSeek_API', to: '外网连通', label: '依赖' },
    ]

    return reply.send({
      timestamp: report.timestamp,
      overall: report.overall,
      score: report.score,
      nodes,
      edges,
      failures: report.failures.map(f => ({ name: f.name, status: f.status, suggestion: f.suggestion })),
    })
  })

  // 故障日志
  app.get('/health/log', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const logs = readFailureLog(50)
    return reply.send({ count: logs.length, failures: logs })
  })

  // 公开的快速健康检查（无需认证）
  app.get('/health/ping', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      uptime: process.uptime(),
      pid: process.pid,
      memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    })
  })
}
