// packages/backend/src/api/{tools,models,files,audit,settings,system,workspace,secrets}.ts
// v0.3 spec §10 stub 8 个路由组 (47 端点 - 24 已在 auth/sessions/agents/skills/mcp)
// 这些文件是 Phase 2 的最小可用版本, Phase 3 接入沙箱/DeerFlow 后填充

import type { FastifyInstance } from 'fastify'
import { connect as netConnect } from 'node:net'
import { Buffer } from 'node:buffer'
import { z } from 'zod'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'
import { isRedisConnected, ping as redisPing } from '../cache/redis.js'

// Phase 10: /tools 返 23 sandbox IPC + /tools/:id/invoke 真接 sandbox via unix socket
// Sandbox IPC 走 JSON-RPC 2.0 over unix socket (/tmp/dasheng/sandbox.sock)
// 跟 sandbox 容器共享 volume, backend 容器内 net.Dial('unix', ...) 即可

// 23 sandbox IPC (从 sandbox/cmd/sandbox/main.go 抄)
const SANDBOX_TOOLS = [
  { id: 'health.ping',          category: 'core',     description: '健康检查 (返方法数+uptime)' },
  { id: 'sandbox.exec',         category: 'core',     description: '执行 shell 命令 (sandboxed)' },
  { id: 'file.read',            category: 'file',     description: '读文件' },
  { id: 'file.write',           category: 'file',     description: '写文件' },
  { id: 'research.run',         category: 'research', description: '启动 research workflow' },
  { id: 'research.status',      category: 'research', description: '查 research 状态' },
  { id: 'research.result',      category: 'research', description: '拿 research 结果' },
  { id: 'research.cancel',      category: 'research', description: '取消 research' },
  { id: 'research.stream',      category: 'research', description: 'research 流式结果' },
  { id: 'agent.list',           category: 'agent',    description: '列可用 Agent' },
  { id: 'agent.run',            category: 'agent',    description: '运行 Agent' },
  { id: 'skill.list',           category: 'skill',    description: '列已装 Skill' },
  { id: 'skill.load',           category: 'skill',    description: '加载 Skill manifest' },
  { id: 'audit.write',          category: 'audit',    description: '写审计日志' },
  { id: 'secret.read',          category: 'secret',   description: '读 Secret (从 env/file)' },
  { id: 'browser.navigate',     category: 'browser',  description: '浏览器 navigate' },
  { id: 'browser.extract',      category: 'browser',  description: '浏览器 extract 文本' },
  { id: 'subagent.research',    category: 'subagent', description: 'subagent: research' },
  { id: 'subagent.run_agent',   category: 'subagent', description: 'subagent: run agent' },
  { id: 'subagent.apply_skill', category: 'subagent', description: 'subagent: apply skill' },
  { id: 'subagent.exec_safe',   category: 'subagent', description: 'subagent: exec safe' },
  { id: 'subagent.file_op',     category: 'subagent', description: 'subagent: file op' },
  { id: 'metrics.snapshot',     category: 'metrics',  description: 'sandbox metrics 快照' },
] as const

const SandboxInvokeBody = z.object({
  params: z.record(z.string(), z.unknown()).default({}),
  timeout_ms: z.number().min(100).max(120_000).default(30_000),
  // Phase E (2026-06-17) HITL: 第一次 invoke 不带 confirm → 返 202 + CONFIRM_REQUIRED
  //   前端弹 confirm 框, 用户 OK 后带 confirm=true 再调
  confirm: z.boolean().optional(),
})

