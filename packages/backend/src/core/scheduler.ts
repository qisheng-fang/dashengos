// packages/backend/src/core/scheduler.ts · Track C.1 (2026-06-17)
// 定时任务调度引擎 — node-cron 驱动
// 支持: cron 表达式 / 一次性定时 / per-user 隔离
//
// 任务类型:
//   - social_publish: 社媒定时发布 (微信/抖音/小红书)
//   - content_generate: AI 内容自动生成
//   - data_collect: 数据采集 (趋势/指标)
//   - report_generate: 日报/周报生成

import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { sqlite } from '../storage/db.js'
import { randomUUID } from 'node:crypto'

export type TriggerType = 'cron' | 'once' | 'interval'
export type AutomationAction = 'social_publish' | 'content_generate' | 'data_collect' | 'report_generate' | 'custom'

export interface AutomationDef {
  id: string
  user_id: string
  name: string
  description: string
  trigger_type: TriggerType
  cron_expr: string | null    // cron: '0 8 * * *', once: ISO timestamp, interval: '15m'
  action: AutomationAction
  params: Record<string, unknown>  // action-specific params
  status: 'active' | 'paused' | 'completed' | 'failed'
  last_run_at: number | null
  next_run_at: number | null
  run_count: number
  created_at: number
  updated_at: number
}

// 内存中的 cron 任务注册表
const runningTasks = new Map<string, ScheduledTask>()

/** 解析 interval 字符串 (如 '15m', '2h', '1d') → cron 表达式 */
function intervalToCron(interval: string): string {
  const match = interval.match(/^(\d+)([smhd])$/)
  if (!match) return '0 0 * * *' // 默认每天午夜
  const [, num, unit] = match
  const n = parseInt(num)
  switch (unit) {
    case 's': return `*/${n} * * * * *`
    case 'm': return n === 1 ? '* * * * *' : `*/${n} * * * *`
    case 'h': return `0 */${n} * * *`
    case 'd': return `0 0 */${n} * *`
    default: return '0 0 * * *'
  }
}

/** 计算下次执行时间 (Unix ms) */
function nextRunMs(triggerType: TriggerType, cronExpr: string | null): number | null {
  if (!cronExpr) return null
  if (triggerType === 'once') {
    const ts = Date.parse(cronExpr)
    return isNaN(ts) ? null : ts
  }
  // cron/interval: 粗略估算 (真正由 node-cron 调度)
  return Date.now() + 60_000 // fallback: 1 分钟后
}

