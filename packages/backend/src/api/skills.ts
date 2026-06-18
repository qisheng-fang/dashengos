// packages/backend/src/api/skills.ts · v0.3 spec §10 + Phase B.1 Skill Marketplace
// 原有 CRUD + marketplace/install/uninstall/configure/status 端点
// 路由顺序: marketplace 特定路径 → 原有 CRUD → :id 通配
import type { FastifyInstance } from 'fastify'
import { ulid } from 'ulid'
import {
  searchMarketplace,
  getMarketplaceEntry,
  MARKETPLACE_CATEGORIES,
} from '../core/marketplace.js'
import {
  listAvailableSkills,
  executeSkill,
  formatSkillInstructions,
} from '../core/skills/executor.js'

export async function skillRoutes(app: FastifyInstance) {
  const getDb = () => app.sqlite as {
    prepare: (sql: string) => {
      all: (...args: unknown[]) => unknown[]
      get: (...args: unknown[]) => unknown
      run: (...args: unknown[]) => { changes: number }
    }
  }

  // =========================================================================
  // Phase B.1: 特定路径 (优先于 :id 通配)
  // =========================================================================

  // GET /skills/marketplace — 列出市场中的可用 skill
  app.get('/marketplace', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { search, category } = req.query as { search?: string; category?: string }
    const results = searchMarketplace(search || '', category || 'all')

    const db = getDb()
    const userId = (req.user as { id: string }).id
    const installedRows = db.prepare(
      'SELECT skill_id, version, status FROM skill_installs WHERE user_id = ? AND status = ?',
    ).all(userId, 'installed') as Array<{ skill_id: string; version: string; status: string }>
    const installedMap = new Map(installedRows.map((r) => [r.skill_id, { version: r.version, status: r.status }]))

    const skills = results.map((s) => ({
      ...s,
      installed: installedMap.has(s.id),
      installed_version: installedMap.get(s.id)?.version ?? null,
    }))

    return reply.send({ skills, categories: MARKETPLACE_CATEGORIES })
  })

  // GET /skills/marketplace/categories
  app.get('/marketplace/categories', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ categories: MARKETPLACE_CATEGORIES })
  })

  // ─────────────────────────────────────────────────────────────────
  // P4: 技能执行端点 (Skill Executor)
  // ─────────────────────────────────────────────────────────────────

  // GET /skills/available — 列出 WorkBuddy 可执行技能
  app.get('/available', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const skills = listAvailableSkills()
    return reply.send({ skills, count: skills.length })
  })

  // GET /skills/available/:name/instructions — 读取技能指令（给 Agent 读）
  app.get('/available/:name/instructions', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const instructions = formatSkillInstructions(name)

    if (instructions.startsWith('错误:')) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: instructions })
    }

    return reply.send({ skill_name: name, instructions })
  })

  // POST /skills/available/:name/execute — 触发技能执行
  app.post('/available/:name/execute', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as { id: string }).id
    const { name } = req.params as { name: string }
    const { params } = req.body as { params?: Record<string, any> }

    const result = await executeSkill(name, params || {}, {
      userId,
      autoExecute: false,  // 当前只返回指令模式
    })

    if (!result.success) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: result.error || 'Skill not found' })
    }

    return reply.send({
      success: true,
      skill_name: result.skillName,
      steps: result.steps,
      summary: result.summary,
    })
  })

  // POST /skills/install — 从市场安装 skill
  app.post('/install', { preHandler: [app.authenticate] }, async (req, reply) => {
    const db = getDb()
    const userId = (req.user as { id: string }).id
    const { skill_id, version } = req.body as { skill_id: string; version?: string }

    if (!skill_id) {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'skill_id is required' })
    }

    const entry = getMarketplaceEntry(skill_id)
    if (!entry) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Skill not found in marketplace' })
    }

    const installVersion = version || entry.version
    const now = Date.now()

    const existing = db.prepare(
      'SELECT * FROM skill_installs WHERE user_id = ? AND skill_id = ?',
    ).get(userId, skill_id) as Record<string, unknown> | undefined

    if (existing) {
      if (existing.status === 'installed') {
        return reply.code(409).send({ code: 'ALREADY_INSTALLED', message: 'Skill already installed' })
      }
      db.prepare(
        `UPDATE skill_installs
         SET version = ?, status = 'installed', installed_at = ?, uninstalled_at = NULL, config_json = '{}'
         WHERE user_id = ? AND skill_id = ?`,
      ).run(installVersion, now, userId, skill_id)
    } else {
      db.prepare(
        `INSERT INTO skill_installs (id, user_id, skill_id, version, config_json, status, installed_at)
         VALUES (?, ?, ?, ?, '{}', 'installed', ?)`,
      ).run(ulid(), userId, skill_id, installVersion, now)
    }

    // 确保 skills 表中有记录
    const skillExists = db.prepare('SELECT id FROM skills WHERE id = ?').get(skill_id)
    if (!skillExists) {
      db.prepare(
        `INSERT INTO skills (id, name, description, version, source, source_url, signature, manifest_json, enabled, installed_at, updated_at)
         VALUES (?, ?, ?, ?, 'MARKETPLACE', NULL, '', ?, 1, ?, ?)`,
      ).run(skill_id, entry.name, entry.description, installVersion, JSON.stringify(entry.manifest), now, now)
    } else {
      db.prepare('UPDATE skills SET enabled = 1, version = ?, updated_at = ? WHERE id = ?').run(
        installVersion, now, skill_id,
      )
    }

    return reply.send({ ok: true, skill_id, version: installVersion, installed_at: now })
  })

  // =========================================================================
  // 原有 CRUD 端点
  // =========================================================================

  // GET /skills — 列出已启用的 skill
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM skills WHERE enabled = 1 ORDER BY name').all()
    return reply.send({ skills: rows })
  })

  // POST /skills/import (admin)
  app.post('/import', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.code(501).send({ code: 'NOT_IMPLEMENTED', message: 'Phase 3 实现' })
  })

  // =========================================================================
  // :id 通配路由 (放在最后避免匹配冲突)
  // =========================================================================

  // GET /skills/:id — 获取单个 skill 详情
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const db = getDb()
    const { id } = req.params as { id: string }
    const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!row) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Skill not found' })
    }
    return reply.send(row)
  })

  // GET /skills/:id/status — 查询安装状态
  app.get('/:id/status', { preHandler: [app.authenticate] }, async (req, reply) => {
    const db = getDb()
    const { id } = req.params as { id: string }
    const userId = (req.user as { id: string }).id

    const installRow = db.prepare(
      'SELECT * FROM skill_installs WHERE user_id = ? AND skill_id = ?',
    ).get(userId, id) as Record<string, unknown> | undefined

    const skillRow = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Record<string, unknown> | undefined

    const installed = installRow && installRow.status === 'installed'
    return reply.send({
      skill_id: id,
      installed,
      version: installRow?.version ?? skillRow?.version ?? null,
      status: installRow?.status ?? 'not_installed',
      installed_at: installRow?.installed_at ?? null,
      config: installRow?.config_json ? safeJsonParse(installRow.config_json as string) : {},
      health: installed ? 'ok' : 'not_installed',
    })
  })

  // POST /skills/:id/uninstall — 卸载
  app.post('/:id/uninstall', { preHandler: [app.authenticate] }, async (req, reply) => {
    const db = getDb()
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }

    const existing = db.prepare(
      'SELECT * FROM skill_installs WHERE user_id = ? AND skill_id = ? AND status = ?',
    ).get(userId, id, 'installed') as Record<string, unknown> | undefined

    if (!existing) {
      return reply.code(404).send({ code: 'NOT_INSTALLED', message: 'Skill is not installed' })
    }

    const now = Date.now()
    db.prepare(
      "UPDATE skill_installs SET status = 'uninstalled', uninstalled_at = ? WHERE user_id = ? AND skill_id = ?",
    ).run(now, userId, id)

    // 移除 agent_skills 关联
    db.prepare('DELETE FROM agent_skills WHERE skill_id = ?').run(id)

    return reply.send({ ok: true, skill_id: id, uninstalled_at: now })
  })

  // POST /skills/:id/configure — 配置
  app.post('/:id/configure', { preHandler: [app.authenticate] }, async (req, reply) => {
    const db = getDb()
    const userId = (req.user as { id: string }).id
    const { id } = req.params as { id: string }
    const { config } = req.body as { config: Record<string, unknown> }

    if (!config || typeof config !== 'object') {
      return reply.code(400).send({ code: 'BAD_REQUEST', message: 'config is required' })
    }

    const existing = db.prepare(
      'SELECT * FROM skill_installs WHERE user_id = ? AND skill_id = ? AND status = ?',
    ).get(userId, id, 'installed') as Record<string, unknown> | undefined

    if (!existing) {
      return reply.code(404).send({ code: 'NOT_INSTALLED', message: 'Skill is not installed' })
    }

    db.prepare('UPDATE skill_installs SET config_json = ? WHERE user_id = ? AND skill_id = ?').run(
      JSON.stringify(config), userId, id,
    )

    return reply.send({ ok: true, skill_id: id, config })
  })

  // POST /skills/:id/reload (admin)
  app.post('/:id/reload', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.send({ ok: true })
  })

  // DELETE /skills/:id (admin)
  app.delete('/:id', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.send({ ok: true })
  })
}

function safeJsonParse(s: string): unknown {
  try { return JSON.parse(s) } catch { return {} }
}
