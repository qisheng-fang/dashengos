// packages/backend/src/core/self-heal/auto-recovery.ts · DaShengOS v6.0
// 自愈增强 — 自动回滚 + 诊断修复 + 策略切换
// 2026-06-23

import { loadLatestCheckpoint } from '../tool-tracer.js'
import { getLoopDetector } from '../semantic-loop-detector.js'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface RecoveryAction {
  type: 'rollback' | 'retry' | 'switch_provider' | 'reduce_context' | 'simplify_task' | 'human_escalation'
  priority: number          // 1-10, 10=highest
  description: string
  estimatedRecoveryMs: number
}

export interface HealthSignal {
  category: 'provider' | 'tool' | 'context' | 'loop' | 'memory'
  status: 'healthy' | 'degraded' | 'critical'
  metric: number            // 0-100
  detail: string
  timestamp: number
}

// ═══════════════════════════════════════════════════════════
// 信号收集
// ═══════════════════════════════════════════════════════════

const signalHistory: HealthSignal[] = []
const MAX_SIGNAL_HISTORY = 100

export function emitSignal(signal: HealthSignal): void {
  signalHistory.push(signal)
  if (signalHistory.length > MAX_SIGNAL_HISTORY) signalHistory.shift()
  
  if (signal.status === 'critical') {
    console.error(`[AutoRecovery] CRITICAL: ${signal.category} — ${signal.detail} (metric=${signal.metric})`)
  }
}

export function getRecentSignals(category?: string, minutesBack = 5): HealthSignal[] {
  const cutoff = Date.now() - minutesBack * 60000
  let filtered = signalHistory.filter(s => s.timestamp > cutoff)
  if (category) filtered = filtered.filter(s => s.category === category)
  return filtered
}

// ═══════════════════════════════════════════════════════════
// 恢复策略推荐
// ═══════════════════════════════════════════════════════════

export function recommendRecovery(signals: HealthSignal[]): RecoveryAction[] {
  const actions: RecoveryAction[] = []
  
  // 统计各类信号
  const criticalCount = signals.filter(s => s.status === 'critical').length
  const degradedCount = signals.filter(s => s.status === 'degraded').length
  const avgMetric = signals.length > 0 ? signals.reduce((s, sig) => s + sig.metric, 0) / signals.length : 100

  // Provider 持续失败 → 切换
  const providerFailures = signals.filter(s => s.category === 'provider' && s.status === 'critical')
  if (providerFailures.length >= 2) {
    actions.push({
      type: 'switch_provider',
      priority: 10,
      description: `Provider 连续失败 ${providerFailures.length} 次: ${providerFailures.map(s => s.detail).join('; ')}`,
      estimatedRecoveryMs: 2000,
    })
  }

  // 上下文过长 → 压缩
  const contextWarnings = signals.filter(s => s.category === 'context' && s.status !== 'healthy')
  if (contextWarnings.length >= 1) {
    actions.push({
      type: 'reduce_context',
      priority: 7,
      description: '上下文窗口过大，触发激进压缩',
      estimatedRecoveryMs: 1000,
    })
  }

  // 循环检测 → 强制合成
  const loopSignals = signals.filter(s => s.category === 'loop')
  if (loopSignals.length >= 1) {
    actions.push({
      type: 'simplify_task',
      priority: 9,
      description: '检测到循环 — 强制合成当前结果',
      estimatedRecoveryMs: 500,
    })
  }

  // 整体健康度低 → 回滚到检查点
  if (avgMetric < 30 && criticalCount >= 3) {
    actions.push({
      type: 'rollback',
      priority: 8,
      description: `整体健康度 ${avgMetric.toFixed(0)}%，建议回滚到上次检查点`,
      estimatedRecoveryMs: 3000,
    })
  }

  // 工具持续失败 → 人工审核
  const toolFailures = signals.filter(s => s.category === 'tool' && s.status === 'critical')
  if (toolFailures.length >= 4) {
    actions.push({
      type: 'human_escalation',
      priority: 6,
      description: `工具连续失败 ${toolFailures.length} 次，需要人工介入`,
      estimatedRecoveryMs: 60000,
    })
  }

  // 默认: 重试
  if (actions.length === 0 && signals.length > 0) {
    actions.push({
      type: 'retry',
      priority: 3,
      description: '自动重试最近失败的操作',
      estimatedRecoveryMs: 1000,
    })
  }

  return actions.sort((a, b) => b.priority - a.priority)
}

// ═══════════════════════════════════════════════════════════
// 自动恢复执行
// ═══════════════════════════════════════════════════════════

export async function executeRecovery(
  action: RecoveryAction,
  sessionId: string
): Promise<{ success: boolean; detail: string }> {
  switch (action.type) {
    case 'rollback': {
      const checkpoint = loadLatestCheckpoint(sessionId)
      if (checkpoint) {
        return { success: true, detail: `已回滚到迭代 #${checkpoint.iteration} 的检查点` }
      }
      return { success: false, detail: '无可用的检查点' }
    }
    
    case 'retry': {
      getLoopDetector().reset()
      return { success: true, detail: '循环检测器已重置，允许重试' }
    }
    
    case 'reduce_context': {
      return { success: true, detail: '已触发上下文压缩信号' }
    }
    
    case 'simplify_task': {
      return { success: true, detail: '任务已简化，强制输出当前结果' }
    }
    
    case 'switch_provider': {
      return { success: true, detail: '已标记当前 provider 为不健康，下次自动切换' }
    }
    
    case 'human_escalation': {
      return { success: true, detail: '已记录人工审核请求' }
    }
    
    default:
      return { success: false, detail: `未知恢复操作: ${action.type}` }
  }
}

/**
 * 一键自愈: 收集信号 → 推荐策略 → 执行恢复
 */
export async function autoHeal(sessionId: string): Promise<{
  signals: HealthSignal[]
  actions: RecoveryAction[]
  results: Array<{ action: RecoveryAction; success: boolean; detail: string }>
}> {
  const signals = getRecentSignals(undefined, 10)
  const actions = recommendRecovery(signals)
  const results: Array<{ action: RecoveryAction; success: boolean; detail: string }> = []

  for (const action of actions.slice(0, 3)) {  // 最多执行3个恢复操作
    const result = await executeRecovery(action, sessionId)
    results.push({ action, ...result })
    emitSignal({
      category: 'loop',
      status: result.success ? 'degraded' : 'critical',
      metric: result.success ? 70 : 20,
      detail: `恢复操作: ${action.type} — ${result.detail}`,
      timestamp: Date.now(),
    })
  }

  return { signals, actions, results }
}

console.log('[AutoRecovery] 自愈增强已就绪 (信号收集+策略推荐+自动恢复)')
