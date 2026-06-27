// packages/backend/src/core/orchestrator.ts · Phase B.2 多 Agent 编排引擎
//
// 实现 5 种工作流模式: pipeline, parallel, conditional, loop, debate
// 通过 SiliconFlow LLM 驱动 conditional/loop 分支决策

import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { rankByQuality, majorityVote, hybridRank, buildSynthesisPrompt, type SwarmCandidate } from './orchestrator/swarm-ranker.js'
import { logger } from './logger.js'

// ---- 类型定义 ----

export interface OrchestrationStep {
  id: string
  agent_id: string
  mode: 'pipeline' | 'parallel' | 'conditional' | 'loop' | 'debate' | 'swarm'
  condition?: string
  max_iterations?: number
  children?: OrchestrationStep[]
  input_transform?: string
}

export interface StepResult {
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
  steps: StepResult[]
  final_output?: string
  total_duration_ms: number
  total_tokens: number
}

export type ProgressCallback = (stepId: string, status: string) => void

// ---- 运行中的工作流追踪 ----

const runningWorkflows = new Map<string, {
  aborted: boolean
  result: OrchestrationResult
}>()

export function getWorkflowStatus(workflowId: string) {
  return runningWorkflows.get(workflowId)
}

export function cancelWorkflow(workflowId: string): boolean {
  const wf = runningWorkflows.get(workflowId)
  if (!wf) return false
  wf.aborted = true
  wf.result.status = 'failed'
  return true
}

// ---- Agent 调用 (via DeerFlow daemon Unix socket JSON-RPC) ----

async function callAgent(agentId: string, input: string, context?: Record<string, unknown>): Promise<{
  output: string
  tokens_used: number
  duration_ms: number
}> {
  const t0 = Date.now()

  // 直连 LLM (OpenAI 兼容)
  return callAgentViaSiliconFlow(agentId, input, context, t0)
}

async function callAgentViaSiliconFlow(
  agentId: string, input: string,
  _context: Record<string, unknown> | undefined, t0: number,
): Promise<{ output: string; tokens_used: number; duration_ms: number }> {
  // 构建 system prompt (根据 agent 类型)
  const systemPrompt = getAgentSystemPrompt(agentId)

  const body = {
    model: config.SILICONFLOW_DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ],
    temperature: 0.3,
    max_tokens: 4096,
    stream: false,
  }

  const resp = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.SILICONFLOW_TIMEOUT_SEC * 1000),
  })

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`SiliconFlow API error ${resp.status}: ${err.slice(0, 200)}`)
  }

  const data = await resp.json() as {
    choices: Array<{ message: { content: string } }>
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  }
  const content = data.choices?.[0]?.message?.content || ''
  const tokens = data.usage?.total_tokens || 0

  return {
    output: content,
    tokens_used: tokens,
    duration_ms: Date.now() - t0,
  }
}

function getAgentSystemPrompt(agentId: string): string {
  const prompts: Record<string, string> = {
    researcher: '你是一个专业的研究员 Agent。你的职责是搜集信息、分析数据、验证事实。请提供准确、有数据支持的信息。',
    analyst: '你是一个专业的数据分析师 Agent。你的职责是识别模式、提取洞察、做出推断。请提供结构化的分析。',
    writer: '你是一个专业的写作 Agent。你的职责是撰写清晰、有吸引力的报告和文章。请注重逻辑和表达。',
    quality: '你是一个专业的质量审查 Agent。你的职责是检查事实准确性、逻辑一致性和内容完整性。请逐项审查。',
    security: '你是一个专业的代码安全审查 Agent。你的职责是发现安全漏洞和潜在风险。请按照 OWASP 标准审查。',
    social_douyin: '你是一个短视频内容策划 Agent。专门为抖音平台策划爆款短视频内容。',
    social_wechat: '你是一个微信公众号内容创作 Agent。专门撰写公众号爆款文章和排版建议。',
    social_xiaohongshu: '你是一个小红书内容创作 Agent。专门撰写小红书种草笔记。',
  }
  return prompts[agentId] || `你是 ${agentId} agent。请根据用户的问题提供专业输出。`
}

// ---- 条件分支评估 (使用 LLM) ----

