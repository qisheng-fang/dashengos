/**
 * Self-Heal API Routes
 * 
 * 端点：
 * POST /api/v1/health/diagnose - 触发系统诊断
 * GET  /api/v1/health/quick   - 快速健康检查
 * GET  /api/v1/heal/pending   - 获取待确认操作（轮询）
 * POST /api/v1/heal/approve   - 批准操作
 * POST /api/v1/heal/reject     - 拒绝操作
 * GET  /api/v1/heal/config     - 获取确认门配置
 * POST /api/v1/heal/config     - 更新确认门配置
 */

import type { FastifyInstance } from 'fastify'
import { runDiagnostics, quickHealthCheck } from '../core/self-heal/diagnostics.js'
import {
  getPendingActions,
  approveAction,
  rejectAction,
  getGateConfig,
  updateGateConfig,
} from '../core/self-heal/gate.js'
import { audit } from '../core/audit.js'

export async function selfHealRoutes(app: FastifyInstance) {

  /**
   * POST /api/v1/health/diagnose
   * 触发完整系统诊断
   */
  app.post('/health/diagnose', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.id || 'unknown'
      const { workspaceDir, logPath, portsToCheck } = req.body

      console.log(`[API] 用户 ${userId} 触发系统诊断`)

      const result = await runDiagnostics({
        workspaceDir,
        logPath,
        portsToCheck,
      })

      // 记录审计
      audit.log({
        type: 'api.call',
        severity: result.healthy ? 'INFO' : 'WARN',
        action: 'health_diagnose',
        user_id: userId,
        target: 'system',
        result_summary: `healthy=${result.healthy}, errors=${result.errors.length}`,
      })

      return {
        success: true,
        diagnostics: result,
      }
    } catch (err: any) {
      console.error('[API] 系统诊断失败:', err)
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })

  /**
   * GET /api/v1/health/quick
   * 快速健康检查（给监控用）
   */
  app.get('/health/quick', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const { workspaceDir } = req.query
      const result = await quickHealthCheck(workspaceDir as string | undefined)

      return {
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        ok: false,
        error: err.message,
      })
    }
  })

  /**
   * GET /api/v1/heal/pending
   * 获取待确认操作（前端轮询此端点）
   */
  app.get('/heal/pending', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.id || 'unknown'
      const { sessionId } = req.query

      const pendingActions = getPendingActions(userId, sessionId as string | undefined)

      return {
        success: true,
        pending: pendingActions,
        count: pendingActions.length,
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })

  /**
   * POST /api/v1/heal/approve
   * 批准操作
   */
  app.post('/heal/approve', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.id || 'unknown'
      const { pendingId } = req.body

      if (!pendingId) {
        return reply.status(400).send({
          success: false,
          error: 'missing pendingId',
        })
      }

      const { success, action, message } = await approveAction(pendingId)

      if (success && action) {
        audit.log({
          type: 'api.call',
          severity: 'INFO',
          action: 'heal_approve',
          user_id: userId,
          target: 'pending_action',
          args_json: JSON.stringify({ action: action.action, description: action.description }),
        })

        return {
          success: true,
          message,
          action,
        }
      } else {
        return reply.status(400).send({
          success: false,
          error: message,
        })
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })

  /**
   * POST /api/v1/heal/reject
   * 拒绝操作
   */
  app.post('/heal/reject', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.id || 'unknown'
      const { pendingId, reason } = req.body

      if (!pendingId) {
        return reply.status(400).send({
          success: false,
          error: 'missing pendingId',
        })
      }

      const { success, message } = await rejectAction(pendingId, reason)

      if (success) {
        audit.log({
          type: 'api.call',
          severity: 'INFO',
          action: 'heal_reject',
          user_id: userId,
          target: 'pending_action',
          args_json: JSON.stringify({ reason }),
        })

        return {
          success: true,
          message,
        }
      } else {
        return reply.status(400).send({
          success: false,
          error: message,
        })
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })

  /**
   * GET /api/v1/heal/config
   * 获取确认门配置
   */
  app.get('/heal/config', { preHandler: [app.authenticate] }, async (_req: any, reply: any) => {
    try {
      const config = getGateConfig()

      return {
        success: true,
        config,
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })

  /**
   * POST /api/v1/heal/config
   * 更新确认门配置（需要管理员权限）
   */
  app.post('/heal/config', { preHandler: [app.authenticate] }, async (req: any, reply: any) => {
    try {
      const userId = req.user?.sub || req.user?.id || 'unknown'
      const { enabled, elevatedMode, autoApproveLowRisk, pendingTTLMinutes } = req.body

      updateGateConfig({
        enabled,
        elevatedMode,
        autoApproveLowRisk,
        pendingTTLMinutes,
      })

      audit.log({
        type: 'api.call',
        severity: 'WARN',
        action: 'heal_config_update',
        user_id: userId,
        target: 'confirmation_gate',
        args_json: JSON.stringify({ enabled, elevatedMode, autoApproveLowRisk }),
      })

      return {
        success: true,
        message: '配置已更新',
        config: getGateConfig(),
      }
    } catch (err: any) {
      reply.status(500).send({
        success: false,
        error: err.message,
      })
    }
  })
}
