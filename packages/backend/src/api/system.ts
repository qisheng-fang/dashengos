// DaShengOS v6.1 — 系统管理 API
// D1: 状态条 + 重启系统 + 配置热重载

import type { FastifyInstance } from 'fastify'
import { execSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { loadConfig, getConfig } from '../core/config-loader.js'
import { runIntegrityCheck } from '../core/integrity-guard.js'

export async function systemRoutes(app: FastifyInstance) {
  // ─── 系统状态（合并到现有 /api/status，这里只加扩展字段）───
  app.get('/info', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const config = getConfig()
    const uptime = process.uptime()
    const mem = process.memoryUsage()

    return reply.send({
      version: config.app.version,
      uptime_sec: Math.round(uptime),
      uptime_human: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory: {
        rss_mb: Math.round(mem.rss / 1024 / 1024),
        heap_mb: Math.round(mem.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      },
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      config_loaded: !!getConfig(),
      integrity_ok: runIntegrityCheck().ok,
    })
  })


  // ─── 配置热重载 ─────────────────────────────────────────
  app.post('/reload-config', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    try {
      const newConfig = loadConfig()
      return reply.send({
        ok: true,
        message: '配置已重新加载',
        version: newConfig.app.version,
        providers: newConfig.llm.defaultProvider,
      })
    } catch (e: any) {
      return reply.code(500).send({ ok: false, error: e.message })
    }
  })

  // ─── 查看当前配置 ───────────────────────────────────────
  app.get('/config', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const config = getConfig()
    // 返回脱敏版本（不暴露密钥）
    return reply.send({
      app: config.app,
      llm: {
        defaultProvider: config.llm.defaultProvider,
        defaultModel: config.llm.defaultModel,
        fallbackProvider: config.llm.fallbackProvider,
        contextCompressThreshold: config.llm.contextCompressThreshold,
      },
      mcp: config.mcp,
      backup: config.backup,
      security: {
        jwtAccessTtlSec: config.security.jwtAccessTtlSec,
        rateLimitPerMinute: config.security.rateLimitPerMinute,
      },
      orchestrator: config.orchestrator,
    })
  })

  // ─── 完整性检查 ─────────────────────────────────────────
  app.get('/integrity', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const result = runIntegrityCheck()
    return reply.send(result)
  })
}
