// packages/backend/src/api/agents.ts · v0.3 spec §10 (4 端点)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'
import { loadAgentRegistry } from '../core/orchestrator/agent-registry.js'

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
    // 4) Agency Agents 注册表 (254+ agents)
    const registryAgents: Array<{
      id: string; name: string; description: string; category: string;
      is_builtin: boolean; is_registry: boolean; session_count: number; last_used_at: null;
      division?: string; divisionLabel?: string; emoji?: string; vibe?: string;
    }> = []
    try {
      const reg = loadAgentRegistry()
      for (const [slug, agent] of reg) {
        if (BUILTIN_AGENTS.some(a => a.id === slug)) continue
        const u = usageMap.get(slug)
        registryAgents.push({
          id: slug,
          name: agent.name,
          description: agent.description,
          category: agent.division || 'specialized',
          is_builtin: false,
          is_registry: true,
          session_count: u?.session_count ?? 0,
          last_used_at: u?.last_used_at ?? null,
          division: agent.division,
          divisionLabel: agent.divisionLabel,
          emoji: agent.emoji,
          vibe: agent.vibe,
        })
      }
      console.log(`[Agents API] Loaded ${registryAgents.length} registry agents from agency-agents`)
    } catch (e: any) { console.warn('[Agents API] Registry agents load failed:', e.message) }

    return reply.send({ agents: [...builtin, ...registryAgents, ...custom], count: builtin.length + registryAgents.length + custom.length })
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
  // Phase C.4 (2026-06-16) 显式字段 + config_yaml redaction (非 admin/owner 返 '[REDACTED]')
  // 之前 SELECT * 把 config_yaml (可能含 API key 模板 / 内部 prompt) 暴露给任何登录用户
  // GET /divisions — 部门+Agent 列表 (v8.8)
  app.get('/divisions', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const { readFileSync, existsSync, readdirSync } = await import('node:fs')
      const { join, dirname } = await import('node:path')
      const { fileURLToPath } = await import('node:url')
      const __f = fileURLToPath(import.meta.url)
      const __d = dirname(__f)
      const root = join(__d, '..', '..', '..', '..', 'embedded', 'agency-agents')
      const divFile = join(root, 'divisions.json')
      
      // Load division metadata
      let divMeta: Record<string, { label: string; icon: string; color: string }> = {}
      if (existsSync(divFile)) {
        const raw = JSON.parse(readFileSync(divFile, 'utf-8'))
        if (raw.divisions) divMeta = raw.divisions
      }
      
      const SKIP = new Set(['.git', 'scripts', 'integrations', 'examples', 'CONTRIBUTING.md', 'CONTRIBUTING_zh-CN.md', 'LICENSE', 'README.md', 'SECURITY.md', 'divisions.json'])
      const divs: any[] = []
      
      for (const name of readdirSync(root)) {
        if (SKIP.has(name)) continue
        const dirPath = join(root, name)
        try {
          const stat = await import('node:fs/promises').then(m => m.stat(dirPath))
          if (!stat.isDirectory()) continue
          const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
          const meta = divMeta[name] || { label: name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' '), icon: 'Folder', color: '#888' }
          divs.push({
            slug: name,
            label: meta.label,
            icon: meta.icon,
            color: meta.color,
            count: files.length,
            agents: files.slice(0, 20).map(f => ({
              name: f.replace('.md', '').replace(name + '-', '').replace(/-/g, ' ').replace(/\w/g, (c: string) => c.toUpperCase()),
              file: f,
            })),
          })
        } catch { /* skip */ }
      }
      
      return reply.send({ divisions: divs })
    } catch (e: any) { return reply.code(500).send({ error: e.message }) }
  })

    app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const row = sqlite
      .prepare(
        'SELECT id, name, description, config_yaml, version, is_builtin, created_by, created_at, updated_at FROM agents WHERE id = ?',
      )
      .get(id) as
      | {
          id: string
          name: string
          description: string
          config_yaml: string
          version: number
          is_builtin: number
          created_by: string
          created_at: number
          updated_at: number
        }
      | undefined
    if (!row) return reply.code(404).send({ code: 'AGENT_NOT_FOUND' })
    // config_yaml 仅 admin 或 owner 可见, 其他返 '[REDACTED]'
    const userId = req.user!.id
    const role = req.user!.role
    const isOwner = row.created_by === userId
    const isAdmin = role === 'ADMIN'
    if (!isAdmin && !isOwner) {
      return reply.send({ ...row, config_yaml: '[REDACTED]' })
    }
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

