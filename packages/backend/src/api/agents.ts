// packages/backend/src/api/agents.ts · v0.3 spec §10 (4 端点)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().min(1),
  config_yaml: z.string().min(1),
})

// 6 个内置 agent (跟 Workspace 快速启动 + marketplace agent 列表一致)
const BUILTIN_AGENTS = [
  { id: 'code-reviewer',   name: 'Code Reviewer',     description: '代码审查专家, 找 bug + 安全问题',     category: 'code' },
  { id: 'deep-researcher', name: 'Deep Researcher',   description: '深度研究, 多源信息整合',             category: 'research' },
  { id: 'design-assistant', name: 'Design Assistant',  description: 'UI/UX 设计助手',                       category: 'design' },
  { id: 'data-analyst',    name: 'Data Analyst',      description: '数据分析 + 可视化',                     category: 'data' },
  { id: 'security-reviewer', name: 'Security Reviewer', description: '安全审查, OWASP top 10',                 category: 'security' },
  { id: 'custom-workflow', name: 'Custom Workflow',   description: '自定义工作流 (Phase 5+ 创)',             category: 'custom' },
  // Track B · 3 社媒 Agent (2026-06-15)
  { id: 'DouyinAgent',     name: '抖音运营 Agent',     description: '抖音趋势/视频生成/发布/数据回采 (走旧 sau-bridge + douyin-bridge + pixelle-bridge)', category: 'social' },
  { id: 'XiaohongshuAgent', name: '小红书运营 Agent',  description: '小红书图文笔记/种草发布/数据监控 (走旧 sau-bridge + video-parser)', category: 'social' },
  { id: 'WechatAgent',     name: '微信公众号 Agent',   description: '公众号登录态/长文生成/文章发布 (走旧 wechat-mp-bridge)', category: 'social' },
] as const

export async function agentRoutes(app: FastifyInstance) {
  // GET /agents — 返内置 9 agent (6 builtin + 3 social) + sessions 表 session_count + DB custom agents
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    // 1) 从 sessions 表拿 agent_id → session_count
    const usageRows = sqlite
      .prepare('SELECT agent_id, COUNT(*) as session_count, MAX(updated_at) as last_used_at FROM sessions GROUP BY agent_id')
      .all() as Array<{ agent_id: string; session_count: number; last_used_at: number }>
    const usageMap = new Map(usageRows.map((r) => [r.agent_id, r]))

    // 2) DB 里创的 custom agents (Phase 5+ 创的, is_builtin=0)
    const customRows = sqlite
      .prepare("SELECT id, name, description, version, is_builtin, created_by, created_at, updated_at FROM agents WHERE is_builtin = 0 ORDER BY updated_at DESC")
      .all() as Array<{ id: string; name: string; description: string; version: number; is_builtin: number; created_by: string; created_at: number; updated_at: number }>

    // 3) 合并: 内置 9 个 (含 3 social, 合并 usage) + DB custom
    const builtin = BUILTIN_AGENTS.map((a) => {
      const u = usageMap.get(a.id)
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        category: a.category,
        is_builtin: true,
        is_social: a.category === 'social',  // Track B: social 标记
        session_count: u?.session_count ?? 0,
        last_used_at: u?.last_used_at ?? null,
      }
    })
    const custom = customRows.map((r) => {
      const u = usageMap.get(r.id)
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        category: 'custom',
        is_builtin: false,
        is_social: false,
        version: r.version,
        created_by: r.created_by,
        created_at: r.created_at,
        session_count: u?.session_count ?? 0,
        last_used_at: u?.last_used_at ?? null,
      }
    })
    return reply.send({ agents: [...builtin, ...custom], count: builtin.length + custom.length })
  })

  // POST /agents (admin)
  app.post('/', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const parsed = CreateAgentSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const id = ulid()
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO agents (id, name, description, config_yaml, version, is_builtin, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)`,
      )
      .run(id, parsed.data.name, parsed.data.description, parsed.data.config_yaml, req.user!.id, now, now)
    return reply.code(201).send({ id, ...parsed.data })
  })

  // GET /agents/:id
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = sqlite.prepare('SELECT * FROM agents WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ code: 'AGENT_NOT_FOUND' })
    return reply.send(row)
  })

  // PUT /agents/:id (admin)
  app.put('/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const parsed = CreateAgentSchema.partial().safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const fields = Object.keys(parsed.data)
    if (fields.length === 0) return reply.send({ id })
    const setClause = fields.map((f) => `${f} = ?`).join(', ')
    const values = fields.map((f) => (parsed.data as Record<string, unknown>)[f])
    sqlite
      .prepare(`UPDATE agents SET ${setClause}, version = version + 1, updated_at = ? WHERE id = ?`)
      .run(...values, Date.now(), id)
    return reply.send({ id, ...parsed.data })
  })
}
