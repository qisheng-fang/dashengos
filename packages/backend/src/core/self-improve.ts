// packages/backend/src/core/self-improve.ts · Phase C.1 自我改进引擎
//
// 核心功能:
//   1. reflectOnSession — 分析完成的会话, 用 LLM 生成反思和经验教训
//   2. suggestImprovements — 搜索历史学习记录, 返回适用建议
//   3. extractPattern — 发现重复的成功模式
//   4. getLearningStats — 聚合统计
//   5. autoOptimize — 用历史经验优化 prompt
//   6. reflectOnWorkflow — 编排工作流完成后反思

import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'

// ---- 类型定义 ----

export interface LearningEntry {
  id: string
  user_id: string
  session_id?: string
  agent_id: string
  task_type: string
  reflection: string
  lessons: string[]
  pattern?: string
  success_rating: number
  tokens_saved: number
  created_at: number
}

export interface Pattern {
  task_type: string
  pattern: string
  success_rate: number
  usage_count: number
}

export interface LearningStats {
  total_reflections: number
  avg_rating: number
  top_lessons: Array<{ lesson: string; count: number }>
  learnings_by_type: Record<string, number>
  total_tokens_saved: number
}

export interface OrchestrationStepResult {
  step_id: string
  agent_id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: string
  tokens_used?: number
  duration_ms: number
  error?: string
}

export interface OrchestrationResult {
  workflow_id: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  steps: OrchestrationStepResult[]
  final_output?: string
  total_duration_ms: number
  total_tokens: number
}

// ---- LLM reflection helper ----

interface ReflectionOutput {
  task_type: string
  reflection: string
  lessons: string[]
  success_rating: number
  pattern?: string
}

async function callLLMForReflection(
  userMessages: string,
  sessionTitle: string,
): Promise<ReflectionOutput> {
  // 优先使用 SiliconFlow, 否则用关键词 fallback
  if (config.SILICONFLOW_API_KEY) {
    try {
      const resp = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.SILICONFLOW_API_KEY}`,
        },
        body: JSON.stringify({
          model: config.SILICONFLOW_DEFAULT_MODEL,
          messages: [
            {
              role: 'system',
              content: `你是自我改进分析器。分析以下会话内容，输出 JSON (不要 markdown 包裹):
{
  "task_type": "research|content|code|social|general",
  "reflection": "1-2句中文反思: 哪些做得好? 哪些能改进?",
  "lessons": ["3-5条中文经验教训,每条不超过20字"],
  "success_rating": 0.0-1.0,
  "pattern": "如果有可复用的模式或模板, 用中文描述; 否则null"
}
只输出 JSON, 不要其他文字。`,
            },
            {
              role: 'user',
              content: `会话标题: ${sessionTitle}\n\n会话内容摘要:\n${userMessages.slice(0, 3000)}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(20_000),
      })

      if (resp.ok) {
        const data = (await resp.json()) as { choices: Array<{ message: { content: string } }> }
        const content = data.choices?.[0]?.message?.content || ''
        // 尝试提取 JSON (可能被 markdown 包裹)
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          return {
            task_type: parsed.task_type || 'general',
            reflection: parsed.reflection || '',
            lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
            success_rating: typeof parsed.success_rating === 'number'
              ? Math.max(0, Math.min(1, parsed.success_rating))
              : 0.5,
            pattern: parsed.pattern || undefined,
          }
        }
      }
    } catch {
      // LLM 调用失败, 回退到关键词匹配
    }
  }

  // 关键词 fallback
  return keywordFallbackReflection(userMessages, sessionTitle)
}

