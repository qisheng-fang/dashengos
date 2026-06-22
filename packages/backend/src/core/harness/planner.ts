// packages/backend/src/core/harness/planner.ts · DaShengOS Harness — First Principles Planner
// 2026-06-18 · 第一性原理任务分解
// 输入: 用户意图 → 输出: 结构化步骤列表
// 简单任务直出，复杂任务拆 3-7 步

import { getActiveProvider, getApiKey } from '../../providers/index.js'

// ─── Types ─────────────────────────────────────────────────

export interface PlanStep {
  index: number
  action: string       // 人类可读的动作描述
  tool?: string        // 对应的工具名 (if applicable)
  args?: Record<string, unknown>
  expectedOutput: string  // 预期输出的简述
  verificationHint: string // 如何验证这步是否成功
}

export interface TaskPlan {
  isComplex: boolean
  rootQuestion: string      // 本质问题
  constraints: string[]     // 硬约束
  highestLeverage: string   // 最高杠杆动作
  steps: PlanStep[]
  estimatedTokens: number
}

// ─── 任务复杂度判断 ────────────────────────────────────────

const COMPLEXITY_SIGNALS = [
  /分析|对比|比较|调研|研究|规划|策略|方案/i,
  /报告|PPT|文档|白皮书|行业/i,
  /优化|改进|重构|改造|升级/i,
  /部署|上线|发布|监控/i,
  /竞品|市场|趋势|数据/i,
]

const SIMPLE_SIGNALS = [
  /^(你好|hi|hello|嗨|在吗|谢谢)/i,
  /^(什么|怎么|如何|为什么).*[?？]$/i,
  /^.{1,15}$/,  // 非常短的消息
]

export function assessComplexity(message: string): 'simple' | 'moderate' | 'complex' {
  if (SIMPLE_SIGNALS.some(p => p.test(message.trim()))) return 'simple'
  if (COMPLEXITY_SIGNALS.some(p => p.test(message))) return 'complex'
  if (message.length > 100) return 'moderate'
  return 'simple'
}

// ─── 规划生成 (LLM 辅助) ──────────────────────────────────

const PLANNER_PROMPT = `You are a task decomposition specialist using first principles thinking.

Given a user request, produce a structured execution plan.

Framework:
1. ROOT QUESTION: What is the essential problem beneath the surface request?
2. CONSTRAINTS: What are the hard limits (time/budget/data/tech)?
3. HIGHEST LEVERAGE: What single action would create the most impact?
4. STEPS: Break into 3-7 concrete, verifiable steps.

For each step:
- action: human-readable description
- tool: which of these tools to use (read_file/write_file/edit_file/list_files/search_content/run_command/check_process/check_port/read_logs/db_query/web_fetch/web_search/restart_service/install_pkg/git_op/execute_skill), or "llm_think" if no tool needed
- args: tool arguments (if applicable)
- expectedOutput: what success looks like
- verificationHint: how to verify this step succeeded

Output as JSON only, no markdown:
{"rootQuestion":"...","constraints":["..."],"highestLeverage":"...","steps":[{"index":1,"action":"...","tool":"...","args":{},"expectedOutput":"...","verificationHint":"..."}]}

Rules:
- Every step must be VERIFIABLE (not "think about it" but "read file X and check Y")
- Steps must be ORDERED by dependency (don't run_command before write_file)
- If the task is simple (1-step), return {"isSimple": true, "directAnswer": "..."}
- Never fabricate data — if data is needed, use web_search or db_query FIRST`

/**
 * 生成任务规划 (调用 LLM)
 * 如果任务简单，返回轻量 plan 不调 LLM (省 tokens)
 */
export async function generatePlan(
  message: string,
  history: Array<{ role: string; content: string }>,
): Promise<TaskPlan> {
  const complexity = assessComplexity(message)

  // 简单任务: 不调 LLM，直接生成轻量 plan
  if (complexity === 'simple') {
    return {
      isComplex: false,
      rootQuestion: message,
      constraints: [],
      highestLeverage: '直接回答',
      steps: [{
        index: 1,
        action: '直接回答用户问题',
        tool: 'llm_think',
        expectedOutput: '直接、准确的回答',
        verificationHint: '回答是否切题、不含幻觉',
      }],
      estimatedTokens: 500,
    }
  }

  // 中等+复杂任务: 调 LLM 做规划
  try {
    const provider = getActiveProvider()
    const apiKey = getApiKey(provider) ?? ''
    if (!apiKey) {
      return fallbackPlan(message, complexity)
    }

    const model = process.env[provider.name.toUpperCase() + '_DEFAULT_MODEL'] || provider.defaultModel

    const messages = [
      { role: 'system' as const, content: PLANNER_PROMPT },
      ...history.slice(-6).map(h => ({ role: h.role as 'user' | 'assistant', content: h.content })),
      { role: 'user' as const, content: `用户请求: "${message}"\n\n请生成执行计划。` },
    ]

    const resp = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!resp.ok) return fallbackPlan(message, complexity)

    const data = await resp.json() as any
    const content = data.choices?.[0]?.message?.content || ''

    // 解析 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return fallbackPlan(message, complexity)

    const parsed = JSON.parse(jsonMatch[0])

    // 如果是简单任务的特殊返回
    if (parsed.isSimple) {
      return {
        isComplex: false,
        rootQuestion: parsed.rootQuestion || message,
        constraints: [],
        highestLeverage: '直接回答',
        steps: [{
          index: 1,
          action: '直接回答',
          tool: 'llm_think',
          expectedOutput: parsed.directAnswer || '',
          verificationHint: '回答是否切题',
        }],
        estimatedTokens: 500,
      }
    }

    return {
      isComplex: true,
      rootQuestion: parsed.rootQuestion || message,
      constraints: parsed.constraints || [],
      highestLeverage: parsed.highestLeverage || '',
      steps: (parsed.steps || []).map((s: any, i: number) => ({
        index: i + 1,
        action: s.action || '',
        tool: s.tool || undefined,
        args: s.args || undefined,
        expectedOutput: s.expectedOutput || '',
        verificationHint: s.verificationHint || '',
      })),
      estimatedTokens: 2000,
    }
  } catch {
    return fallbackPlan(message, complexity)
  }
}

// ─── 降级规划 (LLM 不可用时) ──────────────────────────────

function fallbackPlan(message: string, complexity: 'moderate' | 'complex'): TaskPlan {
  const steps: PlanStep[] = [
    {
      index: 1,
      action: '分析用户意图，确定所需数据/信息',
      tool: 'llm_think',
      expectedOutput: '清晰的任务定义和信息需求列表',
      verificationHint: '是否理解了用户的核心诉求',
    },
    {
      index: 2,
      action: complexity === 'complex' ? '搜索相关信息 (必要时用 web_search / db_query)' : '基于已有知识直接处理',
      tool: complexity === 'complex' ? 'web_search' : 'llm_think',
      args: complexity === 'complex' ? { query: message.slice(0, 80) } : undefined,
      expectedOutput: '相关数据/上下文/事实',
      verificationHint: '搜索结果是否与问题相关',
    },
    {
      index: 3,
      action: '生成结构化输出 (摘要→分析→行动项→风险)',
      tool: 'llm_think',
      expectedOutput: '完整、可执行的结果',
      verificationHint: '输出是否切题、有数据支撑、可执行',
    },
  ]

  return {
    isComplex: complexity === 'complex',
    rootQuestion: message,
    constraints: ['LLM 规划降级模式', '可能缺少实时数据'],
    highestLeverage: '收集准确信息 + 结构化输出',
    steps,
    estimatedTokens: 3000,
  }
}
