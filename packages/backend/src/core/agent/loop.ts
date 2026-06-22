// packages/backend/src/core/agent/loop.ts
// DaShengOS Agent Runtime — Loop Controller v6.0
// OMNI-BRAIN OS State Machine: THINK → TOOL → RESPOND
// 2026-06-22: Full harness integration

import { getToolsForLLM, getAllToolsForLLM, executeToolsParallel, ToolCall, ToolResult } from '../tools/registry.js'
import { getActiveProvider, getApiKey } from '../../providers/index.js'
import { runDiagnostics } from '../self-heal/diagnostics.js'
import { buildSuperSystemPrompt } from '../harness/system-prompt.js'
import { loadMemoryContext } from '../harness/memory.js'
import { analyzeConversationEnd } from '../harness/skill-discovery.js'
import { assessComplexity, generatePlan, type TaskPlan } from '../harness/planner.js'
import { verifyResult, createReflectionLog, type ReflectionLog } from '../harness/reflector.js'
import { parseMacros, stripGhostResponse, type ParsedMacros } from './macro-parser.js'
import { routeModel } from '../model-router.js'
import { recordEvolution, recommendStrategy, getErrorFix } from '../self-evolve.js'
import { compressContext, quickCompress } from '../context-compressor.js'

// ─── Types ─────────────────────────────────────────────

export interface AgentLoopOptions {
  userId: string
  sessionId?: string
  workspaceDir: string
  systemPrompt?: string
  maxIterations?: number
  maxErrorRetries?: number
  elevatedMode?: boolean
  selfHealMode?: boolean
  onEvent?: (event: LoopEvent) => void
  onToken?: (token: string) => void
}

export interface AgentLoopStep {
  iteration: number
  type: 'think' | 'tool_call' | 'respond' | 'error' | 'diagnose'
  input: string
  output: string | null
  toolCalls?: Array<{ name: string; args: Record<string, any>; result: ToolResult }>
  durationMs: number
}

export type LoopEvent =
  | { type: 'status'; text: string }
  | { type: 'tool_start'; name: string; args: Record<string, any> }
  | { type: 'tool_end'; name: string; success: boolean; summary: string }
  | { type: 'error'; message: string }
  | { type: 'thinking'; text: string }
  | { type: 'searching'; query: string }
  | { type: 'done'; finish_reason: string }

export interface AgentLoopResult {
  success: boolean
  response: string
  steps: AgentLoopStep[]
  totalTokens: { prompt: number; completion: number }
  error?: string
  needsConfirmation?: Array<{ name: string; args: Record<string, any> }>
  diagnosticsResult?: any
  systemPrompt?: string
  reflectionLog?: ReflectionLog[]
}

function safeJsonParse(s: string): Record<string, any> {
  try { return JSON.parse(s) } catch { return {} }
}

async function buildAgentSystemPrompt(userId: string, opts: { selfHealMode?: boolean; taskType?: string }): Promise<string> {
  try {
    const memory = loadMemoryContext(userId)
    return buildSuperSystemPrompt({
      memory,
      wikiPages: memory.wikiPages?.length ? memory.wikiPages : undefined,
      mode: 'agent',
      taskType: (opts.selfHealMode ? 'technical' : opts.taskType || 'chat') as any,
    })
  } catch {
    return buildSuperSystemPrompt({ mode: 'agent', taskType: opts.selfHealMode ? 'technical' : 'chat' })
  }
}