function keywordFallbackReflection(
  userMessages: string,
  sessionTitle: string,
): ReflectionOutput {
  const lower = (userMessages + sessionTitle).toLowerCase()
  const lessons: string[] = []

  // 根据内容推断 task_type
  let taskType = 'general'
  if (lower.includes('research') || lower.includes('研究') || lower.includes('调研') || lower.includes('分析数据')) {
    taskType = 'research'
  }
  if (lower.includes('写') || lower.includes('文章') || lower.includes('内容') || lower.includes('创作')) {
    taskType = 'content'
  }
  if (lower.includes('代码') || lower.includes('code') || lower.includes('编程') || lower.includes('bug')) {
    taskType = 'code'
  }
  if (lower.includes('抖音') || lower.includes('小红书') || lower.includes('社交') || lower.includes('social')) {
    taskType = 'social'
  }

  // 关键词经验提取
  if (lower.includes('错误') || lower.includes('失败') || lower.includes('error')) {
    lessons.push('遇到错误先检查输入参数')
  }
  if (lower.includes('太长') || lower.includes('篇幅') || lower.includes('too long')) {
    lessons.push('控制输出长度, 分段回复更清晰')
  }
  if (lower.includes('重试') || lower.includes('retry') || lower.includes('超时')) {
    lessons.push('超时操作增加重试和 fallback')
  }
  if (lower.includes('数据') || lower.includes('data') || lower.includes('源')) {
    lessons.push('先验证数据源再进行分析')
  }
  lessons.push('任务结束后记录关键决策和结果')
  lessons.push('复杂任务先拆解为子步骤再逐一处理')

  // 估算成功率 (基于是否有错误关键词)
  const hasError = lower.includes('错误') || lower.includes('失败') || lower.includes('error') || lower.includes('fail')
  const hasGood = lower.includes('完成') || lower.includes('成功') || lower.includes('good') || lower.includes('done')
  const rating = hasError ? (hasGood ? 0.6 : 0.3) : (hasGood ? 0.85 : 0.5)

  return {
    task_type: taskType,
    reflection: `关键词分析: ${hasError ? '遇到一些困难,' : ''}${hasGood ? '任务顺利完成' : '任务基本完成'}`,
    lessons: lessons.slice(0, 5),
    success_rating: rating,
  }
}

// ---- 核心函数 ----

/**
 * 分析完成的会话, 生成反思和学习记录
 */
export async function reflectOnSession(sessionId: string): Promise<LearningEntry | null> {
  // 1) 获取 session 信息
  const session = sqlite
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(sessionId) as { id: string; user_id: string; agent_id: string; title: string } | undefined

  if (!session) return null

  // 2) 获取会话消息
  const messages = sqlite
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 50')
    .all(sessionId) as Array<{ role: string; content: string }>

  const userMessages = messages
    .filter((m) => m.role === 'USER')
    .map((m) => m.content)
    .join('\n')

  // 如果没有用户消息, 跳过
  if (!userMessages.trim()) return null

  // 3) 调 LLM 生成反思 (或 fallback)
  const reflection = await callLLMForReflection(userMessages, session.title)

  // 4) 检查是否已有此会话的学习记录 (去重)
  const existing = sqlite
    .prepare('SELECT id FROM agent_learnings WHERE session_id = ?')
    .get(sessionId)
  if (existing) return null

  // 5) 写入学习记录
  const id = ulid()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO agent_learnings (id, user_id, session_id, agent_id, task_type, reflection, lessons, pattern, success_rating, tokens_saved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      session.user_id,
      sessionId,
      session.agent_id,
      reflection.task_type,
      reflection.reflection,
      JSON.stringify(reflection.lessons),
      reflection.pattern || null,
      reflection.success_rating,
      now,
    )

  return {
    id,
    user_id: session.user_id,
    session_id: sessionId,
    agent_id: session.agent_id,
    task_type: reflection.task_type,
    reflection: reflection.reflection,
    lessons: reflection.lessons,
    pattern: reflection.pattern,
    success_rating: reflection.success_rating,
    tokens_saved: 0,
    created_at: now,
  }
}

/**
 * 根据任务类型搜索历史经验, 返回适用建议
 */
