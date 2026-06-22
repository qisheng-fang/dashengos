// packages/backend/src/core/harness/index.ts · DaShengOS Harness — Orchestrator
// 2026-06-18 · Agent = Model + Harness
// 五层编排: System Prompt → Memory → Plan → Execute → Reflect
// 两种模式: Stream (轻量增强) / Agent (完整 Harness 循环)

import { buildSuperSystemPrompt } from './system-prompt.js'
import { loadMemoryContext, loadLightMemory, type ConversationMemory, type UserProfile } from './memory.js'
import { generatePlan, type TaskPlan } from './planner.js'
import { verifyResult, createReflectionLog, buildReflectionPrompt, type VerificationResult, type ReflectionLog } from './reflector.js'

export { buildSuperSystemPrompt, buildLightSystemPrompt } from './system-prompt.js'
export { loadMemoryContext, loadLightMemory, extractAndSaveCrossSessionMemory } from './memory.js'
export { generatePlan, assessComplexity } from './planner.js'
export { verifyResult, createReflectionLog, buildReflectionPrompt } from './reflector.js'
export {
  detectPatterns, matchExistingSkill, generateSkillFromPattern, generateSkillFromContext,
  buildWorkflowFromPattern, discoverAndGenerateSkills, analyzeConversationEnd, listDiscoveredSkills,
} from './skill-discovery.js'

// ─── Harness 执行上下文 ────────────────────────────────────

export interface HarnessContext {
  userId: string
  mode: 'stream' | 'agent'
  taskType: 'chat' | 'marketing' | 'analysis' | 'technical' | 'creative'
  maxRetries: number   // default 2
  maxTokens: number    // default 4096 (stream) / 8192 (agent)
}

export interface HarnessResult {
  systemPrompt: string
  memory: ConversationMemory
  plan: TaskPlan
  reflections: ReflectionLog[]
  totalRetries: number
  harnessEnabled: boolean
}

// ─── Stream 模式: 轻量增强 (不调 LLM 做规划) ────────────

/**
 * Stream 模式 Harness 增强
 * - 注入超级 System Prompt + 记忆 + 品牌知识
 * - 不做规划 (省 tokens，用户体验无感知)
 * - 输出后可做轻量验证 (但不重试)
 */
export function enhanceStreamMode(
  userId: string,
  user?: UserProfile | null,
  message?: string,
): { systemPrompt: string; memory: ConversationMemory } {
  const memory = loadLightMemory(userId)
  const taskType = message ? detectTaskType(message) : 'chat'
  const systemPrompt = buildSuperSystemPrompt({
    user,
    memory,
    mode: 'stream',
    taskType,
  })

  return { systemPrompt, memory }
}

// ─── Agent 模式: 完整 Harness 循环 ────────────────────────

/**
 * Agent 模式 Harness 完整编排
 * 1. Memory → 加载记忆上下文
 * 2. Plan → LLM 辅助任务分解
 * 3. Execute → Agent Loop 执行 (由 loop.ts 处理)
 * 4. Reflect → 每步验证 + 反思重试
 * 5. Final → 最终结果验证
 */
export async function prepareAgentMode(
  message: string,
  history: Array<{ role: string; content: string }>,
  userId: string,
  user?: UserProfile | null,
): Promise<HarnessResult> {
  // 1. Memory
  const memory = loadMemoryContext(userId)

  // 2. System Prompt (含 Wiki + 上下文)
  const taskType = detectTaskType(message)
  const systemPrompt = buildSuperSystemPrompt({
    user,
    memory,
    wikiPages: memory.wikiPages,
    mode: 'agent',
    taskType,
  })

  // 3. Plan
  const plan = await generatePlan(message, history)

  return {
    systemPrompt,
    memory,
    plan,
    reflections: [],
    totalRetries: 0,
    harnessEnabled: true,
  }
}

/**
 * 验证 Agent 步骤结果 (在 Agent Loop 中调用)
 * 如果验证不通过，返回反思 prompt 用于重试
 */
export function verifyStepResult(
  stepIndex: number,
  userInput: string,
  stepOutput: string,
  expectedOutput: string,
  retryCount: number,
  maxRetries: number = 2,
): {
  passed: boolean
  verification: VerificationResult
  retryPrompt?: string
  reflection: ReflectionLog
} {
  const verification = verifyResult(userInput, stepOutput, expectedOutput)
  const reflection = createReflectionLog(stepIndex, '', stepOutput, verification, retryCount)

  if (!verification.passed && retryCount < maxRetries && verification.retryRecommended) {
    const retryPrompt = buildReflectionPrompt(userInput, stepOutput, verification.issues)
    return { passed: false, verification, retryPrompt, reflection }
  }

  return { passed: true, verification, reflection }
}

// ─── 工具编排增强 ──────────────────────────────────────────

/**
 * 根据任务类型推荐工具序列
 * (辅助 Agent Loop 决定优先使用哪些工具)
 */
export function recommendToolSequence(taskType: string): string[] {
  switch (taskType) {
    case 'marketing':
      return ['web_search', 'web_fetch', 'llm_think', 'write_file']
    case 'analysis':
      return ['web_search', 'db_query', 'web_fetch', 'llm_think', 'write_file']
    case 'technical':
      return ['read_file', 'search_content', 'run_command', 'read_logs', 'edit_file', 'check_process']
    case 'creative':
      return ['web_search', 'llm_think', 'write_file']
    default:
      return ['llm_think', 'web_search', 'read_file']
  }
}

// ─── 任务类型检测 ──────────────────────────────────────────

function detectTaskType(message: string): 'chat' | 'marketing' | 'analysis' | 'technical' | 'creative' {
  const m = message.toLowerCase()

  if (/(营销|推广|种草|文案|海报|广告|投放|达人|kol|小红书|抖音|公众号|视频号|直播)/.test(m)) {
    return 'marketing'
  }
  if (/(分析|报告|调研|数据|市场|竞品|趋势|行业|规模|占率)/.test(m)) {
    return 'analysis'
  }
  if (/(修|改|重构|优化|部署|bug|报错|调试|排查|重启|日志|进程|端口)/.test(m)) {
    return 'technical'
  }
  if (/(创作|写|生成|设计|画|故事|脚本|设计稿|创意|灵感)/.test(m)) {
    return 'creative'
  }
  return 'chat'
}