export async function runAgentLoop(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  const {
    userId, sessionId, workspaceDir, systemPrompt,
    maxIterations = 25, maxErrorRetries = 3,
    elevatedMode = false, selfHealMode = false,
    onEvent, onToken,
  } = options

  const steps: AgentLoopStep[] = []
  const reflectionLog: ReflectionLog[] = []
  const toolsForLLM = elevatedMode ? getAllToolsForLLM() : getToolsForLLM()

  // ── THINK PHASE: Macro parsing + complexity assessment ──
  const macroResult: ParsedMacros = parseMacros(userMessage)
  const effectiveMessage = macroResult.cleanMessage
  const effectiveMaxIterations = macroResult.loopOverrides.maxIterations ?? maxIterations
  const isGhostMode = macroResult.mode === 'ghost'
  const isDeepDive = macroResult.mode === 'deep_dive'
  const isHalt = macroResult.loopOverrides.haltImmediately

  if (isHalt) {
    return { success: true, response: '■ Halt & Catch Fire — 紧急制动已激活。所有任务已终止。', steps: [{ iteration: 1, type: 'think', input: userMessage, output: 'halt triggered', durationMs: 0 }], totalTokens: { prompt: 0, completion: 0 }, systemPrompt: 'halt' }
  }

  onEvent?.({ type: 'status', text: isGhostMode ? 'Ghost Mode — 静默执行' : isDeepDive ? 'Deep Dive — 深度分析' : 'DaShengOS Agent 引擎启动' })

  const complexity = assessComplexity(effectiveMessage)
  let taskPlan: TaskPlan | null = null
  // ── EVOLUTION: recommend best strategy ──
  let evolutionStrategy: any = null
  try {
    evolutionStrategy = recommendStrategy(effectiveMessage)
    if (evolutionStrategy.strategy) {
      onEvent?.({ type: 'thinking', text: `[进化] ${evolutionStrategy.reason}` })
    }
  } catch { /* evolution non-critical */ }

  if (complexity === 'complex' || complexity === 'moderate') {
    try {
      taskPlan = await generatePlan(effectiveMessage, conversationHistory)
      // Inject evolution strategy into plan if available
      if (evolutionStrategy?.strategy && taskPlan) {
        taskPlan.steps = [
          { index: 0, action: "[进化策略] " + evolutionStrategy.strategy.name, tool: "auto", expectedOutput: evolutionStrategy.strategy.description, verificationHint: "Check evolution strategy applied" },
          ...taskPlan.steps
        ]
      }
      onEvent?.({ type: 'thinking', text: `[THINK] 复杂度:${complexity} | 根问题:${taskPlan.rootQuestion.slice(0, 60)} | 步骤:${taskPlan.steps.length}` })
    } catch { /* planner failure is non-critical */ }
  }

  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (!provider) {
    return { success: false, response: '错误：没有可用的 LLM 提供商。', steps, totalTokens: { prompt: 0, completion: 0 }, error: 'No provider' }
  }

  // ── System prompt with plan injection ──
  let systemPromptText = systemPrompt || await buildAgentSystemPrompt(userId, { selfHealMode, taskType: complexity === 'complex' ? 'analysis' : 'chat' })
  if (macroResult.systemPromptInjection) systemPromptText = macroResult.systemPromptInjection + '\n\n' + systemPromptText
  if (taskPlan) {
    systemPromptText += `\n\n[TASK PLAN]\nRoot: ${taskPlan.rootQuestion}\nConstraints: ${taskPlan.constraints.join(', ')}\nLeverage: ${taskPlan.highestLeverage}\nSteps:\n${taskPlan.steps.map(s => `${s.index}. ${s.action} → tool:${s.tool || 'auto'} | expect:${s.expectedOutput}`).join('\n')}`
  }

  let messages: Array<any> = [
    { role: 'system', content: systemPromptText },
    ...conversationHistory.map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content })),
    { role: 'user', content: effectiveMessage },
  ]

  let consecutiveErrors = 0
  let consecutiveToolOnly = 0  // Track consecutive tool-only iterations
  let totalToolCalls = 0       // Total tool calls across all iterations (for force-synthesis)
  // lastRealContent tracking removed (unused)
  let diagnosticsResult: any = null
  // ── INTELLIGENT MODEL ROUTING ──
  let model = (provider as any).defaultModel || 'deepseek-v4-flash'
  try {
    const { getProviders } = await import('../../providers/index.js')
    const allProviders = getProviders()
    const providerInfos = allProviders.map((p: any) => ({
      name: p.name, displayName: p.displayName, defaultModel: p.defaultModel,
      fallbackModels: p.fallbackModels || [], supportsTools: p.supportsTools,
      supportsVision: p.supportsVision, contextWindow: p.contextWindow,
    }))
    const route = routeModel(effectiveMessage, providerInfos, provider.name)
    if (route.model !== model && route.provider === provider.name) {
      model = route.model
      console.log('[ModelRouter]', route.reason)
    }
  } catch { /* router non-critical */ }

  for (let i = 0; i < effectiveMaxIterations; i++) {
    const iterStart = Date.now()

    

    // ── THINK: emit thinking event each iteration ──
    if (i > 0) onEvent?.({ type: 'thinking', text: `迭代 #${i + 1}` })

    try {
      // ── CONTEXT COMPRESSION: auto-compress if message history too long ──
      if (messages.length > 20) {
        const { messages: compressed, compressed: wasCompressed } = compressContext(messages.slice(1), systemPromptText)
        if (wasCompressed) {
          messages = [messages[0], ...compressed] // keep system prompt
          console.log('[Loop] Context compressed: ' + messages.length + ' messages')
        }
      }
      
      // ── TOOL: streaming with fallback ──
      let fullContent = ''
      let thinkingContent = ''
      let streamedTokens = 0
      let tokenBuffer = ''
      const toolCallsAcc = new Map<string, { id: string; name: string; args: string }>()
      let streamed = false

      if ((provider as any).chatStream) {
        try {
          for await (const chunk of (provider as any).chatStream(
            { model, messages, max_tokens: isDeepDive ? 8192 : 4096, temperature: isDeepDive ? 0.1 : 0.3, tools: toolsForLLM as any },
            apiKey, undefined,
          )) {
            if (chunk.type === 'token') {
            fullContent += chunk.content; streamedTokens++;
            // Buffer first 20 chars of actual content (not thinking) to check for thinking prefix before streaming
            if (streamedTokens <= 20) {
              tokenBuffer += chunk.content
            } else {
              if (tokenBuffer) { onToken?.(tokenBuffer); tokenBuffer = '' }
              onToken?.(chunk.content)
            }
          }
            else if (chunk.type === 'thinking') { thinkingContent += chunk.content; /* thinking = hidden, never becomes response */ }
            else if (chunk.type === 'tool_call') {
              const callId = chunk.meta?.tool_call_id || 'unknown'
              let acc = toolCallsAcc.get(callId)
              if (!acc) { acc = { id: callId, name: chunk.meta?.tool_name || '', args: '' }; toolCallsAcc.set(callId, acc) }
              if (chunk.meta?.tool_name && !acc.name) acc.name = chunk.meta.tool_name
              acc.args += chunk.content
            } else if (chunk.type === 'status') { onEvent?.({ type: 'status', text: chunk.content }) }
          }
          streamed = true
        } catch (e: any) { console.log('[Loop] stream fallback:', String(e).slice(0, 80)) }
      }

      if (!streamed || streamedTokens === 0) {
        const fb = await provider.chat(
          { model, messages, max_tokens: isDeepDive ? 8192 : 4096, temperature: isDeepDive ? 0.1 : 0.3, tools: toolsForLLM as any },
          apiKey,
        )
        fullContent = fb.content || ''
        if (fb.tool_calls) {
          fb.tool_calls.forEach((tc: any) => {
            toolCallsAcc.set((tc as any).id || 'tc_' + toolCallsAcc.size, {
              id: (tc as any).id || '', name: tc.function?.name || '', args: tc.function?.arguments || '{}',
            })
          })
        }
        if (fullContent && onToken) {
          const cs = 4; for (let ci = 0; ci < fullContent.length; ci += cs) onToken(fullContent.slice(ci, ci + cs))
        }
      }

      const accTools = Array.from(toolCallsAcc.values()).filter(t => t.name)
      const hasToolCalls = accTools.length > 0
      const hasContent = fullContent && fullContent.trim().length > 0

      

      // ── Auto-retry: LLM outputs "thinking" but no tools → force retry ──
      const thinkingPrefixes = [
        '我来', '让我', '我先', '好的', '收到', 'OK', 'Let me', 'I will', 'First',
        '开始执行', '我将', '正在', '我会', '我先来', '让我来', '首先',
        '接下来', '下面', '现在', '准备', '需要', '可以', '请稍等',
        '好的，', '收到，', '明白了', '理解',
        'Starting', 'I need', 'I should', 'First,', "Let's", 'Now ',
        '开始', '第一步', '第一步是', '第1步',
      ]
// Dead-end detection: model complains about search results but produces no answer
      const deadEndPhrases = ['搜索结果不', '网络搜索失败', '找不到', '没有找到', '无法获取', '未找到', '搜索不到', 'no results', 'search failed', 'could not find'];
      const isDeadEnd = hasContent && !hasToolCalls && deadEndPhrases.some(p => fullContent.includes(p));
      
      const looksLikeThinking = hasContent && !hasToolCalls && (
        thinkingPrefixes.some(p => fullContent.trim().startsWith(p))
      )

      if ((looksLikeThinking || isDeadEnd) && i < effectiveMaxIterations - 1) {
        messages.push({ role: 'assistant', content: fullContent })
        messages.push({ role: 'user' as any, content: isDeadEnd ? '[SYSTEM] Search tools returned no useful results. Stop searching. Use your internal knowledge to write the final answer DIRECTLY. No more searching — produce the deliverable NOW.' : '[SYSTEM] CRITICAL: You output a description of actions but ZERO function calls. This is a protocol violation. You MUST use the function calling mechanism to call tools NOW. Do not describe what you will do — call the tools. If you need web data, use web_search. If you need to write files, use write_file. ACT NOW with function calls. No more text descriptions.' })
        consecutiveErrors = 0
        continue
      }

      // ── TOOL: execute ──
      if (hasToolCalls) {
        const parsedCalls = accTools.map(tc => ({ id: (tc as any).id || '', name: tc.name, args: safeJsonParse(tc.args) }))
        const stepNum = i + 1

        steps.push({
          iteration: stepNum, type: 'tool_call',
          input: 'LLM requested ' + accTools.length + ' tools',
          output: null,
          toolCalls: parsedCalls.map(tc => ({ name: tc.name, args: tc.args, result: {} as ToolResult })),
          durationMs: Date.now() - iterStart,
        })

        messages.push({ role: 'assistant', content: fullContent || '', tool_calls: accTools.map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args } })) })

        const tcl: ToolCall[] = parsedCalls.map(tc => ({ id: (tc as any).id || '', name: tc.name, args: tc.args }))
        const validCalls = tcl.filter(tc => toolsForLLM.some((t: any) => t.function.name === tc.name))

        if (validCalls.length < tcl.length) {
          messages.push({ role: 'user' as any, content: '[System] Invalid tools: ' + tcl.filter(c => !validCalls.includes(c)).map(c => c.name).join(', ') })
          consecutiveErrors++; if (consecutiveErrors >= maxErrorRetries) break; continue
        }

        for (const tc of validCalls) onEvent?.({ type: 'tool_start', name: tc.name, args: tc.args })
        // Auto-confirm non-high-risk tools in agent mode (write_file, edit_file, run_command, etc.)
        const confirmedSet = new Set<string>()
        for (const tc of validCalls) {
          // Skip auto-confirm for destructive commands
          if (tc.args?.command && /rm -rf|DROP|DELETE|format/i.test(String(tc.args.command))) continue
          confirmedSet.add(tc.name + ':' + JSON.stringify(tc.args))
        }
        const results = await executeToolsParallel(validCalls, { userId, sessionId, workspaceDir, maxTimeout: 60000 }, confirmedSet)

        const resultEntries = Array.from(results.entries())
        for (let ri = 0; ri < validCalls.length; ri++) {
          const tc = validCalls[ri]
          const resultEntry = resultEntries[ri]
          if (!resultEntry) continue
          const [, result] = resultEntry
          messages.push({ role: 'tool' as any, content: result.success ? (result.data || 'OK') : '[ERROR] ' + result.error, name: tc.name, tool_call_id: (tc as any).id || '' })
          onEvent?.({ type: 'tool_end', name: tc.name, success: result.success, summary: result.success ? 'OK' : (result.error?.slice(0, 100) || 'Failed') })

          // ── REFLECTOR: verify tool result ──
          try {
            const vr = verifyResult(tc.name, result.success ? (result.data || 'OK') : '[ERROR] ' + result.error, tc.name)
            if (!vr.passed) {
              reflectionLog.push({ stepIndex: ri, action: tc.name, result: result.success ? 'ok' : 'fail', verification: vr, retryCount: 0, finalResult: result.success ? 'passed' : 'failed' })
            }
          } catch { /* reflection is non-critical */ }
        }

        const ls = steps[steps.length - 1]
        if (ls?.toolCalls) for (let ri = 0; ri < validCalls.length; ri++) {
          const tc = ls.toolCalls[ri]
          const resultEntry = resultEntries[ri]
          if (tc && resultEntry) tc.result = resultEntry[1]
        }
        if (selfHealMode) for (const [key, result] of results.entries()) if (key.includes('run_diagnostics')) diagnosticsResult = result.data
        consecutiveErrors = 0;
        consecutiveToolOnly++;
        totalToolCalls += validCalls.length;
        
        // Force synthesis: aggressive thresholds
        let forceMsg = ''
        if (totalToolCalls >= 6) {
          forceMsg = '[SYSTEM] CRITICAL: You have made ' + totalToolCalls + ' tool calls. STOP ALL SEARCHING. You have enough data. Produce the FINAL deliverable NOW using write_file. No more web_search. No more reasoning. Output only the deliverable.'
        } else if (consecutiveToolOnly >= 3) {
          forceMsg = '[SYSTEM] You have called tools 3 times in a row without output. STOP searching. Synthesize all results into the final deliverable NOW. Use write_file to save the output. DO NOT call web_search again.'
        } else if (totalToolCalls >= 3 && i > effectiveMaxIterations - 3) {
          forceMsg = '[SYSTEM] Running out of iterations (#' + (i+1) + '/' + effectiveMaxIterations + '). You MUST produce the final output NOW. Use write_file to save it.'
        }
        
        if (forceMsg) {
          messages.push({ role: 'user' as any, content: forceMsg })
          consecutiveToolOnly = 0
        }
        continue
      }

      // ── Flush token buffer if response is valid ──
      if (tokenBuffer && !looksLikeThinking) { onToken?.(tokenBuffer); tokenBuffer = '' }

      // Reset tool-only counters only on substantial content (>150 chars, not just acknowledgments)
      const contentLen = (fullContent || '').trim().length
      if (contentLen > 150) { consecutiveToolOnly = 0; totalToolCalls = 0; /* lastRealContent tracking disabled */ }
      else if (contentLen > 20) { consecutiveToolOnly = 0 }  // Short content resets consecutive but not total

      // ── RESPOND: final answer ──
      if (hasContent) {
        messages.push({ role: 'assistant', content: fullContent })
        steps.push({ iteration: i + 1, type: 'respond', input: userMessage, output: fullContent, durationMs: Date.now() - iterStart })
        onEvent?.({ type: 'done', finish_reason: 'stop' })

        // ── REFLECTOR: final reflection ──
        try {
          const finalVerification = verifyResult(userMessage, fullContent)
          const rlog = createReflectionLog(steps.length, 'respond', fullContent.slice(0, 200), finalVerification, consecutiveErrors)
          reflectionLog.push(rlog)
        } catch { /* non-critical */ }

        // ── GHOST MODE: strip commentary ──
        const final = isGhostMode ? stripGhostResponse(fullContent) : fullContent

        // ── SKILL DISCOVERY: synchronous inline ──
        const skillToolSeq = steps.filter(s => s.type === 'tool_call').flatMap(s => s.toolCalls?.map(tc => tc.name) || [])
        let skillDiscoveryResult: any = null
        if (skillToolSeq.length >= 2) {
          try {
            skillDiscoveryResult = analyzeConversationEnd({ userId, sessionId: sessionId || 'unknown', userMessage: effectiveMessage, assistantResponse: final, toolCalls: skillToolSeq })
            if (skillDiscoveryResult.newSkillGenerated) {
              console.log('[Skill] 新技能已创建: ' + skillDiscoveryResult.newSkillGenerated)
              onEvent?.({ type: 'status', text: '🛠️ 新技能自动创建: ' + skillDiscoveryResult.newSkillGenerated })
            }
            if (skillDiscoveryResult.suggestedSkill) {
              console.log('[Skill] 建议复用: ' + skillDiscoveryResult.suggestedSkill)
              onEvent?.({ type: 'status', text: '💡 建议复用技能: ' + skillDiscoveryResult.suggestedSkill })
            }
          } catch { /* non-critical */ }
        }

        // ── EVOLUTION: record session ──
        const totalLatency = steps.reduce((s, t) => s + t.durationMs, 0)
        const evoToolSeq = steps.filter(s => s.type === 'tool_call').flatMap(s => s.toolCalls?.map(tc => tc.name) || [])
        try {
          const evoRecord = recordEvolution({
            sessionId: sessionId || 'unknown',
            strategy: evolutionStrategy?.strategy?.name || 'default',
            toolSequence: evoToolSeq,
            success: true,
            latencyMs: totalLatency,
          })
          console.log('[Evolution] Recorded:', evoRecord.id, '| score_delta:', evoRecord.score_delta)
        } catch { /* evolution recording non-critical */ }

        return { success: true, response: final, steps, totalTokens: { prompt: 0, completion: fullContent.length }, diagnosticsResult, systemPrompt: systemPromptText, reflectionLog }
      }

      // Empty response: if reasoning was generated, ask model to produce real content
      if (thinkingContent.length > 0) {
        // Model output reasoning but no content + no tool calls → push it to act
        messages.push({ role: 'user' as any, content: '[SYSTEM] 推理已收到(长度:' + thinkingContent.length + ')。现在输出结果或调用工具。不要只思考。' })
        steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Reasoning-only response (' + thinkingContent.length + ' chars)', durationMs: Date.now() - iterStart })
        continue
      }
      if (fullContent.length > 0) {
        messages.push({ role: 'user' as any, content: '[SYSTEM] 请继续输出或调用工具。' })
        steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Partial response', durationMs: Date.now() - iterStart })
        continue
      }
      steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Empty response', durationMs: Date.now() - iterStart })
      return { success: false, response: '抱歉，AI 没有返回有效回复。', steps, totalTokens: { prompt: 0, completion: 0 }, error: 'Empty response', systemPrompt: systemPromptText }

    } catch (e: any) {
      consecutiveErrors++
      const errMsg = e.message?.slice(0, 300) || String(e)
      steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Error: ' + errMsg, durationMs: Date.now() - iterStart })
      onEvent?.({ type: 'error', message: errMsg })

      // ── EVOLUTION: check known error fixes ──
      let evolutionFix: string | null = null
      try { evolutionFix = getErrorFix(errMsg) } catch { /* non-critical */ }
      if (evolutionFix) {
        messages.push({ role: 'user' as any, content: '[EVO FIX] 进化引擎发现已知修复: ' + evolutionFix })
        console.log('[Evolution] Applied known fix for:', errMsg.slice(0, 60))
      }

      // ── SELF-HEAL: auto-diagnose + retry ──
      if (selfHealMode && consecutiveErrors >= 2) {
        try {
          onEvent?.({ type: 'status', text: 'Self-heal: 自动诊断中...' })
          diagnosticsResult = await runDiagnostics({ workspaceDir })
          onEvent?.({ type: 'status', text: 'Self-heal: 诊断完成，重试中...' })
        } catch { /* diagnostics failure itself is non-critical */ }
      }
      messages.push({ role: 'user' as any, content: '[System Error] ' + errMsg + '. Please retry with adjusted approach.' })
      if (consecutiveErrors >= maxErrorRetries) {
        return { success: false, response: '连续 ' + consecutiveErrors + ' 次错误：' + errMsg, steps, totalTokens: { prompt: 0, completion: 0 }, error: 'Max retries', diagnosticsResult, systemPrompt: systemPromptText, reflectionLog }
      }
    }
  }

  return { success: false, response: '达到最大迭代次数 ' + effectiveMaxIterations, steps, totalTokens: { prompt: 0, completion: 0 }, error: 'Max iterations', diagnosticsResult, systemPrompt: systemPromptText, reflectionLog }
}

export async function runAgentDiagnostics(workspaceDir?: string): Promise<any> {
  try { const r = await runDiagnostics({ workspaceDir }); return { success: true, diagnostics: r } }
  catch (e: any) { return { success: false, error: e.message } }
}
