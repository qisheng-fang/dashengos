// packages/backend/src/core/agent/loop.ts
// DaShengOS Agent Runtime — Loop Controller v6.0
// OMNI-BRAIN OS State Machine: THINK → TOOL → RESPOND
// 2026-06-22: Full harness integration

import { appendFileSync } from "node:fs"
import { getToolsForLLM, getAllToolsForLLM, executeToolsParallel, ToolCall, ToolResult } from '../tools/registry.js'
import { getActiveProvider, getApiKey } from '../../providers/index.js'
import { runDiagnostics } from '../self-heal/diagnostics.js'
import { buildSuperSystemPrompt } from '../harness/system-prompt.js'
import { loadMemoryContext } from '../harness/memory.js'
import { analyzeConversationEnd } from '../harness/skill-discovery.js'
import { assessComplexity, generatePlan, type TaskPlan } from '../harness/planner.js'
import { verifyResult, createReflectionLog, type ReflectionLog } from '../harness/reflector.js'
import { parseMacros, stripGhostResponse, type ParsedMacros } from './macro-parser.js'

function stripGreeting(text: string): string {
  const g = [/^你好[！!，,。.]*\s*/, /^Hi[！!，,。.]*\s*/i, /^Hello[！!，,。.]*\s*/i,
    /^好的[！!，,。.]*\s*/, /^收到[！!，,。.]*\s*/, /^OK[！!，,。.]*\s*/i,
    /^你好！有什么可以[帮为]你的[？?]?？\s*/, /^有什么可以[帮为]你的[？?]？\s*/]
  for (const p of g) text = text.replace(p, '')
  return text.replace(/^[吗呢][？?]\s*/, '').trim()
}
import { routeModel } from '../model-router.js'
import { recordEvolution, recommendStrategy, getErrorFix } from '../self-evolve.js'
import { selfCritique, type CritiqueResult } from '../self-critique.js'
import { compressContext, quickCompress } from '../context-compressor.js'
import { recordToolTrace, saveCheckpoint, consumeTokens, setTokenBudget } from '../tool-tracer.js'
import { trace, exportTrace } from '../otel-tracer.js'
import { getLoopDetector, resetLoopDetector } from '../semantic-loop-detector.js'
import { executeWithFallback } from '../model-fallback.js'
import { getOfflineMCPToolNames } from '../mcp-client.js'
import { evolveUserProfile } from '../user-profile-evolver.js'
import { appendLedger } from '../memory-ledger.js'

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
  critique?: { severity: string; issues: number; improvementRatio: number }
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
      taskType: (opts.selfHealMode ? 'technical' : opts.taskType || 'chat') as any, query: undefined,
    })
  } catch {
    return buildSuperSystemPrompt({ mode: 'agent', taskType: opts.selfHealMode ? 'technical' : 'chat' })
  }
}

function crashLog(msg: string) {
  try { appendFileSync('/tmp/dasheng-loop-crash.log', new Date().toISOString() + ' ' + msg + '\n') } catch {}
}

