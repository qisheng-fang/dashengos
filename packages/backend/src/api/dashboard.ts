// DaShengOS v6.0 · Dashboard API
// 团队审计面板: 审计日志 + Cloud 会话 + 策略统计 + PR 工作流

import type { FastifyInstance } from 'fastify'
import { sqlite } from '../storage/db.js'
import { listSessions, getSession } from '../core/cloud-runner.js'
import { listSecretKeys } from '../core/secret-broker.js'

export async function dashboardRoutes(app: FastifyInstance) {

  // ─── GET /overview — 仪表盘总览 ─────────────────────

  app.get('/overview', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      // 审计日志统计
      const auditTotal = sqlite.prepare('SELECT COUNT(*) as count FROM audit_logs').get() as any
      const auditRecent = sqlite.prepare(
        'SELECT COUNT(*) as count FROM audit_logs WHERE timestamp > ?'
      ).get(Date.now() - 24 * 3600_000) as any
      const auditBySeverity = sqlite.prepare(`
        SELECT severity, COUNT(*) as count FROM audit_logs
        WHERE timestamp > ?
        GROUP BY severity ORDER BY count DESC
      `).all(Date.now() - 7 * 86400_000) as any[]

      // Cloud 会话统计
      const cloudSessions = listSessions()
      const cloudActive = cloudSessions.filter(s => s.status !== 'cleaned').length
      const cloudTotal = sqlite.prepare('SELECT COUNT(*) as count FROM cloud_sessions').get() as any

      // 策略决策统计 (从最近的审计日志分析)
      const policyStats = sqlite.prepare(`
        SELECT 
          SUM(CASE WHEN action = 'POLICY_REJECTED' THEN 1 ELSE 0 END) as rejected,
          SUM(CASE WHEN action = 'CLOUD_RUNNER_REQUIRED' THEN 1 ELSE 0 END) as cloud_routed,
          SUM(CASE WHEN action = 'tool.invoke' THEN 1 ELSE 0 END) as tool_invocations
        FROM audit_logs WHERE timestamp > ?
      `).get(Date.now() - 24 * 3600_000) as any

      // 密钥状态
      const secretKeys = listSecretKeys()

      // 工具权限统计
      const permissions = sqlite.prepare(`
        SELECT COUNT(*) as count FROM tool_permissions
        WHERE expires_at IS NULL OR expires_at > ?
      `).get(Date.now()) as any

      // Lazy table creation
    try {
      sqlite.exec(`CREATE TABLE IF NOT EXISTS cloud_sessions (
        id TEXT PRIMARY KEY, workspace TEXT, git_remote TEXT, status TEXT,
        created_at INTEGER, expires_at INTEGER
      )`)
    } catch {}

    return reply.send({
        timestamp: Date.now(),
        audit: {
          total: auditTotal?.count || 0,
          last24h: auditRecent?.count || 0,
          bySeverity: auditBySeverity || [],
        },
        cloud: {
          active: cloudActive,
          total: cloudTotal?.count || 0,
          sessions: cloudSessions.slice(0, 10).map(s => ({
            id: s.id,
            status: s.status,
            commands: s.commands.length,
            patches: s.patches.length,
            age: Date.now() - s.createdAt,
          })),
        },
        policy: {
          rejected: policyStats?.rejected || 0,
          cloudRouted: policyStats?.cloud_routed || 0,
          toolInvocations: policyStats?.tool_invocations || 0,
        },
        secrets: {
          stored: secretKeys.length,
          keys: secretKeys,
        },
        permissions: {
          active: permissions?.count || 0,
        },
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // ─── GET /audit-log — 审计日志查询 ──────────────────

  app.get('/audit-log', { preHandler: [app.authenticate] }, async (req, reply) => {
    const query = req.query as { limit?: string; severity?: string; type?: string; session?: string }
    const limit = Math.min(parseInt(query.limit || '50'), 500)
    const conditions: string[] = ['1=1']
    const params: any[] = []

    if (query.severity) {
      conditions.push('severity = ?')
      params.push(query.severity.toUpperCase())
    }
    if (query.type) {
      conditions.push('type = ?')
      params.push(query.type)
    }
    if (query.session) {
      conditions.push('session_id = ?')
      params.push(query.session)
    }

    try {
      const logs = sqlite.prepare(`
        SELECT id, timestamp, user_id, session_id, type, severity, action, target, result_summary, duration_ms
        FROM audit_logs
        WHERE ${conditions.join(' AND ')}
        ORDER BY timestamp DESC LIMIT ?
      `).all(...params, limit)

      return reply.send({
        count: (logs as any[]).length,
        limit,
        filters: { severity: query.severity, type: query.type, session: query.session },
        logs,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // ─── GET /policy-history — 策略决策历史 ─────────────

  app.get('/policy-history', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const decisions = sqlite.prepare(`
        SELECT timestamp, user_id, action, target, result_summary, duration_ms
        FROM audit_logs
        WHERE action IN ('POLICY_REJECTED', 'POLICY_APPROVAL_REQUIRED', 'CLOUD_RUNNER_REQUIRED', 'tool.invoke')
        ORDER BY timestamp DESC LIMIT 100
      `).all()

      return reply.send({
        count: (decisions as any[]).length,
        decisions,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // ─── GET /cloud-sessions — Cloud 会话列表 ───────────

  app.get('/cloud-sessions', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const sessions = listSessions()
    return reply.send({
      count: sessions.length,
      sessions: sessions.map(s => ({
        id: s.id,
        status: s.status,
        gitRemote: s.gitRemote,
        commands: s.commands.length,
        patches: s.patches.length,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        age: Date.now() - s.createdAt,
      })),
    })
  })

  // ─── POST /pr/create — 从 Cloud Session 创建 PR ────

  app.post('/pr/create', { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = req.body as { sessionId?: string; title?: string; description?: string; branch?: string }
    const sessionId = body.sessionId

    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId required' })
    }

    try {
      const { createPR } = await import('../core/pr-workflow.js')
      const result = await createPR(sessionId, {
        title: body.title || 'DaShengOS Cloud Runner PR',
        description: body.description || 'Automated changes from Cloud Runner session',
        branch: body.branch || `dasheng/cloud-runner-${sessionId.slice(-8)}`,
      })

      return reply.code(201).send(result)
    } catch (e: any) {
      return reply.code(500).send({
        code: 'PR_CREATE_FAILED',
        message: e.message,
        hint: '需要设置 GITHUB_TOKEN 环境变量或在 .env 中配置',
      })
    }
  })

  // ─── GET /pr/status/:sessionId — PR 创建状态 ────────

  app.get('/pr/status/:sessionId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }

    try {
      const session = getSession(sessionId)
      if (!session) return reply.code(404).send({ error: 'Session not found' })

      const { getDiff } = await import('../core/cloud-runner.js')
      const { diff, files } = getDiff(sessionId)

      return reply.send({
        sessionId,
        status: session.status,
        branch: `dasheng/cloud-runner-${sessionId.slice(-8)}`,
        files,
        diffSize: diff.length,
        readyForPR: files.length > 0,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // ─── GET /health — 仪表盘健康状态 (复用现有) ───────
  // (已由 healthRoutes 提供，此处为仪表盘精简版)
  app.get('/quick-health', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const { runFullHealthCheck } = await import('../core/system-health.js')
    const report = await runFullHealthCheck()
    return reply.send({
      overall: report.overall,
      score: report.score,
      failures: report.failures.map(f => ({ name: f.name, status: f.status })),
      timestamp: report.timestamp,
    })
  })
}