// JSON-RPC 2.0 client over unix socket
async function callSandbox(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
  const socketPath = process.env.DASHE_SANDBOX_SOCKET || '/tmp/dasheng/sandbox.sock'
  return new Promise((resolve, reject) => {
    const sock = netConnect(socketPath)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`sandbox RPC timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    sock.once('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`sandbox socket error: ${err.message}`))
    })

    sock.once('connect', () => {
      const reqId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)
      const request = JSON.stringify({
        jsonrpc: '2.0',
        id: reqId,
        method,
        params: params ?? {},
      }) + '\n'
      sock.write(request, (err) => {
        if (err) {
          clearTimeout(timer)
          sock.destroy()
          reject(err)
        }
      })

      // Read until newline (sandbox writes 1 JSON object per line)
      let buf = Buffer.alloc(0)
      const onData = (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk])
        const nl = buf.indexOf('\n')
        if (nl >= 0) {
          clearTimeout(timer)
          sock.end()
          try {
            const resp = JSON.parse(buf.slice(0, nl).toString('utf8'))
            if (resp.error) {
              reject(new Error(`sandbox error ${resp.error.code}: ${resp.error.message}`))
            } else {
              resolve(resp.result)
            }
          } catch (e) {
            reject(new Error(`sandbox parse error: ${(e as Error).message}, raw=${buf.toString('utf8').slice(0, 200)}`))
          }
        }
      }
      sock.on('data', onData)
    })
  })
}

// Phase B.5 (2026-06-16) tool_permissions 鉴权 (默认 deny, 跟 tool_pattern 匹配才放)
//   match 规则: user_id 精确 OR role 匹配 (USER/ADMIN/GUEST) AND tool_pattern 匹配
//   tool_pattern 支持 % 通配 ('sandbox.%' / 'file.*' / '*')
//   任何 allow=0 的规则先匹配 → 403
//   都没 allow=1 的规则 → 403 (fail-secure, 没显式授权 = 拒)
function checkToolPermission(
  userId: string,
  role: 'ADMIN' | 'USER' | 'GUEST',
  toolId: string,
): { allow: boolean; require_confirm: boolean; reason: string } {
  // SQL LIKE 模式: 'sandbox.exec' 精确, 'sandbox.%' 通配, '*' 全部
  // 查 (user_id 精确 OR role 匹配) AND pattern 匹配 的所有行
  const rows = sqlite
    .prepare(
      `SELECT tool_pattern, allow, require_confirm
       FROM tool_permissions
       WHERE (user_id = ? OR role = ?)
         AND (tool_pattern = ? OR tool_pattern = ? OR tool_pattern = '*' OR tool_pattern LIKE ?)`,
    )
    .all(userId, role, toolId, `${toolId.split('.')[0]}.%`, `${toolId}.%`) as Array<{
    tool_pattern: string
    allow: number
    require_confirm: number
  }>

  // 任何 allow=0 先匹配 → 拒
  const deny = rows.find((r) => r.allow === 0)
  if (deny) {
    return { allow: false, require_confirm: false, reason: `denied by pattern ${deny.tool_pattern}` }
  }
  // 都没匹配 → 默认 deny (fail-secure)
  if (rows.length === 0) {
    return { allow: false, require_confirm: false, reason: 'no allow rule matches (fail-secure default)' }
  }
  // 任何 require_confirm=1 → 标 HITL (Phase C 真正接 HITL 流, Phase B.5 先允许但记日志)
  const needConfirm = rows.some((r) => r.require_confirm === 1)
  return { allow: true, require_confirm: needConfirm, reason: `allowed by ${rows.length} rule(s)` }
}

export async function toolRoutes(app: FastifyInstance) {
  // GET /tools — 列 sandbox 23 IPC (从 main.go 抄, 静态列表)
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      tools: SANDBOX_TOOLS,
      count: SANDBOX_TOOLS.length,
    })
  })

  // POST /tools/:id/invoke — 真调 sandbox via unix socket (JSON-RPC 2.0)
  // Phase B.5 (2026-06-16) 加 tool_permissions 鉴权 — 之前任何登录用户能调 23 IPC
  app.post('/:id/invoke', { preHandler: [app.authenticate] }, async (req, reply) => {
    const toolId = (req.params as { id: string }).id
    const known = SANDBOX_TOOLS.find((t) => t.id === toolId)
    if (!known) {
      return reply.code(404).send({ code: 'TOOL_NOT_FOUND', tool_id: toolId })
    }
    const userId = req.user!.id
    const role = req.user!.role
    // 1. 鉴权
    const perm = checkToolPermission(userId, role, toolId)
    if (!perm.allow) {
      app.log.warn({ userId, toolId, reason: perm.reason }, 'tool invoke denied')
      return reply.code(403).send({
        code: 'TOOL_PERMISSION_DENIED',
        tool_id: toolId,
        reason: perm.reason,
      })
    }
    if (perm.allow) {
      // permission 已验过, 进 parsed 阶段
    }
    const parsed = SandboxInvokeBody.safeParse(req.body || {})
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }
    // Phase E (2026-06-17) HITL: 高危工具返 202, 前端弹 confirm 框
    if (perm.require_confirm && !parsed.data.confirm) {
      app.log.info({ userId, toolId, reason: perm.reason }, 'tool invoke requires confirm (HITL 202)')
      return reply.code(202).send({
        code: 'CONFIRM_REQUIRED',
        tool_id: toolId,
        reason: perm.reason,
        require_confirm: true,
      })
    }
    if (perm.require_confirm && parsed.data.confirm) {
      app.log.info({ userId, toolId, reason: perm.reason }, 'tool invoke confirmed by user')
    }
    const start = Date.now()
    try {
      const result = await callSandbox(toolId, parsed.data.params, parsed.data.timeout_ms)
      return reply.send({
        tool_id: toolId,
        result,
        executed_at: start,
        duration_ms: Date.now() - start,
        source: 'sandbox',
        permission_reason: perm.reason,
        require_confirm: perm.require_confirm,
      })
    } catch (e) {
      return reply.code(502).send({
        code: 'SANDBOX_INVOKE_FAILED',
        tool_id: toolId,
        message: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - start,
      })
    }
  })

  // GET /tools/permissions — 返当前 user 的 tool permissions (从 DB)
  app.get('/permissions', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const userPerms = sqlite
      .prepare(
        `SELECT tool_pattern, allow, require_confirm, expires_at
         FROM tool_permissions WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
      )
      .all(userId, Date.now()) as Array<{
      tool_pattern: string
      allow: number
      require_confirm: number
      expires_at: number | null
    }>
    return reply.send({
      permissions: userPerms.map((p) => ({
        tool_pattern: p.tool_pattern,
        allow: !!p.allow,
        require_confirm: !!p.require_confirm,
        expires_at: p.expires_at,
      })),
    })
  })
}