export async function suggestImprovements(
  userId: string,
  taskType: string,
  input?: string,
): Promise<string[]> {
  // 搜索同类型历史学习记录, 按 success_rating 降序
  const rows = sqlite
    .prepare(
      `SELECT lessons, success_rating FROM agent_learnings
       WHERE user_id = ? AND task_type = ?
       ORDER BY created_at DESC LIMIT 10`,
    )
    .all(userId, taskType) as Array<{ lessons: string; success_rating: number }>

  if (rows.length === 0) return []

  // 收集所有 lessons, 去重
  const lessonMap = new Map<string, number>()
  for (const row of rows) {
    try {
      const lessons: string[] = JSON.parse(row.lessons)
      for (const lesson of lessons) {
        lessonMap.set(lesson, (lessonMap.get(lesson) || 0) + 1)
      }
    } catch {
      // ignore malformed JSON
    }
  }

  // 按出现次数排序, 返回 top 5
  const sorted = [...lessonMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lesson]) => lesson)

  // 如果提供了新输入, 用简单关键词匹配过滤
  if (input) {
    const lower = input.toLowerCase()
    return sorted.filter((lesson) => {
      // 检查 lesson 关键词是否出现在输入中
      const keywords = lesson.split(/[，,、\s]+/)
      return keywords.some((kw) => lower.includes(kw))
    })
  }

  return sorted
}

/**
 * 发现重复成功的模式
 */
export async function extractPattern(
  userId: string,
  taskType: string,
  minOccurrences = 3,
): Promise<Pattern | null> {
  // 查询同类型高评分学习记录
  const rows = sqlite
    .prepare(
      `SELECT pattern, success_rating FROM agent_learnings
       WHERE user_id = ? AND task_type = ? AND pattern IS NOT NULL AND pattern != ''
       ORDER BY success_rating DESC LIMIT 20`,
    )
    .all(userId, taskType) as Array<{ pattern: string; success_rating: number }>

  if (rows.length < minOccurrences) return null

  // 找最常见 pattern
  const patternMap = new Map<string, { count: number; totalRating: number }>()
  for (const row of rows) {
    const key = row.pattern
    const existing = patternMap.get(key)
    if (existing) {
      existing.count++
      existing.totalRating += row.success_rating
    } else {
      patternMap.set(key, { count: 1, totalRating: row.success_rating })
    }
  }

  // 找出现次数最多的且达到 minOccurrences 的
  let best: { pattern: string; count: number; totalRating: number } | null = null
  for (const [pattern, data] of patternMap) {
    if (data.count >= minOccurrences) {
      if (!best || data.count > best.count) {
        best = { pattern, count: data.count, totalRating: data.totalRating }
      }
    }
  }

  if (!best) return null

  return {
    task_type: taskType,
    pattern: best.pattern,
    success_rate: best.totalRating / best.count,
    usage_count: best.count,
  }
}

/**
 * 获取学习统计
 */
export async function getLearningStats(userId: string): Promise<LearningStats> {
  const rows = sqlite
    .prepare(
      `SELECT task_type, lessons, success_rating FROM agent_learnings
       WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 200`,
    )
    .all(userId) as Array<{ task_type: string; lessons: string; success_rating: number }>

  if (rows.length === 0) {
    return {
      total_reflections: 0,
      avg_rating: 0,
      top_lessons: [],
      learnings_by_type: {},
      total_tokens_saved: 0,
    }
  }

  const totalRating = rows.reduce((sum, r) => sum + r.success_rating, 0)
  const learningsByType: Record<string, number> = {}
  const lessonCount = new Map<string, number>()

  for (const row of rows) {
    learningsByType[row.task_type] = (learningsByType[row.task_type] || 0) + 1
    try {
      const lessons: string[] = JSON.parse(row.lessons)
      for (const lesson of lessons) {
        lessonCount.set(lesson, (lessonCount.get(lesson) || 0) + 1)
      }
    } catch {
      // ignore
    }
  }

  const topLessons = [...lessonCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([lesson, count]) => ({ lesson, count }))

  const totalTokensSaved = sqlite
    .prepare('SELECT COALESCE(SUM(tokens_saved), 0) as sum FROM agent_learnings WHERE user_id = ?')
    .get(userId) as { sum: number }

  return {
    total_reflections: rows.length,
    avg_rating: rows.length > 0 ? Math.round((totalRating / rows.length) * 100) / 100 : 0,
    top_lessons: topLessons,
    learnings_by_type: learningsByType,
    total_tokens_saved: totalTokensSaved.sum,
  }
}

