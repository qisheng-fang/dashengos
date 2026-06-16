// packages/backend/src/api/sessions.ts · v0.3 spec §10 (5 端点)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'

const CreateSessionSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  agent_id: z.string().min(1),
  model: z.string().min(1),
  skills: z.array(z.string()).default([]),
})

const ListSessionsSchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

const SendMessageSchema = z.object({
  content: z.string().min(1).max(100_000),
  model: z.string().optional(),
  attachments: z.array(z.string()).default([]),
  stream: z.boolean().default(false),
})

export async function sessionRoutes(app: FastifyInstance) {
  // POST /sessions
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = CreateSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    }
    const id = ulid()
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO sessions (id, user_id, agent_id, title, model, status, token_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`,
      )
      .run(id, req.user!.id, parsed.data.agent_id, parsed.data.title ?? '新会话', parsed.data.model, now, now)
    return reply.code(201).send({ id, title: parsed.data.title ?? '新会话', status: 'ACTIVE' })
  })

  // GET /sessions
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ListSessionsSchema.safeParse(req.query)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const rows = sqlite
      .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(req.user!.id, parsed.data.limit)
    return reply.send({ sessions: rows })
  })

  // GET /sessions/:id
  // Phase B.2 (2026-06-16) 加 user_id 过滤防越权, 错返 404 避免 ID 枚举探测
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id
    const row = sqlite
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(id, userId)
    if (!row) return reply.code(404).send({ code: 'SESSION_NOT_FOUND' })
    return reply.send(row)
  })

  // POST /sessions/:id/messages
  //   Phase 9: 当 DEERFLOW_ENABLED=false, 直接调 Ollama (走 /api/chat)
  //           存 user + assistant 两条 messages 到 messages 表
  //           返 assistant message + session 信息
  app.post('/:id/messages', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = SendMessageSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ code: 'VALIDATION_FAILED' })
    const { id } = req.params as { id: string }
    const now = Date.now()
    const model = parsed.data.model || config.DEFAULT_MODEL

    // 1) 存 user 消息
    const userMsgId = ulid()
    sqlite
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, model, token_in, token_out, finish_reason, created_at)
         VALUES (?, ?, 'USER', ?, ?, NULL, NULL, NULL, ?)`,
      )
      .run(userMsgId, id, parsed.data.content, model, now)

    // 2) 拿 session 历史 messages (按时间序)
    const history = sqlite
      .prepare(`SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC`)
      .all(id) as Array<{ role: string; content: string }>
    const ollamaMessages = history.map((m) => ({ role: m.role.toLowerCase() as 'user' | 'assistant' | 'system', content: m.content }))

    // 3) DEERFLOW_ENABLED=false 时直接调 LLM (ollama 本地 / siliconflow / deepseek, Track D.1)
    if (!config.DEERFLOW_ENABLED) {
      // 取 session 关联的 model (e.g. "ollama:qwen2.5:3b" / "siliconflow:Qwen/Qwen2.5-72B-Instruct")
      const sessionRow = sqlite.prepare('SELECT model FROM sessions WHERE id = ?').get(id) as
        | { model: string }
        | undefined
      const useModel = sessionRow?.model || model

      // === Ollama 本地 ===
      if (useModel.startsWith('ollama:')) {
        const ollamaModel = useModel.replace(/^ollama:/, '')
        try {
          const res = await fetch(`${config.OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: ollamaModel, messages: ollamaMessages, stream: false }),
            signal: AbortSignal.timeout(300_000),
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            return reply.code(502).send({ code: 'OLLAMA_UPSTREAM_FAILED', status: res.status, message: errText.slice(0, 500) })
          }
          const json = (await res.json()) as {
            message: { role: string; content: string }
            prompt_eval_count?: number
            eval_count?: number
          }
          // 4) 存 assistant 消息
          const assistantMsgId = ulid()
          sqlite
            .prepare(
              `INSERT INTO messages (id, session_id, role, content, model, token_in, token_out, finish_reason, created_at)
               VALUES (?, ?, 'ASSISTANT', ?, ?, ?, ?, 'stop', ?)`,
            )
            .run(assistantMsgId, id, json.message.content, ollamaModel, json.prompt_eval_count ?? 0, json.eval_count ?? 0, now)
          // 5) 更新 session 的 token_count + updated_at
          sqlite
            .prepare('UPDATE sessions SET token_count = token_count + ?, updated_at = ? WHERE id = ?')
            .run((json.prompt_eval_count ?? 0) + (json.eval_count ?? 0), now, id)

          return reply.send({
            session_id: id,
            message_id: assistantMsgId,
            content: json.message.content,
            role: 'ASSISTANT',
            model: ollamaModel,
            timestamp: now,
            usage: {
              prompt_tokens: json.prompt_eval_count ?? 0,
              completion_tokens: json.eval_count ?? 0,
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
      if (useModel.startsWith('siliconflow:')) {
        if (!config.SILICONFLOW_API_KEY) {
          return reply.code(400).send({
            code: 'SILICONFLOW_KEY_MISSING',
            message: '改 packages/backend/.env 设 SILICONFLOW_API_KEY=sk-... 然后重启 backend',
          })
        }
        const sfModel = useModel.replace(/^siliconflow:/, '') || config.SILICONFLOW_DEFAULT_MODEL
        try {
          const res = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
            },
            body: JSON.stringify({
              model: sfModel,
              messages: ollamaMessages,
              stream: false,
              temperature: 0.7,
            }),
            signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            return reply.code(502).send({
              code: 'SILICONFLOW_UPSTREAM_FAILED',
              status: res.status,
              message: errText.slice(0, 500),
            })
          }
          const json = (await res.json()) as {
            model: string
            choices: Array<{ message: { role: string; content: string } }>
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
          }
          const content = json.choices?.[0]?.message?.content ?? ''
          // 存 assistant 消息
          const assistantMsgId = ulid()
          sqlite
            .prepare(
              `INSERT INTO messages (id, session_id, role, content, model, token_in, token_out, finish_reason, created_at)
               VALUES (?, ?, 'ASSISTANT', ?, ?, ?, ?, 'stop', ?)`,
            )
            .run(
              assistantMsgId,
              id,
              content,
              sfModel,
              json.usage?.prompt_tokens ?? 0,
              json.usage?.completion_tokens ?? 0,
              now,
            )
          sqlite
            .prepare('UPDATE sessions SET token_count = token_count + ?, updated_at = ? WHERE id = ?')
            .run((json.usage?.total_tokens ?? 0), now, id)
          return reply.send({
            session_id: id,
            message_id: assistantMsgId,
            content,
            role: 'ASSISTANT',
            model: sfModel,
            timestamp: now,
            usage: {
              prompt_tokens: json.usage?.prompt_tokens ?? 0,
              completion_tokens: json.usage?.completion_tokens ?? 0,
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
      if (useModel.startsWith('deepseek:')) {
        if (!config.DEEPSEEK_API_KEY) {
          return reply.code(400).send({
            code: 'DEEPSEEK_KEY_MISSING',
            message: '改 packages/backend/.env 设 DEEPSEEK_API_KEY=sk-... 然后重启 backend',
          })
        }
        const dsModel = useModel.replace(/^deepseek:/, '') || config.DEEPSEEK_MODEL
        try {
          const res = await fetch(`${config.DEEPSEEK_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
              model: dsModel,
              messages: ollamaMessages,
              stream: false,
              temperature: 0.7,
            }),
            signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            return reply.code(502).send({
              code: 'DEEPSEEK_UPSTREAM_FAILED',
              status: res.status,
              message: errText.slice(0, 500),
            })
          }
          const json = (await res.json()) as {
            model: string
            choices: Array<{ message: { role: string; content: string } }>
            usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
          }
          const content = json.choices?.[0]?.message?.content ?? ''
          const assistantMsgId = ulid()
          sqlite
            .prepare(
              `INSERT INTO messages (id, session_id, role, content, model, token_in, token_out, finish_reason, created_at)
               VALUES (?, ?, 'ASSISTANT', ?, ?, ?, ?, 'stop', ?)`,
            )
            .run(assistantMsgId, id, content, dsModel, json.usage?.prompt_tokens ?? 0, json.usage?.completion_tokens ?? 0, now)
          sqlite
            .prepare('UPDATE sessions SET token_count = token_count + ?, updated_at = ? WHERE id = ?')
            .run((json.usage?.total_tokens ?? 0), now, id)
          return reply.send({
            session_id: id,
            message_id: assistantMsgId,
            content,
            role: 'ASSISTANT',
            model: dsModel,
            timestamp: now,
            usage: {
              prompt_tokens: json.usage?.prompt_tokens ?? 0,
              completion_tokens: json.usage?.completion_tokens ?? 0,
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

      // 都不匹配
      return reply.code(400).send({
        code: 'UNSUPPORTED_MODEL',
        message: 'session model must start with ollama: / siliconflow: / deepseek:',
        received: useModel,
      })
    }

    // DEERFLOW_ENABLED=true 时的 stub (Phase 8 留)
    return reply.send({
      session_id: id,
      message_id: ulid(),
      content: '(stub) DeerFlow 流式返回, Phase 8 实装',
      timestamp: now,
    })
  })

  // POST /sessions/:id/abort
  // Phase B.2 (2026-06-16) 加 user_id 限定, 错返 404
  app.post('/:id/abort', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user!.id
    const res = sqlite
      .prepare("UPDATE sessions SET status = 'ABORTED', updated_at = ? WHERE id = ? AND user_id = ?")
      .run(Date.now(), id, userId)
    if (res.changes === 0) {
      return reply.code(404).send({ code: 'SESSION_NOT_FOUND' })
    }
    return reply.send({ id, status: 'ABORTED' })
  })
}