async function evaluateCondition(
  condition: string,
  currentOutput: string,
  originalInput: string,
): Promise<string> {
  if (!config.SILICONFLOW_API_KEY) {
    // 无 API key 时用简单关键词匹配
    logger.warn('No API key for conditional evaluation, using keyword match')
    return keywordMatch(condition, currentOutput)
  }

  const body = {
    model: config.SILICONFLOW_DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: `你是一个决策 Agent。根据条件和当前结果，返回准确的下一个 agent ID。
可用 agent: researcher, analyst, writer, quality, security, social_douyin, social_wechat, social_xiaohongshu
只返回 agent_id，不要其他文字。`,
      },
      {
        role: 'user',
        content: `条件: ${condition}\n\n当前输出: ${currentOutput.slice(0, 2000)}\n\n原始任务: ${originalInput.slice(0, 500)}\n\n下一个 agent 应该是:`,
      },
    ],
    temperature: 0.1,
    max_tokens: 32,
  }

  try {
    const resp = await fetch(`${config.SILICONFLOW_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.SILICONFLOW_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as { choices: Array<{ message: { content: string } }> }
    return data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'writer'
  } catch (e) {
    logger.warn('Condition evaluation failed, defaulting to writer', { err: (e as Error).message })
    return 'writer'
  }
}

function keywordMatch(condition: string, output: string): string {
  const cl = condition.toLowerCase()
  const ol = output.toLowerCase()

  // 基于条件的简单决策
  if (cl.includes('安全') || cl.includes('漏洞') || cl.includes('security')) return 'security'
  if (cl.includes('质量') || cl.includes('审查') || cl.includes('quality')) return 'quality'
  if (cl.includes('分析') || cl.includes('数据') || cl.includes('analy')) return 'analyst'
  if (cl.includes('搜索') || cl.includes('调研') || cl.includes('research')) return 'researcher'
  if (cl.includes('写作') || cl.includes('报告') || cl.includes('write')) return 'writer'

  // 基于输出的回退
  if (ol.length < 100) return 'researcher'
  return 'writer'
}

// ---- 主编排函数 ----

export async function executeWorkflow(
  workflow: OrchestrationStep[],
  initialInput: string,
  _userId: string,
  onProgress?: ProgressCallback,
): Promise<OrchestrationResult> {
  const workflowId = randomUUID()
  const t0 = Date.now()

  const result: OrchestrationResult = {
    workflow_id: workflowId,
    status: 'running',
    steps: [],
    total_duration_ms: 0,
    total_tokens: 0,
  }

  runningWorkflows.set(workflowId, { aborted: false, result })

  try {
    let currentInput = initialInput

    for (const step of workflow) {
      // 检查取消
      if (runningWorkflows.get(workflowId)?.aborted) {
        result.status = 'failed'
        result.final_output = 'Workflow cancelled by user'
        break
      }

      // 执行步骤
      const stepResult = await executeStep(step, currentInput, workflowId, onProgress)
      result.steps.push(stepResult)

      if (stepResult.tokens_used) result.total_tokens += stepResult.tokens_used

      // 如果某步失败且不是 partial 模式，中断
      if (stepResult.status === 'failed') {
        result.status = 'failed'
        result.final_output = result.steps
          .filter(s => s.status === 'completed')
          .map(s => s.output)
          .join('\n\n---\n\n')
        break
      }

      // 将本步输出作为下一步输入
      if (stepResult.output) {
        currentInput = stepResult.output
      }
    }

    // 如果所有步骤完成
    if (result.status === 'running') {
      result.status = 'completed'
      const lastCompleted = [...result.steps].reverse().find(s => s.status === 'completed')
      result.final_output = lastCompleted?.output || ''
    }

    // 检查 partial
    const hasFailures = result.steps.some(s => s.status === 'failed')
    const hasCompleted = result.steps.some(s => s.status === 'completed')
    if (hasFailures && hasCompleted && result.status !== 'failed') {
      result.status = 'partial'
    }
  } catch (e) {
    logger.error('Workflow execution error', { err: (e as Error).message, workflowId })
    result.status = 'failed'
    result.final_output = `Execution error: ${(e as Error).message}`
  } finally {
    result.total_duration_ms = Date.now() - t0
    runningWorkflows.delete(workflowId)
  }

  return result
}

function applyInputTransform(input: string, transform?: string): string {
  if (!transform) return input
  return `${transform}\n\n原始内容:\n${input}`
}

async function executeStep(
  step: OrchestrationStep,
  input: string,
  workflowId: string,
  onProgress?: ProgressCallback,
): Promise<StepResult> {
  const t0 = Date.now()
  onProgress?.(step.id, 'running')

  try {
    switch (step.mode) {
      case 'pipeline': {
        // 简单顺序调用，应用 input_transform
        const prompt = applyInputTransform(input, step.input_transform)
        const out = await callAgent(step.agent_id, prompt)
        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'completed',
          output: out.output,
          tokens_used: out.tokens_used,
          duration_ms: out.duration_ms,
        }
      }

      case 'parallel': {
        // 并发执行所有子步骤
        const children = step.children || []
        if (children.length === 0) {
          // 无子步骤时直接调用
          const out = await callAgent(step.agent_id, input)
          onProgress?.(step.id, 'completed')
          return {
            step_id: step.id,
            agent_id: step.agent_id,
            status: 'completed',
            output: out.output,
            tokens_used: out.tokens_used,
            duration_ms: out.duration_ms,
          }
        }

        const results = await Promise.allSettled(
          children.map(child => executeStep(child, input, workflowId, onProgress)),
        )

        const outputs: string[] = []
        let totalTokens = 0
        let hasCompleted = false

        for (const r of results) {
          if (r.status === 'fulfilled') {
            if (r.value.status === 'completed' && r.value.output) {
              outputs.push(`[${r.value.agent_id}]: ${r.value.output}`)
              hasCompleted = true
            }
            totalTokens += r.value.tokens_used || 0
          }
        }

        // 如果有多个输出，让 writer agent 整合
        let finalOutput: string
        if (outputs.length > 1) {
          const merged = outputs.join('\n\n---\n\n')
          const writeResult = await callAgent('writer',
            `整合以下多个 agent 的输出为一份连贯报告:\n\n${merged}`)
          finalOutput = writeResult.output
          totalTokens += writeResult.tokens_used
        } else {
          finalOutput = outputs[0] || ''
        }

        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: hasCompleted ? 'completed' : 'failed',
          output: finalOutput,
          tokens_used: totalTokens,
          duration_ms: Date.now() - t0,
        }
      }

      case 'conditional': {
        // 执行当前 agent，然后根据条件决定下一步
        const out = await callAgent(step.agent_id, input)
        const children = step.children || []

        if (children.length === 0) {
          onProgress?.(step.id, 'completed')
          return {
            step_id: step.id,
            agent_id: step.agent_id,
            status: 'completed',
            output: out.output,
            tokens_used: out.tokens_used,
            duration_ms: out.duration_ms,
          }
        }

        // 评估条件
        const nextAgent = await evaluateCondition(
          step.condition || '决定下一步',
          out.output,
          input,
        )

        // 找到匹配的子步骤
        const matched = children.find(c => c.agent_id === nextAgent)
        if (matched) {
          const childResult = await executeStep(matched, out.output, workflowId, onProgress)
          onProgress?.(step.id, 'completed')
          return {
            step_id: step.id,
            agent_id: step.agent_id,
            status: 'completed',
            output: `${out.output}\n\n--- Conditional Branch → ${matched.agent_id} ---\n\n${childResult.output}`,
            tokens_used: out.tokens_used + (childResult.tokens_used || 0),
            duration_ms: Date.now() - t0,
          }
        }

        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'completed',
          output: out.output,
          tokens_used: out.tokens_used,
          duration_ms: Date.now() - t0,
        }
      }

      case 'loop': {
        // 循环执行直到条件满足或达到最大迭代
        const maxIter = step.max_iterations || 3
        let currentInput = input
        let totalTokens = 0
        const allOutputs: string[] = []

        for (let i = 0; i < maxIter; i++) {
          if (runningWorkflows.get(workflowId)?.aborted) {
            return {
              step_id: step.id,
              agent_id: step.agent_id,
              status: 'failed',
              error: 'Workflow cancelled',
              duration_ms: Date.now() - t0,
            }
          }

          onProgress?.(`${step.id}:iteration:${i + 1}`, 'running')
          const out = await callAgent(step.agent_id, currentInput)
          totalTokens += out.tokens_used
          allOutputs.push(out.output)

          // 检查终止条件
          if (step.condition) {
            const decision = await evaluateCondition(
              step.condition,
              out.output,
              input,
            )
            if (decision === 'finish' || decision === 'complete' || decision === 'done') {
              break
            }
          }

          // 使用上一次的输出作为新一轮输入
          currentInput = `上一轮结果:\n${out.output}\n\n请基于以上结果继续迭代改进。`
        }

        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'completed',
          output: allOutputs.join('\n\n--- 迭代 ---\n\n'),
          tokens_used: totalTokens,
          duration_ms: Date.now() - t0,
        }
      }

      case 'debate': {
        // 两个 agent 辩论，第三个 agent 合成
        const children = step.children || []
        if (children.length < 2) {
          // 至少需要两个 agent 辩论
          const out = await callAgent(step.agent_id, input)
          onProgress?.(step.id, 'completed')
          return {
            step_id: step.id,
            agent_id: step.agent_id,
            status: 'completed',
            output: out.output,
            tokens_used: out.tokens_used,
            duration_ms: out.duration_ms,
          }
        }

        const debateRounds = step.max_iterations || 2
        let debateA = input
        let debateB = input
        let totalTokens = 0

        // Agent A 和 Agent B 交替辩论
        for (let r = 0; r < debateRounds; r++) {
          if (runningWorkflows.get(workflowId)?.aborted) {
            return {
              step_id: step.id,
              agent_id: step.agent_id,
              status: 'failed',
              error: 'Workflow cancelled',
              duration_ms: Date.now() - t0,
            }
          }

          // Agent A 发言
          onProgress?.(`${step.id}:debate:${children[0].agent_id}:${r + 1}`, 'running')
          const aOut = await callAgent(children[0].agent_id, debateA)
          totalTokens += aOut.tokens_used
          debateA = aOut.output

          // Agent B 回复
          onProgress?.(`${step.id}:debate:${children[1].agent_id}:${r + 1}`, 'running')
          const bOut = await callAgent(children[1].agent_id,
            `对方观点:\n${debateA}\n\n请针对上述观点提出反驳或补充:\n\n原始问题: ${input}`)
          totalTokens += bOut.tokens_used
          debateB = bOut.output
        }

        // 第三个 agent (或 writer) 合成结论
        const synthesizer = children[2]?.agent_id || 'writer'
        onProgress?.(`${step.id}:synthesize:${synthesizer}`, 'running')
        const synOut = await callAgent(synthesizer,
          `辩论双方观点:\n\n观点 A:\n${debateA}\n\n观点 B:\n${debateB}\n\n` +
          `请综合双方观点，给出平衡、完整的结论。原始问题: ${input}`)
        totalTokens += synOut.tokens_used

        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'completed',
          output: synOut.output,
          tokens_used: totalTokens,
          duration_ms: Date.now() - t0,
        }
      }

      case 'swarm': {
        // Fan-out to N agents → rank results → return best + synthesis
        const children = step.children || []
        if (children.length === 0) {
          const out = await callAgent(step.agent_id, input)
          onProgress?.(step.id, 'completed')
          return { step_id: step.id, agent_id: step.agent_id, status: 'completed', output: out.output, tokens_used: out.tokens_used, duration_ms: out.duration_ms }
        }

        // Parallel fan-out
        onProgress?.(step.id, 'running')
        const swarmPromises = children.map(async (child) => {
          onProgress?.(step.id + ':agent:' + child.agent_id, 'running')
          const tStart = Date.now()
          try {
            const childResult = await callAgent(child.agent_id, input)
            const candidate: SwarmCandidate = {
              agentId: child.agent_id,
              output: childResult.output,
              tokensUsed: childResult.tokens_used,
              durationMs: childResult.duration_ms,
            }
            onProgress?.(step.id + ':agent:' + child.agent_id, 'completed')
            return candidate
          } catch (e: any) {
            onProgress?.(step.id + ':agent:' + child.agent_id, 'failed')
            return {
              agentId: child.agent_id,
              output: 'ERROR: ' + (e.message || 'Unknown'),
              tokensUsed: 0,
              durationMs: Date.now() - tStart,
              confidence: 0,
            } as SwarmCandidate
          }
        })

        const candidates = await Promise.all(swarmPromises)
        const validCandidates = candidates.filter(c => !c.output.startsWith('ERROR:'))

        if (validCandidates.length === 0) {
          onProgress?.(step.id, 'failed')
          return { step_id: step.id, agent_id: step.agent_id, status: 'failed', error: 'All swarm agents failed', duration_ms: Date.now() - t0 }
        }

        // Rank and select winner
        const ranking = hybridRank(validCandidates)
        const totalTokens = validCandidates.reduce((sum, c) => sum + c.tokensUsed, 0)

        // Build synthesis of all outputs
        onProgress?.(step.id + ':synthesis', 'running')
        const synthesisPrompt = buildSynthesisPrompt(validCandidates, input)
        const synthesizer = await callAgent('writer', synthesisPrompt)
        const finalOutput = '=== Swarm Winner (' + ranking.winner.agentId + ', consensus: ' + (ranking.consensus * 100).toFixed(0) + '%) ===\n\n' + 'WINNER OUTPUT:\n' + ranking.winner.output + '\n\n=== SYNTHESIS ===\n\n' + synthesizer.output + '\n\n=== ALL RESULTS (' + validCandidates.length + ' agents) ===\n\n' + validCandidates.map((c, i) => '[' + (i + 1) + '] ' + c.agentId + ' (tokens: ' + c.tokensUsed + '):\n' + c.output.slice(0, 500) + (c.output.length > 500 ? '...' : '')).join('\n\n')

        onProgress?.(step.id, 'completed')
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'completed',
          output: finalOutput,
          tokens_used: totalTokens + synthesizer.tokens_used,
          duration_ms: Date.now() - t0,
        }
      }

      default:
        return {
          step_id: step.id,
          agent_id: step.agent_id,
          status: 'failed',
          error: `Unknown mode: ${step.mode}`,
          duration_ms: Date.now() - t0,
        }
    }
  } catch (e) {
    onProgress?.(step.id, 'failed')
    return {
      step_id: step.id,
      agent_id: step.agent_id,
      status: 'failed',
      error: (e as Error).message,
      duration_ms: Date.now() - t0,
    }
  }
}