export async function runAgentLoop(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  crashLog('=== runAgentLoop START ===')
  const {
    userId, sessionId, workspaceDir, systemPrompt,
    maxIterations = 25, maxErrorRetries = 3,
    elevatedMode = false, selfHealMode = false,
    onEvent, onToken,
  } = options

  const steps: AgentLoopStep[] = []
  const reflectionLog: ReflectionLog[] = []
  const toolsForLLM = (elevatedMode ? getAllToolsForLLM() : getToolsForLLM()).filter((t: any) => {
    const name = t.function?.name || ''
    // Filter out tools from offline MCP servers
    if (name.startsWith('mcp__')) {
      const offlineTools = getOfflineMCPToolNames()
      if (offlineTools.has(name)) {
        console.log('[Loop] Skipping offline MCP tool:', name)
        return false
      }
    }
    return true
  })

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

  // ── Token budget: prevent runaway token consumption ──
  setTokenBudget(sessionId, 200000, 600000)
  const loopDetector = getLoopDetector()
  loopDetector.reset()  // 200K tokens per 10min session
  let consecutiveErrors = 0
  let consecutiveToolOnly = 0  // Track consecutive tool-only iterations
  let consecutiveThinkingOnly = 0 // Track consecutive thinking-only iterations
  let totalToolCalls = 0       // Total tool calls across all iterations (for force-synthesis)
  // lastRealContent tracking removed (unused)
  let diagnosticsResult: any = null
  // ── INTELLIGENT MODEL ROUTING ──
  // Env override takes priority (respects user's DEEPSEEK_DEFAULT_MODEL)
  const envModel = process.env[(provider as any).name?.toUpperCase() + '_DEFAULT_MODEL'] || process.env.DEEPSEEK_DEFAULT_MODEL
  let model = envModel || (provider as any).defaultModel || 'deepseek-v4-flash'
  try {
    const { getProviders } = await import('../../providers/index.js')
    const allProviders = getProviders()
    const providerInfos = allProviders.map((p: any) => ({
      name: p.name, displayName: p.displayName, defaultModel: p.defaultModel,
      fallbackModels: p.fallbackModels || [], supportsTools: p.supportsTools,
      supportsVision: p.supportsVision, contextWindow: p.contextWindow,
    }))
    // Only auto-route if no explicit env model override
    if (!envModel) {
      const route = routeModel(effectiveMessage, providerInfos, provider.name)
      if (route.model !== model && route.provider === provider.name) {
        model = route.model
        console.log('[ModelRouter]', route.reason)
      }
    } else {
      console.log('[ModelRouter] Skipped — using env override:', envModel)
    }
  } catch { /* router non-critical */ }

  for (let i = 0; i < effectiveMaxIterations; i++) {
    const iterStart = Date.now()

    

    // ── THINK: emit thinking event each iteration ──
    if (i > 0) onEvent?.({ type: 'thinking', text: `迭代 #${i + 1}` })

    try {
      // ── CONTEXT COMPRESSION: token-triggered, LLM-powered ──
      const estTokens = messages.reduce((sum, m) => sum + Math.ceil(((m.content||'').length) / 2.5), 0)
      if (estTokens > 50000 || messages.length > 30) {
        const result = await compressContext(messages.slice(1), systemPromptText)
        if (result.compressed) {
          messages = [messages[0], ...result.messages]
          console.log(`[Loop] Context compressed: ${result.stats.originalMessages}→${result.stats.compressedMessages} msgs, ${result.stats.originalTokens}→${result.stats.compressedTokens}t`)
          onEvent?.({ type: 'thinking', text: `📦 上下文压缩: ${result.stats.originalMessages}→${result.stats.compressedMessages} 条` })
        }
      }
      
      crashLog('iteration ' + i + ' start, messages=' + messages.length)
      // ── TOOL: streaming with fallback ──
      let fullContent = ''
      let thinkingContent = ''
      let streamedTokens = 0
      let tokenBuffer = ''
      const toolCallsAcc = new Map<string, { id: string; name: string; args: string }>()
      let streamed = false

      // v4-pro reasoning model → non-streaming (avoids reasoning/tool stream bugs)
      const isReasoningModel = model === 'deepseek-v4-pro' || model === 'deepseek-reasoner'
      let fb: any = null  // declared in outer scope for access after streaming block
      if (!isReasoningModel && (provider as any).chatStream) {
        try {
          for await (const chunk of (provider as any).chatStream(
            { model, messages, max_tokens: isDeepDive ? 12288 : 8192, temperature: isDeepDive ? 0.1 : 0.3, tools: toolsForLLM as any },
            apiKey, AbortSignal.timeout(120_000),
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
        crashLog('non-streaming call, model=' + model + ' msgs=' + messages.length)
        
        // For reasoning models: emit periodic status so user sees activity
        let statusInterval: any = null
        if (isReasoningModel) {
          let dots = 0
          onEvent?.({ type: 'status', text: 'DeepSeek 推理中...' })
          statusInterval = setInterval(() => {
            dots = (dots + 1) % 4
            onEvent?.({ type: 'status', text: 'DeepSeek 推理中' + '.'.repeat(dots) })
          }, 2000)
        }
        
        fb = await provider.chat(
          { model, messages, max_tokens: isDeepDive ? 12288 : 8192, temperature: isDeepDive ? 0.1 : 0.3, tools: toolsForLLM as any },
          apiKey,
        )
        
        if (statusInterval) clearInterval(statusInterval)
        crashLog('response received, content_len=' + (fb.content?.length || 0) + ' tool_calls=' + (fb.tool_calls?.length || 0) + ' reasoning=' + (((fb as any).reasoning_content?.length) || 0))
        fullContent = fb.content || ''
        if ((fb as any).reasoning_content) {
          thinkingContent = (fb as any).reasoning_content
          onEvent?.({ type: 'thinking', text: '[推理] ' + thinkingContent.slice(0, 100) + (thinkingContent.length > 100 ? '...' : '') })
        }
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
      let hasContent = fullContent && fullContent.trim().length > 0

      

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

      crashLog('content_check: hasContent=' + hasContent + ' hasTools=' + hasToolCalls + ' looksThink=' + looksLikeThinking + ' deadEnd=' + isDeadEnd)
      if ((looksLikeThinking || isDeadEnd) && i < effectiveMaxIterations - 1) {
        consecutiveThinkingOnly++
        if (consecutiveThinkingOnly < 3) {
          // First 2 thinking iterations: gentle nudge
          messages.push({ role: 'assistant', content: fullContent })
          messages.push({ role: 'user' as any, content: isDeadEnd ? '[SYSTEM] Search had no results. STOP searching. Use internal knowledge to write the final answer DIRECTLY.' : '[SYSTEM] You described your plan but did not act. Use function calls to execute tools now.' })
          continue
        }
        // 3rd+ thinking iteration: hard push
        if ((fb as any)?.reasoning_content && !thinkingContent) {
          thinkingContent = (fb as any).reasoning_content
        }
        messages.push({ role: 'assistant', content: fullContent, ...(thinkingContent ? { reasoning_content: thinkingContent } : {}) })
        messages.push({ role: 'user' as any, content: isDeadEnd ? '[SYSTEM] Search tools returned no useful results. Stop searching. Use your internal knowledge to write the final answer DIRECTLY. No more searching — produce the deliverable NOW.' : '[SYSTEM] CRITICAL: You output descriptions but ZERO function calls after ' + (consecutiveThinkingOnly + 1) + ' attempts. You MUST call tools NOW. If you need web data, use web_search. If you need to write files, use write_file. ACT NOW with function calls. No more text.' })
        consecutiveErrors = 0
        continue
      }
      consecutiveThinkingOnly = 0  // reset thinking counter on success

      // ── TOOL: execute ──
      if (hasToolCalls) {
        crashLog('executing ' + accTools.length + ' tools: ' + accTools.map(t=>t.name).join(','))
        const parsedCalls = accTools.map(tc => ({ id: (tc as any).id || '', name: tc.name, args: safeJsonParse(tc.args) }))
        const stepNum = i + 1

        steps.push({
          iteration: stepNum, type: 'tool_call',
          input: 'LLM requested ' + accTools.length + ' tools',
          output: null,
          toolCalls: parsedCalls.map(tc => ({ name: tc.name, args: tc.args, result: {} as ToolResult })),
          durationMs: Date.now() - iterStart,
        })

        const tcl: ToolCall[] = parsedCalls.map(tc => ({ id: (tc as any).id || '', name: tc.name, args: tc.args }))
        
        // ── SEMANTIC LOOP DETECTION ──
        loopDetector.recordIteration(i, fullContent, tcl.map(tc => tc.name), [])
        const loopAlert = loopDetector.detect()
        if (loopAlert.detected) {
          const intervention = loopDetector.getIntervention(loopAlert)
          if (intervention) {
            console.log(`[Loop] Semantic loop detected: ${loopAlert.type} (confidence=${loopAlert.confidence.toFixed(2)})`)
            onEvent?.({ type: 'thinking', text: `⚠️ ${loopAlert.type} detected — forcing synthesis` })
            messages.push({ role: 'user' as any, content: intervention })
            if (loopAlert.type === 'exact_repeat' || loopAlert.type === 'semantic_loop') break
          }
        }
        const validCalls = tcl.filter(tc => toolsForLLM.some((t: any) => t.function.name === tc.name))

        if (validCalls.length < tcl.length) {
          messages.push({ role: 'user' as any, content: '[System] Invalid tools: ' + tcl.filter(c => !validCalls.includes(c)).map(c => c.name).join(', ') })
          consecutiveErrors++; if (consecutiveErrors >= maxErrorRetries) break; continue
        }

        // Push assistant message with tool_calls + reasoning_content (DeepSeek reasoner requires both for multi-turn)
        const assistantMsg: any = { role: 'assistant', content: fullContent || '', tool_calls: validCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) }
        if (thinkingContent) assistantMsg.reasoning_content = thinkingContent
        messages.push(assistantMsg)

        for (const tc of validCalls) onEvent?.({ type: 'tool_start', name: tc.name, args: tc.args })
        // Auto-confirm non-high-risk tools in agent mode (write_file, edit_file, run_command, etc.)
        const confirmedSet = new Set<string>()
        for (const tc of validCalls) {
          // Skip auto-confirm for destructive commands
          if (tc.args?.command && /rm -rf|DROP|DELETE|format/i.test(String(tc.args.command))) continue
          confirmedSet.add(tc.name + ':' + JSON.stringify(tc.args))
        }
        onEvent?.({ type: "status", text: "正在执行 " + validCalls.length + " 个工具..." })
        const results = await executeToolsParallel(validCalls, { userId, sessionId, workspaceDir, maxTimeout: 60000 }, confirmedSet)

        const resultEntries = Array.from(results.entries())
        // ── Record tool traces for replay/audit ──
        for (let ri = 0; ri < validCalls.length; ri++) {
          const tc = validCalls[ri]
          const resultEntry = resultEntries[ri]
          if (resultEntry) {
            recordToolTrace({
              sessionId, userId, iteration: i, stepIndex: ri,
              toolName: tc.name, toolArgs: tc.args,
              result: { success: resultEntry[1].success, data: resultEntry[1].data?.slice?.(0,1000), error: resultEntry[1].error, durationMs: 0 },
            })
          }
        }
        for (let ri = 0; ri < validCalls.length; ri++) {
          const tc = validCalls[ri]
          const resultEntry = resultEntries[ri]
          if (!resultEntry) continue
          const [, result] = resultEntry
          const truncatedData = result.success ? ((result.data || 'OK').length > 2000 ? (result.data || 'OK').slice(0, 2000) + '...(truncated)' : (result.data || 'OK')) : '[ERROR] ' + (result.error || 'Unknown').slice(0, 500)
          messages.push({ role: 'tool' as any, content: truncatedData, name: tc.name, tool_call_id: (tc as any).id || '' })
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
        crashLog('tools done, results=' + results.size + ' content_len=' + fullContent.length)
        // ── Tool completion status: keep user informed ──
        onEvent?.({ type: 'status', text: `工具执行完毕 (${results.size}个)，分析结果中...` })
        // ── Save checkpoint after tool execution ──
        try {
          const toolResultsMap: Record<string, any> = {}
          for (const [key, r] of results.entries()) toolResultsMap[key] = { success: r.success, data: r.data?.slice?.(0,500), error: r.error }
          saveCheckpoint({ sessionId, iteration: i, messages, toolResults: toolResultsMap })
        } catch { /* checkpoint non-critical */ }
        // ── Token budget check ──
        const estTokens = messages.reduce((sum: number, m: any) => sum + Math.ceil(((m.content || '').length) / 2.5), 0)
        const tokenCheck = consumeTokens(sessionId, estTokens)
        if (!tokenCheck.allowed) {
          console.log(`[Loop] Token budget exceeded: ${tokenCheck.used}/${tokenCheck.budget}. Forcing synthesis.`)
          messages.push({ role: 'user' as any, content: '[SYSTEM] Token budget exhausted. Output final result immediately. NO tools.' })
          break
        }
        consecutiveErrors = 0;
        consecutiveToolOnly++;
        totalToolCalls += validCalls.length;
        crashLog('iter ' + i + ': totalToolCalls=' + totalToolCalls + ' consecutiveToolOnly=' + consecutiveToolOnly)
        
        // Force synthesis: aggressive thresholds
        let forceMsg = ''
        let hardBreak = false
        if (totalToolCalls >= 5) {
          hardBreak = true
          forceMsg = '[SYSTEM] HARD STOP: ' + totalToolCalls + ' tool calls completed. You have sufficient data. Output the FINAL result as content NOW. NO more tools. NO more reasoning. First character of your response must be the deliverable. If you call another tool, the task fails.'
        } else if (consecutiveToolOnly >= 2) {
          forceMsg = '[SYSTEM] 2 tool-only iterations. STOP searching. Synthesize all results into the final deliverable NOW. Output content, NOT tools.'
        }
        
        if (forceMsg) {
          messages.push({ role: 'user' as any, content: forceMsg })
          consecutiveToolOnly = 0
        }
        
        // Hard break: give LLM one final chance to synthesize
        if (hardBreak && i < effectiveMaxIterations - 1) {
          crashLog('HARD BREAK — one final synthesis attempt')
          try {
            // Collect raw results for fallback
            const rawData: string[] = []
            for (let mi = messages.length - 1; mi >= 0 && rawData.length < 8; mi--) {
              if (messages[mi].role === 'tool') {
                const c = String(messages[mi].content || '')
                if (c.length > 10 && c !== 'OK') rawData.unshift(c.slice(0, 600))
              }
            }
            
            const synthPrompt = '[SYSTEM] FINAL SYNTHESIS: User asked: "' + effectiveMessage.slice(0, 200) + '". You have ' + totalToolCalls + ' tool results above. Produce the COMPLETE final deliverable as content NOW. No more tools. No more reasoning. Output the user\'s requested deliverable directly.';
            const synthMessages = [...messages, { role: 'user' as any, content: synthPrompt }]
            crashLog('HARD BREAK — calling LLM for final synthesis, msgs=' + synthMessages.length)
            
            // Make final synthesis call WITHOUT tools to force content output
            const synthResp = await provider.chat(
              { model, messages: synthMessages, max_tokens: 12288, temperature: 0.3, tools: undefined as any },
              apiKey,
            )
            const synthContent = synthResp?.content || ''
            const synthTools = synthResp?.tool_calls || []
            
            // Strip XML tool_call blocks that deepseek-v4-pro may output as content
            let cleanContent = synthContent || ''
            cleanContent = cleanContent.replace(/<invoke name="[^"]*"[^>]*>[\s\S]*?<\/invoke>/g, '')
            cleanContent = cleanContent.replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/g, '')
            cleanContent = cleanContent.replace(/<function_calls>[\s\S]*?<\/function_calls>/g, '')
            cleanContent = cleanContent.trim()
            
            if (cleanContent.length > 50) {
              crashLog('HARD BREAK — LLM synthesis success, ' + cleanContent.length + ' chars (cleaned)')
              steps.push({ iteration: i + 1, type: 'respond', input: 'Final synthesis from ' + totalToolCalls + ' tool calls', output: cleanContent.slice(0, 200), durationMs: Date.now() - iterStart })
              return { success: true, response: cleanContent, steps, totalTokens: { prompt: 0, completion: cleanContent.length }, systemPrompt: systemPromptText, reflectionLog }
            }
            
            // Fallback: LLM didn't produce content, use raw synthesis
            crashLog('HARD BREAK — LLM returned no content (len=' + synthContent.length + ' tools=' + synthTools.length + '), using raw fallback')
          } catch (synthErr: any) {
            crashLog('HARD BREAK — synthesis call failed: ' + (synthErr.message || 'unknown'))
          }
          
          // Raw fallback synthesis — semantic dedup + structured labeling
          const rawData2: Array<{ source: string; content: string }> = []
          const seenHashes = new Set<string>()
          for (let mi = messages.length - 1; mi >= 0 && rawData2.length < 8; mi--) {
            if (messages[mi].role === 'tool') {
              const c = String(messages[mi].content || '')
              if (c.length > 10 && c !== 'OK') {
                // Semantic dedup: hash first 100 chars to avoid near-duplicates
                const hash = c.slice(0, 100).replace(/\s+/g, ' ').trim()
                if (!seenHashes.has(hash)) {
                  seenHashes.add(hash)
                  const source = (messages[mi] as any).name || 'tool'
                  rawData2.unshift({ source, content: c.slice(0, 800) })
                }
              }
            }
          }
          if (rawData2.length > 0) {
            const sections = rawData2.map((r, i) => {
              const label = r.source.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
              return `## ${label}\n${r.content}`
            })
            const synth = sections.join('\n\n---\n\n')
            steps.push({ iteration: i + 1, type: 'respond', input: 'Structured synthesis from ' + totalToolCalls + ' tool calls (' + rawData2.length + ' deduped)', output: synth.slice(0, 300), durationMs: Date.now() - iterStart })
            crashLog('HARD BREAK complete (structured), ' + synth.length + ' chars from ' + rawData2.length + ' deduped results')
            return { success: true, response: synth, steps, totalTokens: { prompt: 0, completion: synth.length }, systemPrompt: systemPromptText, reflectionLog }
          }
        }
        continue
      }

      // ── Flush token buffer if response is valid ──
      if (tokenBuffer && !looksLikeThinking) { onToken?.(tokenBuffer); tokenBuffer = '' }

      // Reset tool-only counters only on substantial content (>150 chars, not just acknowledgments)
      const contentLen = (fullContent || '').trim().length
      if (contentLen > 150) { consecutiveToolOnly = 0; totalToolCalls = 0; /* lastRealContent tracking disabled */ }
      else if (contentLen > 20) { consecutiveToolOnly = 0 }  // Short content resets consecutive but not total

      crashLog('entering RESPOND, content=' + fullContent.slice(0, 80))
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
        const final = stripGreeting(isGhostMode ? stripGhostResponse(fullContent) : fullContent)

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

        // ── Evolve user profile after successful session completion ──
        try {
          const allSessionMsgs = conversationHistory.concat([{ role: 'user' as const, content: effectiveMessage }])
          if (fullContent) allSessionMsgs.push({ role: 'assistant' as const, content: fullContent })
          evolveUserProfile({
            userId, username: 'admin', role: 'ADMIN',
            sessionMessages: allSessionMsgs,
            toolCallsInSession: steps.filter(s => s.type === 'tool_call').flatMap(s => s.toolCalls?.map(tc => tc.name) || []),
            sessionDurationMs: Date.now() - startTime,
          })
        } catch { /* evolution non-critical */ }

        // ── SELF-CRITIQUE v8.1: Hermes-style self-review ──
        let critiqueResult: CritiqueResult | undefined
        const shouldCritique = !elevatedMode && final.length > 80 && fullContent.length > 200
        if (shouldCritique) {
          try {
            onEvent?.({ type: 'status', text: '🔍 自我审查中...' })
            critiqueResult = await selfCritique(final, effectiveMessage, {
              enabled: true,
              maxRetries: 1,
              minContentLength: 80,
              timeoutMs: 25000,
            })
            if (critiqueResult.severity !== 'none' && critiqueResult.revised !== final) {
              onEvent?.({ type: 'status', text: '🔧 已修正 ' + critiqueResult.issues.length + ' 个问题' })
              reflectionLog.push(createReflectionLog(steps.length, 'self-critique', final.slice(0, 200), {
                passed: critiqueResult.severity !== 'critical',
                issues: critiqueResult.issues.map(i => ({ type: 'format_violation' as const, severity: 'warning' as const, description: i.type + ': ' + i.description })),
                retryRecommended: false,
                confidence: 1 - critiqueResult.issues.length * 0.1,
              }, 0))
              return { success: true, response: critiqueResult.revised, steps, totalTokens: { prompt: 0, completion: critiqueResult.revised.length }, diagnosticsResult, systemPrompt: systemPromptText, reflectionLog, critique: { severity: critiqueResult.severity, issues: critiqueResult.issues.length, improvementRatio: critiqueResult.improvementRatio } }
            }
          } catch (e: any) {
            console.warn('[SelfCritique] Critique failed, using original:', e.message)
          }
        }

        return { success: true, response: final, steps, totalTokens: { prompt: 0, completion: fullContent.length }, diagnosticsResult, systemPrompt: systemPromptText, reflectionLog }
      }

      // Empty response: if reasoning was generated, ask model to produce real content
      if (thinkingContent.length > 0) {
        // Model output reasoning but no content + no tool calls → push it to act
        messages.push({ role: 'user' as any, content: '[SYSTEM] 推理已收到(长度:' + thinkingContent.length + ')。现在输出结果或调用工具。不要只思考。' })
        steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Reasoning-only response (' + thinkingContent.length + ' chars)', durationMs: Date.now() - iterStart })
        continue
      }
      // v4-pro reasoning model: content empty + no tools → retry with push
      if (fullContent.length === 0 && hasToolCalls === false && isReasoningModel) {
        messages.push({ role: 'user' as any, content: '[SYSTEM] 收到推理结果，但需要实际输出。现在直接输出最终结果。不要继续推理。' })
        steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: 'Empty content from reasoning model', durationMs: Date.now() - iterStart })
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
      crashLog('CAUGHT ERROR iter=' + i + ': ' + (e.message?.slice(0, 200) || String(e)))
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
