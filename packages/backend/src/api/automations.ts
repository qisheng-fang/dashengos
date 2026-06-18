// packages/backend/src/api/automations.ts · Track C.1 (2026-06-17)
// 定时任务 CRUD + 手动触发
// 前缀: /api/v1/automations

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { createAutomation, updateAutomation, deleteAutomation, listAutomations, getAutomation, triggerAutomation } from '../core/scheduler.js'

const CreateAutomationSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).default(''),
  trigger_type: z.enum(['cron', 'once', 'interval']),
  cron_expr: z.string().nullable().default(null),
  action: z.enum(['social_publish', 'content_generate', 'data_collect', 'report_generate', 'custom']),
  params: z.record(z.string(), z.any()).default({}),
  status: z.enum(['active', 'paused']).default('active'),
})

const UpdateAutomationSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  cron_expr: z.string().nullable().optional(),
  params: z.record(z.string(), z.any()).optional(),
  status: z.enum(['active', 'paused']).optional(),
})

export async function automationRoutes(app: FastifyInstance) {
  // GET / — 列所有自动化
  app.get('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const automations = listAutomations(req.user!.id)
    return reply.send({
      automations: automations.map((a) => ({
        ...a,
        params: typeof a.params === 'string' ? JSON.parse(a.params) : a.params,
      })),
      count: automations.length,
    })
  })

  // GET /:id — 单个详情
  app.get('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const a = getAutomation(id)
    if (!a || a.user_id !== req.user!.id) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Automation not found' })
    }
    return reply.send({
      ...a,
      params: typeof a.params === 'string' ? JSON.parse(a.params) : a.params,
    })
  })

  // POST / — 创建
  app.post('/', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = CreateAutomationSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }
    const automation = createAutomation({
      user_id: req.user!.id,
      ...parsed.data,
      cron_expr: parsed.data.cron_expr ?? null,
    })
    return reply.code(201).send({
      ...automation,
      params: typeof automation.params === 'string' ? JSON.parse(automation.params) : automation.params,
    })
  })

  // PUT /:id — 更新
  app.put('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = getAutomation(id)
    if (!existing || existing.user_id !== req.user!.id) {
      return reply.code(404).send({ code: 'NOT_FOUND' })
    }
    const parsed = UpdateAutomationSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({ code: 'VALIDATION_FAILED', details: parsed.error.issues })
    }
    updateAutomation(id, parsed.data)
    return reply.send({ ok: true, id })
  })

  // DELETE /:id — 删除
  app.delete('/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = getAutomation(id)
    if (!existing || existing.user_id !== req.user!.id) {
      return reply.code(404).send({ code: 'NOT_FOUND' })
    }
    deleteAutomation(id)
    return reply.send({ ok: true, id })
  })

  // POST /:id/trigger — 手动触发
  app.post('/:id/trigger', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const existing = getAutomation(id)
    if (!existing || existing.user_id !== req.user!.id) {
      return reply.code(404).send({ code: 'NOT_FOUND' })
    }
    try {
      await triggerAutomation(id)
      return reply.send({ ok: true, id, triggered: true })
    } catch (e: any) {
      return reply.code(500).send({ code: 'TRIGGER_FAILED', message: e.message })
    }
  })
}