/**
 * 应用历史经验优化 prompt
 */
export async function autoOptimize(
  userId: string,
  prompt: string,
  taskType: string,
): Promise<{ optimized_prompt: string; applied_lessons: string[] }> {
  // 获取适用建议
  const suggestions = await suggestImprovements(userId, taskType, prompt)

  if (suggestions.length === 0) {
    return { optimized_prompt: prompt, applied_lessons: [] }
  }

  // 将建议附加到 prompt 之前
  const improvementBlock = [
    '=== 历史经验 (基于你的过往任务) ===',
    ...suggestions.map((s, i) => `${i + 1}. ${s}`),
    '===============================',
  ].join('\n')

  const optimized = `${improvementBlock}\n\n--- 原始任务 ---\n${prompt}`

  return {
    optimized_prompt: optimized,
    applied_lessons: suggestions,
  }
}

/**
 * 编排工作流完成后进行反思
 */
export async function reflectOnWorkflow(
  userId: string,
  _workflowId: string,
  steps: OrchestrationStepResult[],
  result: OrchestrationResult,
): Promise<LearningEntry | null> {
  if (steps.length === 0) return null

  // 确定主要 agent (第一个 step 的 agent)
  const primaryAgent = steps[0]?.agent_id || 'unknown'
  const taskType = inferTaskType(primaryAgent, steps)

  // 生成反思内容
  const completedSteps = steps.filter((s) => s.status === 'completed')
  const failedSteps = steps.filter((s) => s.status === 'failed')
  const successRating = steps.length > 0
    ? completedSteps.length / steps.length
    : 0.5

  const reflection = [
    `工作流 ${result.status === 'completed' ? '成功完成' : result.status === 'partial' ? '部分完成' : '失败'}`,
    `共 ${steps.length} 步骤, ${completedSteps.length} 完成, ${failedSteps.length} 失败`,
    `总耗时 ${result.total_duration_ms}ms, 总 token ${result.total_tokens}`,
  ].join('。')

  const lessons: string[] = []

  // 提取经验
  if (failedSteps.length > 0) {
    lessons.push('编排工作流时对关键步骤添加错误处理')
    lessons.push(`失败步骤: ${failedSteps.map(s => s.agent_id).join(',')} — 检查 agent 配置`)
  }

  const durations = steps.map((s) => s.duration_ms)
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length
  if (avgDuration > 30_000) {
    lessons.push('考虑拆分耗时过长的步骤为子任务')
  }

  if (steps.length > 5) {
    lessons.push('长工作流建议分阶段执行, 中间保存检查点')
  }

  lessons.push('编排前验证每个 agent 的状态和配置')
  lessons.push('记录工作流执行日志以便后续排查')

  // 写入学习记录
  const id = ulid()
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO agent_learnings (id, user_id, agent_id, task_type, reflection, lessons, pattern, success_rating, tokens_saved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      primaryAgent,
      taskType,
      reflection,
      JSON.stringify(lessons),
      null,
      successRating,
      result.total_tokens,
      now,
    )

  return {
    id,
    user_id: userId,
    agent_id: primaryAgent,
    task_type: taskType,
    reflection,
    lessons,
    success_rating: successRating,
    tokens_saved: result.total_tokens,
    created_at: now,
  }
}

function inferTaskType(
  primaryAgent: string,
  _steps: OrchestrationStepResult[],
): string {
  const lower = primaryAgent.toLowerCase()
  if (lower.includes('research') || lower.includes('analyst')) return 'research'
  if (lower.includes('writer') || lower.includes('content')) return 'content'
  if (lower.includes('code') || lower.includes('security') || lower.includes('quality')) return 'code'
  if (lower.includes('social') || lower.includes('douyin') || lower.includes('wechat') || lower.includes('xiaohongshu')) return 'social'
  return 'general'
}
