// packages/backend/src/api/orchestrator.ts · Phase B.2
// 多 Agent 编排引擎 API
// POST /execute — 执行工作流
// GET  /templates — 列出模板
// GET  /status/:workflowId — 查询状态
// POST /cancel/:workflowId — 取消执行

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { executeWorkflow, getWorkflowStatus, cancelWorkflow } from '../core/orchestrator.js'
import type { OrchestrationStep } from '../core/orchestrator.js'
import { getTemplates, getTemplate } from '../core/workflow-templates.js'

// ---- 请求体验证 ----

const ExecuteBody = z.object({
  workflow: z.array(z.object({
    id: z.string(),
    agent_id: z.string(),
    mode: z.enum(['pipeline', 'parallel', 'conditional', 'loop', 'debate']),
    condition: z.string().optional(),
    max_iterations: z.number().min(1).max(10).optional(),
    children: z.array(z.any()).optional(),
    input_transform: z.string().optional(),
  })),
  input: z.string().min(1, '输入内容不能为空'),
  template_id: z.string().optional(),  // 可选：使用预置模板
})

const TemplateQuery = z.object({
  category: z.string().optional(),
})

// ---- 路由注册 ----

export async function orchestratorRoutes(app: FastifyInstance) {
  // POST /execute — 执行工作流
  app.post('/execute', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = ExecuteBody.parse(req.body)
    const userId = (req as any).user?.id || 'anonymous'

    let steps: OrchestrationStep[]

    // 如果指定了 template_id，使用模板
    if (body.template_id) {
      const template = getTemplate(body.template_id)
      if (!template) {
        return reply.status(404).send({
          code: 'TEMPLATE_NOT_FOUND',
          message: `模板 '${body.template_id}' 不存在`,
        })
      }
      steps = template.steps
    } else {
      steps = body.workflow as OrchestrationStep[]
    }

    if (!steps || steps.length === 0) {
      return reply.status(400).send({
        code: 'EMPTY_WORKFLOW',
        message: '工作流步骤不能为空',
      })
    }

    try {
      const result = await executeWorkflow(
        steps,
        body.input,
        userId,
        (stepId, status) => {
          app.log.info({ stepId, status, userId }, 'workflow progress')
        },
      )

      // Phase C.1: 自我改进 — 工作流完成后自动反思
      const { reflectOnWorkflow } = await import('../core/self-improve.js')
      reflectOnWorkflow(userId, result.workflow_id, result.steps, result).catch((err) => {
        app.log.warn({ workflowId: result.workflow_id, err: (err as Error).message }, 'reflectOnWorkflow failed')
      })

      return reply.send({
        success: result.status === 'completed',
        data: {
          workflow_id: result.workflow_id,
          status: result.status,
          steps: result.steps.map(s => ({
            step_id: s.step_id,
            agent_id: s.agent_id,
            status: s.status,
            output_preview: s.output?.slice(0, 200),
            tokens_used: s.tokens_used,
            duration_ms: s.duration_ms,
            error: s.error,
          })),
          final_output: result.final_output,
          total_duration_ms: result.total_duration_ms,
          total_tokens: result.total_tokens,
        },
      })
    } catch (e) {
      app.log.error({ err: (e as Error).message }, 'workflow execution failed')
      return reply.status(500).send({
        code: 'WORKFLOW_ERROR',
        message: (e as Error).message,
      })
    }
  })

  // GET /templates — 列出工作流模板
  app.get('/templates', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const query = TemplateQuery.parse(req.query || {})
    let templates = getTemplates()

    if (query.category) {
      templates = templates.filter(t => t.category === query.category)
    }

    return reply.send({
      success: true,
      data: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        icon: t.icon,
        category: t.category,
        estimated_tokens: t.estimated_tokens,
        step_count: t.steps.length,
      })),
    })
  })

  // GET /status/:workflowId — 查询工作流执行状态
  app.get('/status/:workflowId', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workflowId } = req.params as { workflowId: string }
    const wf = getWorkflowStatus(workflowId)

    if (!wf) {
      return reply.status(404).send({
        code: 'WORKFLOW_NOT_FOUND',
        message: `工作流 '${workflowId}' 不存在或已结束`,
      })
    }

    // 计算进度百分比
    const completedSteps = wf.result.steps.filter(s => s.status === 'completed').length
    const totalSteps = wf.result.steps.length
    const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

    return reply.send({
      success: true,
      data: {
        workflow_id: workflowId,
        status: wf.result.status,
        progress,
        steps: wf.result.steps.map(s => ({
          step_id: s.step_id,
          agent_id: s.agent_id,
          status: s.status,
          duration_ms: s.duration_ms,
          error: s.error,
        })),
      },
    })
  })

  // POST /cancel/:workflowId — 取消执行中的工作流
  app.post('/cancel/:workflowId', { preHandler: [app.authenticate] }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { workflowId } = req.params as { workflowId: string }
    const cancelled = cancelWorkflow(workflowId)

    if (!cancelled) {
      return reply.status(404).send({
        code: 'WORKFLOW_NOT_FOUND',
        message: `工作流 '${workflowId}' 不存在或已结束`,
      })
    }

    return reply.send({
      success: true,
      message: `工作流 '${workflowId}' 已标记取消`,
    })
  })
}

  // ★ v8.3: Agent Health endpoints
  app.get('/health', { preHandler: [app.authenticate] }, async () => {
    const { agentHealth } = await import('../core/agent-health.js')
    return { summary: agentHealth.getSummary(), agents: agentHealth.getAll(), checkedAt: Date.now() }
  })

  app.get('/health/:agentId', { preHandler: [app.authenticate] }, async (req) => {
    const { agentHealth } = await import('../core/agent-health.js')
    const { agentId } = req.params as { agentId: string }
    const agent = agentHealth.getAgent(agentId)
    if (!agent) return { status: 'not_found', agentId }
    return { agent, checkedAt: Date.now() }
  })

  app.post('/health/register', { preHandler: [app.authenticate] }, async (req) => {
    const { agentHealth } = await import('../core/agent-health.js')
    const { agentId, name, type, capabilities, endpoint } = req.body as any
    if (!agentId || !name || !type) return { error: 'agentId, name, and type are required' }
    const record = agentHealth.register(agentId, name, type, capabilities || [], endpoint)
    return { registered: true, agent: record }
  })

  app.post('/health/heartbeat/:agentId', { preHandler: [app.authenticate] }, async (req) => {
    const { agentHealth } = await import('../core/agent-health.js')
    const { agentId } = req.params as { agentId: string }
    const ok = agentHealth.heartbeat(agentId)
    return { ack: ok, agentId, timestamp: Date.now() }
  })

  // ★ v8.3: Agent Bus endpoints
  app.get('/bus/stats', { preHandler: [app.authenticate] }, async () => {
    const { agentBus } = await import('../core/agent-bus.js')
    return agentBus.getStats()
  })

  app.get('/bus/history', { preHandler: [app.authenticate] }, async (req) => {
    const { agentBus } = await import('../core/agent-bus.js')
    const topic = (req.query as any).topic as string | undefined
    return { messages: agentBus.getHistory(topic) }
  })

  app.post('/bus/publish', { preHandler: [app.authenticate] }, async (req) => {
    const { agentBus } = await import('../core/agent-bus.js')
    const { source, topic, payload, target } = req.body as any
    const id = agentBus.publish(source || 'api', topic || 'custom', payload || {}, target || '*')
    return { published: true, messageId: id }
  })