/** 加载并启动所有 active 定时任务 */
export function loadAutomations() {
  const rows = sqlite
    .prepare('SELECT * FROM automations WHERE status = ? AND trigger_type != ?')
    .all('active', 'once') as AutomationDef[]

  for (const row of rows) {
    scheduleAutomation(row)
  }

  // 一次性任务 (trigger_type=once, 过期未跑的也视为 completed)
  const onceRows = sqlite
    .prepare("SELECT * FROM automations WHERE status = 'active' AND trigger_type = 'once'")
    .all() as AutomationDef[]
  for (const row of onceRows) {
    const scheduled = row.cron_expr ? new Date(row.cron_expr).getTime() : 0
    if (scheduled > Date.now()) {
      scheduleAutomation(row) // 未来的, 等触发
    } else {
      // 已过期, 标记 completed
      sqlite.prepare("UPDATE automations SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(Date.now(), row.id)
    }
  }

  console.log(`[scheduler] Loaded ${runningTasks.size} active automations`)
}

/** 注册单个 automation → node-cron */
function scheduleAutomation(automation: AutomationDef) {
  // 防止重复注册
  if (runningTasks.has(automation.id)) {
    runningTasks.get(automation.id)!.stop()
  }

  let cronExpr: string
  if (automation.trigger_type === 'cron' && automation.cron_expr) {
    cronExpr = automation.cron_expr
  } else if (automation.trigger_type === 'interval' && automation.cron_expr) {
    cronExpr = intervalToCron(automation.cron_expr)
  } else if (automation.trigger_type === 'once' && automation.cron_expr) {
    // 一次性: 用 setTimeout 代替 cron
    const delay = new Date(automation.cron_expr).getTime() - Date.now()
    if (delay > 0) {
      const timer = setTimeout(() => executeAutomation(automation), delay)
      // 存一个空 task 到 map 以便清理
      runningTasks.set(automation.id, { stop: () => clearTimeout(timer), start: () => {} } as any)
    }
    return
  } else {
    return // 缺少表达式, 不调度
  }

  if (!cron.validate(cronExpr)) {
    console.warn(`[scheduler] Invalid cron expr for automation ${automation.id}: ${cronExpr}`)
    return
  }

  const task = cron.schedule(cronExpr, () => executeAutomation(automation), {
    timezone: 'Asia/Shanghai',
  })

  runningTasks.set(automation.id, task)
  console.log(`[scheduler] Scheduled "${automation.name}" → ${cronExpr}`)
}

/** 停止并移除 automation */
export function unscheduleAutomation(id: string) {
  const task = runningTasks.get(id)
  if (task) {
    task.stop()
    runningTasks.delete(id)
  }
}

/** 执行 automation — 核心调度逻辑 */
async function executeAutomation(automation: AutomationDef) {
  const startTime = Date.now()
  console.log(`[scheduler] Executing "${automation.name}" (${automation.action})`)

  try {
    switch (automation.action) {
      case 'social_publish':
        await executeSocialPublish(automation)
        break
      case 'content_generate':
        await executeContentGenerate(automation)
        break
      case 'report_generate':
        await executeReportGenerate(automation)
        break
      case 'data_collect':
      case 'custom':
      default:
        await executeCustomAction(automation)
    }

    // 更新状态
    const now = Date.now()
    sqlite.prepare(
      'UPDATE automations SET last_run_at = ?, run_count = run_count + 1, updated_at = ? WHERE id = ?',
    ).run(now, now, automation.id)

    // 一次性任务 → completed
    if (automation.trigger_type === 'once') {
      sqlite.prepare("UPDATE automations SET status = 'completed', updated_at = ? WHERE id = ?")
        .run(now, automation.id)
      unscheduleAutomation(automation.id)
    }

    console.log(`[scheduler] Completed "${automation.name}" in ${Date.now() - startTime}ms`)
  } catch (e: any) {
    console.error(`[scheduler] Failed "${automation.name}": ${e.message}`)
    const now = Date.now()
    sqlite.prepare(
      "UPDATE automations SET status = 'failed', last_run_at = ?, updated_at = ? WHERE id = ?",
    ).run(now, now, automation.id)
    if (automation.trigger_type === 'once') {
      unscheduleAutomation(automation.id)
    }
  }
}

// ===== Action Handlers =====

async function executeSocialPublish(automation: AutomationDef) {
  const { platform, topic } = automation.params as Record<string, string>
  // 调用社会媒体 Agent 执行发布
  // 实际发布需要 worker + cookie，这里记录任务日志
  console.log(`[scheduler] Social publish: ${platform} → ${topic}`)
  // Phase B: 真调 social agent API
  return { platform, topic, status: 'queued' }
}

async function executeContentGenerate(automation: AutomationDef) {
  const { topic, style } = automation.params as Record<string, string>
  console.log(`[scheduler] Content generate: ${topic} (${style})`)
  return { topic, style, status: 'queued' }
}

async function executeReportGenerate(automation: AutomationDef) {
  const { type, platform } = automation.params as Record<string, string>
  console.log(`[scheduler] Report generate: ${type} for ${platform}`)
  return { type, platform, status: 'queued' }
}

async function executeCustomAction(automation: AutomationDef) {
  console.log(`[scheduler] Custom action: ${automation.name}`)
  return { status: 'completed' }
}

/** 创建 automation (DB + 调度) */
export function createAutomation(def: Omit<AutomationDef, 'id' | 'last_run_at' | 'next_run_at' | 'run_count' | 'created_at' | 'updated_at'>): AutomationDef {
  const now = Date.now()
  const id = randomUUID()
  const nextRun = nextRunMs(def.trigger_type, def.cron_expr)

  const automation: AutomationDef = {
    ...def,
    id,
    last_run_at: null,
    next_run_at: nextRun,
    run_count: 0,
    created_at: now,
    updated_at: now,
  }

  sqlite.prepare(
    `INSERT INTO automations (id, user_id, name, description, trigger_type, cron_expr, action, params, status, last_run_at, next_run_at, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    automation.id, automation.user_id, automation.name, automation.description,
    automation.trigger_type, automation.cron_expr, automation.action,
    JSON.stringify(automation.params), automation.status,
    automation.last_run_at, automation.next_run_at, automation.run_count,
    automation.created_at, automation.updated_at,
  )

  if (automation.status === 'active') {
    scheduleAutomation(automation)
  }

  return automation
}

/** 更新 automation */
export function updateAutomation(id: string, updates: Partial<Pick<AutomationDef, 'name' | 'description' | 'cron_expr' | 'params' | 'status'>>) {
  unscheduleAutomation(id)

  const now = Date.now()
  const setClauses: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name) }
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description) }
  if (updates.cron_expr !== undefined) { setClauses.push('cron_expr = ?'); values.push(updates.cron_expr) }
  if (updates.params !== undefined) { setClauses.push('params = ?'); values.push(JSON.stringify(updates.params)) }
  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status) }

  values.push(id)
  sqlite.prepare(`UPDATE automations SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)

  // 重新调度
  const updated = sqlite.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationDef | undefined
  if (updated && updated.status === 'active') {
    scheduleAutomation(updated)
  }
}

/** 删除 automation */
export function deleteAutomation(id: string) {
  unscheduleAutomation(id)
  sqlite.prepare('DELETE FROM automations WHERE id = ?').run(id)
}

/** 列所有 automation */
export function listAutomations(userId?: string): AutomationDef[] {
  if (userId) {
    return sqlite.prepare('SELECT * FROM automations WHERE user_id = ? ORDER BY created_at DESC').all(userId) as AutomationDef[]
  }
  return sqlite.prepare('SELECT * FROM automations ORDER BY created_at DESC').all() as AutomationDef[]
}

/** 获取单个 automation */
export function getAutomation(id: string): AutomationDef | undefined {
  return sqlite.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationDef | undefined
}

/** 手动触发执行 */
export async function triggerAutomation(id: string) {
  const automation = getAutomation(id)
  if (!automation) throw new Error('Automation not found')
  await executeAutomation(automation)
}
