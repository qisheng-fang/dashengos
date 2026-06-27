// DaShengOS v6.0 · Cloud Runner API
// REST 端点: session CRUD + 命令执行 + patch + diff

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createSession,
  executeCommand,
  applyPatch,
  getDiff,
  cleanupSession,
  listSessions,
  getSession,
} from '../core/cloud-runner.js'

// ─── Schemas ──────────────────────────────────────────────

const CreateSessionSchema = z.object({
  gitRemote: z.string().optional(),
  baseBranch: z.string().optional(),
  localWorkspace: z.string().optional(),
})

const ExecuteCommandSchema = z.object({
  toolId: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  networkPolicy: z.enum(['blocked', 'whitelist']).default('blocked'),
  allowedDomains: z.array(z.string()).default([]),
})

const ApplyPatchSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  reason: z.string().optional(),
})

// ─── Routes ───────────────────────────────────────────────

export async function cloudRunnerRoutes(app: FastifyInstance) {

  // POST /sessions — 创建隔离执行会话
  app.post('/sessions', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }

    try {
      const session = createSession(parsed.data)
      return reply.code(201).send({
        sessionId: session.id,
        workspace: session.workspace,
        status: session.status,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      })
    } catch (e: any) {
      return reply.code(500).send({ error: e.message })
    }
  })

  // GET /sessions — 列出所有活跃会话
  app.get('/sessions', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const sessions = listSessions().map(s => ({
      id: s.id,
      workspace: s.workspace,
      status: s.status,
      commandCount: s.commands.length,
      patchCount: s.patches.length,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }))
    return reply.send({ sessions, count: sessions.length })
  })

  // GET /sessions/:id — 获取会话详情
  app.get('/sessions/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = getSession(id)
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' })
    }
    return reply.send({
      id: session.id,
      workspace: session.workspace,
      status: session.status,
      gitRemote: session.gitRemote,
      commands: session.commands.map(c => ({
        id: c.id,
        toolId: c.toolId,
        status: c.status,
        networkPolicy: c.networkPolicy,
        result: c.result ? {
          exitCode: c.result.exitCode,
          stdout: c.result.stdout?.slice(0, 2000),
          stderr: c.result.stderr?.slice(0, 500),
          durationMs: c.result.durationMs,
        } : null,
      })),
      patches: session.patches.map(p => ({
        path: p.path,
        reason: p.reason,
        size: p.content.length,
      })),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    })
  })

  // POST /sessions/:id/execute — 在隔离工作区执行命令
  app.post('/sessions/:id/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = ExecuteCommandSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }

    try {
      const result = await executeCommand(
        id, parsed.data.toolId, parsed.data.params,
        parsed.data.networkPolicy, parsed.data.allowedDomains,
      )
      return reply.send({
        commandId: result.id,
        status: result.status,
        result: result.result ? {
          exitCode: result.result.exitCode,
          stdout: result.result.stdout?.slice(0, 5000),
          stderr: result.result.stderr?.slice(0, 2000),
          durationMs: result.result.durationMs,
          timedOut: result.result.timedOut,
        } : null,
      })
    } catch (e: any) {
      return reply.code(e.message.includes('not found') ? 404 : 500).send({ error: e.message })
    }
  })

  // POST /sessions/:id/patch — 向会话工作区应用 patch
  app.post('/sessions/:id/patch', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = ApplyPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }

    try {
      const patch = applyPatch(id, parsed.data.path, parsed.data.content, parsed.data.reason)
      return reply.code(201).send({
        path: patch.path,
        reason: patch.reason,
        size: patch.content.length,
      })
    } catch (e: any) {
      return reply.code(e.message.includes('not found') ? 404 : 500).send({ error: e.message })
    }
  })

  // GET /sessions/:id/diff — 获取工作区变更 diff
  app.get('/sessions/:id/diff', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    try {
      const { diff, files } = getDiff(id)
      return reply.send({
        sessionId: id,
        files,
        diff,
        modifiedCount: files.length,
      })
    } catch (e: any) {
      return reply.code(e.message.includes('not found') ? 404 : 500).send({ error: e.message })
    }
  })

  // DELETE /sessions/:id — 清理并销毁会话
  app.delete('/sessions/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }

    const ok = cleanupSession(id)
    if (!ok) {
      return reply.code(404).send({ error: 'Session not found or already cleaned' })
    }
    return reply.send({ sessionId: id, status: 'cleaned' })
  })

  // POST /sessions/:id/complete — 完成会话并返回最终结果
  app.post('/sessions/:id/complete', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const session = getSession(id)
    if (!session) return reply.code(404).send({ error: 'Session not found' })

    const { diff, files } = getDiff(id)

    session.status = 'completed'
    try {
      const { sqlite } = await import('../storage/db.js')
      sqlite.prepare(`UPDATE cloud_sessions SET status = 'completed' WHERE id = ?`).run(id)
    } catch { /* ok */ }

    return reply.send({
      sessionId: id,
      status: session.status,
      commands: session.commands.length,
      patches: session.patches.length,
      modifiedFiles: files,
      diff: diff.slice(0, 10000),
      durationMs: Date.now() - session.createdAt,
    })
  })
}