// ====================================================================
// models.ts (3 端点)
// ====================================================================

const ChatBody = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string().min(1).max(32_000),
      }),
    )
    .min(1)
    .max(64),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0.7),
})

const EmbedBody = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
})

export async function modelRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      models: [
        { id: 'ollama:qwen2.5:3b', provider: 'ollama', healthy: true },
        { id: 'ollama:qwen2.5:7b', provider: 'ollama', healthy: true },
        { id: 'openai:gpt-4o', provider: 'openai', healthy: false },
      ],
      ollama_host: config.OLLAMA_HOST,
      default_model: config.DEFAULT_MODEL,
    })
  })

  // POST /models/:id/chat — 转发到 Ollama /api/chat 或 SiliconFlow / DeepSeek (Track D.1)
  app.post('/:id/chat', { preHandler: [app.authenticate] }, async (req, reply) => {
    const modelId = (req.params as { id: string }).id
    const parsed = ChatBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }

    // === Ollama 本地 (无需 key) ===
    if (modelId.startsWith('ollama:')) {
      const ollamaModel = modelId.replace(/^ollama:/, '')
      try {
        const res = await fetch(`${config.OLLAMA_HOST}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            messages: parsed.data.messages,
            stream: parsed.data.stream,
            options: { temperature: parsed.data.temperature },
          }),
          signal: AbortSignal.timeout(300_000),
        })
        if (!res.ok) {
          await res.text().catch(() => '')
          return reply.code(502).send({ code: 'OLLAMA_UPSTREAM_FAILED', status: res.status, message: sanitizeUpstreamError() })
        }
        const json = (await res.json()) as {
          model: string; message: { role: string; content: string }; done: boolean
          total_duration?: number; load_duration?: number
          prompt_eval_count?: number; eval_count?: number; eval_duration?: number
        }
        return reply.send({
          model: json.model,
          message: json.message,
          done: json.done,
          usage: {
            prompt_tokens: json.prompt_eval_count ?? 0,
            completion_tokens: json.eval_count ?? 0,
            total_duration_ms: json.total_duration ? Math.round(json.total_duration / 1e6) : null,
            load_duration_ms: json.load_duration ? Math.round(json.load_duration / 1e6) : null,
            eval_duration_ms: json.eval_duration ? Math.round(json.eval_duration / 1e6) : null,
          },
        })
      } catch (e) {
        return reply.code(502).send({
          code: 'OLLAMA_UNREACHABLE',
          message: e instanceof Error ? e.message : String(e),
          ollama_host: config.OLLAMA_HOST,
        })
      }
    }

    // === SiliconFlow (OpenAI 兼容) — Track D.1 2026-06-15 ===
    if (modelId.startsWith('siliconflow:')) {
      if (!config.SILICONFLOW_API_KEY) {
        return reply.code(400).send({
          code: 'SILICONFLOW_KEY_MISSING',
          message: '改 packages/backend/.env 设 SILICONFLOW_API_KEY=sk-... 然后重启 backend',
          env: 'SILICONFLOW_API_KEY',
        })
      }
      const sfModel = modelId.replace(/^siliconflow:/, '')
      try {
        const res = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
          },
          body: JSON.stringify({
            model: sfModel,
            messages: parsed.data.messages,
            stream: parsed.data.stream ?? false,
            temperature: parsed.data.temperature ?? 0.7,
          }),
          signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
        })
        if (!res.ok) {
          await res.text().catch(() => '')
          return reply.code(502).send({
            code: 'SILICONFLOW_UPSTREAM_FAILED',
            status: res.status,
            message: sanitizeUpstreamError(),
          })
        }
        const json = (await res.json()) as {
          model: string
          choices: Array<{ message: { role: string; content: string }; index: number; finish_reason: string }>
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
        }
        const choice = json.choices?.[0]
        return reply.send({
          model: json.model,
          message: choice?.message ?? { role: 'assistant', content: '' },
          done: true,
          usage: {
            prompt_tokens: json.usage?.prompt_tokens ?? 0,
            completion_tokens: json.usage?.completion_tokens ?? 0,
            total_tokens: json.usage?.total_tokens ?? 0,
          },
        })
      } catch (e) {
        return reply.code(502).send({
          code: 'SILICONFLOW_UNREACHABLE',
          message: e instanceof Error ? e.message : String(e),
          siliconflow_base_url: config.SILICONFLOW_BASE_URL,
        })
      }
    }

    // === DeepSeek (OpenAI 兼容) — Track D.1 备选 ===
    if (modelId.startsWith('deepseek:')) {
      if (!config.DEEPSEEK_API_KEY) {
        return reply.code(400).send({
          code: 'DEEPSEEK_KEY_MISSING',
          message: '改 packages/backend/.env 设 DEEPSEEK_API_KEY=sk-... 然后重启 backend',
          env: 'DEEPSEEK_API_KEY',
        })
      }
      const dsModel = modelId.replace(/^deepseek:/, '')
      try {
        const res = await fetch(`${config.DEEPSEEK_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
          },
          body: JSON.stringify({
            model: dsModel || config.DEEPSEEK_MODEL,
            messages: parsed.data.messages,
            stream: parsed.data.stream ?? false,
            temperature: parsed.data.temperature ?? 0.7,
          }),
          signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
        })
        if (!res.ok) {
          await res.text().catch(() => '')
          return reply.code(502).send({
            code: 'DEEPSEEK_UPSTREAM_FAILED',
            status: res.status,
            message: sanitizeUpstreamError(),
          })
        }
        const json = (await res.json()) as {
          model: string
          choices: Array<{ message: { role: string; content: string }; index: number; finish_reason: string }>
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
        }
        const choice = json.choices?.[0]
        return reply.send({
          model: json.model,
          message: choice?.message ?? { role: 'assistant', content: '' },
          done: true,
          usage: {
            prompt_tokens: json.usage?.prompt_tokens ?? 0,
            completion_tokens: json.usage?.completion_tokens ?? 0,
            total_tokens: json.usage?.total_tokens ?? 0,
          },
        })
      } catch (e) {
        return reply.code(502).send({
          code: 'DEEPSEEK_UNREACHABLE',
          message: e instanceof Error ? e.message : String(e),
          deepseek_base_url: config.DEEPSEEK_BASE_URL,
        })
      }
    }

    return reply.code(400).send({
      code: 'UNSUPPORTED_PROVIDER',
      message: 'model id must start with ollama: / siliconflow: / deepseek:',
      received: modelId,
    })
  })

  // POST /models/:id/embed — 转发到 Ollama /api/embeddings
  app.post('/:id/embed', { preHandler: [app.authenticate] }, async (req, reply) => {
    const modelId = (req.params as { id: string }).id
    if (!modelId.startsWith('ollama:')) {
      return reply.code(400).send({ code: 'UNSUPPORTED_PROVIDER' })
    }
    const parsed = EmbedBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }
    const ollamaModel = modelId.replace(/^ollama:/, '')
    const input = Array.isArray(parsed.data.input) ? parsed.data.input : [parsed.data.input]
    try {
      const res = await fetch(`${config.OLLAMA_HOST}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, prompt: input }),
        signal: AbortSignal.timeout(120_000),
      })
      if (!res.ok) {
        return reply.code(502).send({ code: 'OLLAMA_UPSTREAM_FAILED', status: res.status })
      }
      const json = (await res.json()) as { embeddings: number[][] }
      return reply.send({ model: ollamaModel, embeddings: json.embeddings })
    } catch (e) {
      return reply.code(502).send({
        code: 'OLLAMA_UNREACHABLE',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  })
}

// ====================================================================
// files.ts (4 端点) — P1: 当前全部 stub，待实现真实文件存储
// ====================================================================
export async function fileRoutes(app: FastifyInstance) {
  app.post('/upload', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.code(501).send({ code: 'NOT_IMPLEMENTED' })
  })
  app.get('/:id', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.code(404).send({ code: 'FILE_NOT_FOUND' })
  })
  app.get('/:id/download', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.code(404).send({ code: 'FILE_NOT_FOUND' })
  })
  app.post('/search', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ results: [] })
  })
}

// ====================================================================
// audit.ts (3 端点)
// ====================================================================
export async function auditRoutes(app: FastifyInstance) {
  app.get('/logs', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    const db = app.sqlite as { prepare: (sql: string) => { all: () => unknown[] } }
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 50').all()
    return reply.send({ logs: rows })
  })
  app.get('/logs/:id', { preHandler: [app.requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const db = app.sqlite as { prepare: (sql: string) => { get: (id: string) => unknown } }
    const row = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id)
    if (!row) return reply.code(404).send({ code: 'AUDIT_NOT_FOUND' })
    return reply.send(row)
  })
  app.post('/export', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.code(501).send({ code: 'NOT_IMPLEMENTED' })
  })
}

// Phase C.2 (2026-06-16) 上游错误 sanitize — 不让 LLM 4xx body (可能含 Authorization / trace_id) 回客户端
// server 侧用 app.log.error 记完整 errText, client 只返 status + generic hint
function sanitizeUpstreamError(): string {
  return 'upstream LLM failed, see server log for details'
}
//   - GET   /api/v1/settings                拿当前用户全部 settings
//   - PUT   /api/v1/settings/provider/:id  存 provider API key
//   - DELETE /api/v1/settings/provider/:id 删 key
//   - PUT   /api/v1/settings/models/text   存降级链
//   - POST  /api/v1/settings/provider/:id/test  真测连通
// ====================================================================

const ProviderIdSchema = z.enum(['deepseek', 'siliconflow', 'openai', 'anthropic', 'ollama'])
const PutProviderBodySchema = z.object({ apiKey: z.string().min(1).max(512) })
const PutTextModelsBodySchema = z.object({ chain: z.array(z.string().min(1)).min(1).max(20) })

// 各 provider 真实连通测试 (打公共 API, ~5s timeout)
async function testProviderConnection(
  providerId: string,
  apiKey: string | null,
): Promise<{ healthy: boolean; latency_ms: number; error?: string }> {
  const start = Date.now()
  const timeout = 5_000
  try {
    let url: string
    let headers: Record<string, string> = {}
    switch (providerId) {
      case 'siliconflow':
        url = 'https://api.siliconflow.cn/v1/models'
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        break
      case 'deepseek':
        url = 'https://api.deepseek.com/v1/models'
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        break
      case 'openai':
        url = 'https://api.openai.com/v1/models'
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
        break
      case 'anthropic':
        url = 'https://api.anthropic.com/v1/messages'
        headers = {
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
        break
      case 'ollama':
        url = 'http://127.0.0.1:11434/api/tags'
        break
      default:
        return { healthy: false, latency_ms: 0, error: 'unknown provider' }
    }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeout)
    const init: RequestInit = {
      method: providerId === 'anthropic' ? 'POST' : 'GET',
      headers,
      signal: ctl.signal,
    }
    if (providerId === 'anthropic') {
      init.body = JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      })
    }
    const res = await fetch(url, init)
    clearTimeout(timer)
    return { healthy: res.ok, latency_ms: Date.now() - start }
  } catch (e) {
    return { healthy: false, latency_ms: Date.now() - start, error: (e as Error).message }
  }
}

export async function settingsRoutes(app: FastifyInstance) {
  // GET /api/v1/settings — 拿当前用户 settings (provider keys hasKey 标记 + text chain)
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user!.id
    const rows = sqlite
      .prepare('SELECT category, value FROM user_settings WHERE user_id = ?')
      .all(userId) as Array<{ category: string; value: string }>

    const settings: Record<string, unknown> = { providers: {}, text: {} }
    for (const row of rows) {
      try {
        const v = JSON.parse(row.value)
        if (row.category.startsWith('provider.')) {
          ;(settings.providers as Record<string, unknown>)[row.category.slice('provider.'.length)] = v
        } else if (row.category.startsWith('models.text')) {
          Object.assign(settings.text as object, v)
        }
      } catch {
        // skip malformed
      }
    }
    return reply.send(settings)
  })

  // PUT /api/v1/settings/provider/:id — 存 API key (text, 不加密 — Phase D 加 SQLCipher)
  app.put('/provider/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idParse = ProviderIdSchema.safeParse((req.params as Record<string, string>).id)
    if (!idParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown provider' })
    }
    const bodyParse = PutProviderBodySchema.safeParse(req.body)
    if (!bodyParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: bodyParse.error.issues })
    }
    const providerId = idParse.data
    const apiKey = bodyParse.data.apiKey
    const userId = req.user!.id
    const now = Date.now()
    const envKey = `${providerId.toUpperCase()}_API_KEY`
    const value = JSON.stringify({ hasKey: true, envKey, apiKey, updated_at: now })
    sqlite
      .prepare(
        `INSERT INTO user_settings (user_id, category, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, `provider.${providerId}`, value, now)
    return reply.send({ ok: true, hasKey: true, provider: providerId })
  })

  // DELETE /api/v1/settings/provider/:id — 清 key
  app.delete('/provider/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idParse = ProviderIdSchema.safeParse((req.params as Record<string, string>).id)
    if (!idParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown provider' })
    }
    const userId = req.user!.id
    sqlite
      .prepare('DELETE FROM user_settings WHERE user_id = ? AND category = ?')
      .run(userId, `provider.${idParse.data}`)
    return reply.send({ ok: true, hasKey: false, provider: idParse.data })
  })

  // PUT /api/v1/settings/models/text — 存降级链
  app.put('/models/text', { preHandler: [app.authenticate] }, async (req, reply) => {
    const bodyParse = PutTextModelsBodySchema.safeParse(req.body)
    if (!bodyParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: bodyParse.error.issues })
    }
    const userId = req.user!.id
    const now = Date.now()
    const value = JSON.stringify({ chain: bodyParse.data.chain, updated_at: now })
    sqlite
      .prepare(
        `INSERT INTO user_settings (user_id, category, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, category) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(userId, 'models.text', value, now)
    return reply.send({ ok: true, chain: bodyParse.data.chain })
  })

  // POST /api/v1/settings/provider/:id/test — 真测连通 (用 user key 或 fallback env)
  app.post('/provider/:id/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const idParse = ProviderIdSchema.safeParse((req.params as Record<string, string>).id)
    if (!idParse.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', message: 'unknown provider' })
    }
    const userId = req.user!.id
    const providerId = idParse.data
    // 优先 user key, 后备 env
    const row = sqlite
      .prepare('SELECT value FROM user_settings WHERE user_id = ? AND category = ?')
      .get(userId, `provider.${providerId}`) as { value: string } | undefined
    let apiKey: string | null = null
    if (row) {
      try {
        const parsed = JSON.parse(row.value)
        apiKey = parsed.apiKey ?? null
      } catch {
        // ignore
      }
    }
    if (!apiKey && providerId !== 'ollama') {
      const envKey = `${providerId.toUpperCase()}_API_KEY`
      apiKey = process.env[envKey] ?? null
    }
    if (!apiKey && providerId !== 'ollama') {
      return reply.send({ ok: true, healthy: false, latency_ms: 0, error: 'no api key configured' })
    }
    const result = await testProviderConnection(providerId, apiKey)
    return reply.send({ ok: true, ...result })
  })
}

// ====================================================================
// system.ts (3 端点 - 全免鉴权)
// ====================================================================
export async function systemRoutes(app: FastifyInstance) {
  app.get('/status', async (_req, reply) => {
    // Phase 2 (2026-06-17): 深层健康检查 — DB ping + Redis ping
    let dbOk = false
    try {
      sqlite.prepare('SELECT 1').get()
      dbOk = true
    } catch { /* noop */ }

    const redisOk = isRedisConnected() ? await redisPing() : null

    const allOk = dbOk && (redisOk === null || redisOk === true)

    return reply.send({
      status: allOk ? 'ok' : 'degraded',
      version: '0.3.0-p2',
      uptime_sec: Math.floor(process.uptime()),
      checks: {
        database: dbOk ? 'ok' : 'fail',
        redis: redisOk === null ? 'not_configured' : redisOk ? 'ok' : 'fail',
      },
    })
  })
  app.get('/health', async (_req, reply) => {
    // Phase 2 (2026-06-17): 深层健康检查
    let dbOk = false
    try {
      sqlite.prepare('SELECT 1').get()
      dbOk = true
    } catch { /* noop */ }

    const redisOk = isRedisConnected() ? await redisPing() : null

    const allOk = dbOk && (redisOk === null || redisOk === true)
    const code = allOk ? 200 : 503

    return reply.status(code).send({
      status: allOk ? 'ok' : 'degraded',
      checks: {
        database: dbOk ? 'ok' : 'fail',
        redis: redisOk === null ? 'not_configured' : redisOk ? 'ok' : 'fail',
      },
      uptime_sec: Math.floor(process.uptime()),
    })
  })
  app.get('/version', async (_req, reply) => {
    return reply.send({
      version: '0.3.0-p2',
      commit: process.env.GIT_COMMIT ?? 'dev',
      build_time: process.env.BUILD_TIME ?? new Date().toISOString(),
    })
  })
}

// ====================================================================
// workspace.ts (2 端点) — P1: 当前全部 stub，待实现真实工作区文件浏览
// ====================================================================
export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({ root: '/', entries: [] })
  })
  app.get('/*', { preHandler: [app.authenticate] }, async (req, reply) => {
    return reply.send({ path: req.url, entries: [] })
  })
}

// ====================================================================
// secrets.ts (3 端点 - admin only)
// ====================================================================
export async function secretRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    const db = app.sqlite as { prepare: (sql: string) => { all: () => unknown[] } }
    const rows = db.prepare('SELECT name, backend, last_used_at FROM secrets').all()
    return reply.send({ secrets: rows })
  })
  app.post('/', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.send({ ok: true })
  })
  app.delete('/:name', { preHandler: [app.requireAdmin] }, async (_req, reply) => {
    return reply.send({ ok: true })
  })
}
