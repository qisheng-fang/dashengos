// packages/backend/src/core/agent/loop.ts
// DaShengOS Agent Runtime — Loop Controller
// 观察→思考→行动→验证→迭代 循环引擎
// P3 (2026-06-18): 集成自我诊断/修复模式

import { getToolsForLLM, getAllToolsForLLM, executeTool, executeToolsParallel, ToolCall, ToolResult } from '../tools/registry.js'
import { getActiveProvider, getApiKey } from '../../providers/index.js'
import { runDiagnostics } from '../self-heal/diagnostics.js'

// ─── Types ─────────────────────────────────────────────

export interface AgentLoopOptions {
  userId: string
  sessionId?: string
  workspaceDir: string
  systemPrompt?: string
  maxIterations?: number    // default 25
  maxErrorRetries?: number // default 3
  elevatedMode?: boolean   // if true, skip confirmation gate
  selfHealMode?: boolean  // if true, enable self-heal capabilities
}

export interface AgentLoopStep {
  iteration: number
  type: 'think' | 'tool_call' | 'respond' | 'error' | 'diagnose'
  input: string
  output: string | null
  toolCalls?: Array<{ name: string; args: Record<string, any>; result: ToolResult }>
  durationMs: number
}

export interface AgentLoopResult {
  success: boolean
  response: string          // final text response to user
  steps: AgentLoopStep[]     // full execution trace
  totalTokens: { prompt: number; completion: number }
  error?: string
  needsConfirmation?: Array<{ name: string; args: Record<string, any> }>
  diagnosticsResult?: any   // if selfHealMode=true and diagnostics were run
}

function normalizeUsage(
  u?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
): { prompt: number; completion: number } {
  return u ? { prompt: u.prompt_tokens, completion: u.completion_tokens } : { prompt: 0, completion: 0 }
}

// ─── System Prompt (Agent Mode) ────────────────────────

const AGENT_SYSTEM_PROMPT = `You are DaShengOS Agent Runtime, an autonomous AI assistant that can read files, run commands, search code, and fix problems.

## Your Capabilities
- Read/write/edit files in the project workspace
- Run shell commands (build, test, install dependencies)
- Search code with regex patterns
- Check process/port status
- Query the database (read-only)
- Fetch web content and search

## Rules
1. ALWAYS use tools when you need to gather information or make changes
2. When a task requires multiple steps, do them one at a time — don't try to do everything in one call
3. If a tool returns an error, analyze it and try a different approach
4. Be concise but thorough — show your reasoning when using tools
5. Never guess file contents — always use read_file to check first
6. Prefer edit_file over write_file for small changes (safer)
7. After fixing something, verify the fix worked

## Safety
- You operate within the project directory sandbox
- Some operations require user confirmation
- Always explain what you're going to do before doing it`

const SELF_HEAL_SYSTEM_PROMPT = `You are DaShengOS Self-Heal Agent, an autonomous AI system administrator that can diagnose and fix problems.

## Your Capabilities
- Run system diagnostics (processes, ports, disk, build status)
- Analyze error logs and identify patterns
- Fix common issues (restart services, install dependencies, fix configs)
- Read/write/edit system files
- Execute shell commands with user approval

## Self-Heal Workflow
1. **Diagnose**: When user reports an issue or system seems unhealthy, run diagnostics first
2. **Analyze**: Identify root cause from error patterns and health checks
3. **Plan**: Propose fix steps (explain what you'll do)
4. **Confirm**: Wait for user approval for write operations
5. **Execute**: Apply fixes one at a time
6. **Verify**: Re-run diagnostics to confirm fix worked

## Available Diagnostic Tools
- run_diagnostics: Full system diagnosis (processes, ports, disk, build)
- quick_health_check: Fast health check
- read_logs: Read and analyze log files
- check_process: Check if a process is running
- check_port: Check if a port is listening

## Rules
1. ALWAYS run diagnostics before attempting fixes
2. Explain your diagnosis and proposed fix clearly
3. For dangerous operations (rm -rf, system config changes), emphasize the risk
4. After each fix, verify it worked
5. If you can't fix it, explain why and suggest manual steps

## Safety
- You operate within the project directory sandbox
- Write operations require user confirmation (unless elevated mode)
- Never execute unverified commands from logs`

// ─── Main Loop ─────────────────────────────────────────

/**
 * Run the agent loop: send user message through LLM → tool_calls → execute → loop.
 * This is the core of the self-repair / autonomous capability.
 */
export async function runAgentLoop(
  userMessage: string,
  conversationHistory: Array<{ role: string; content: string }> = [],
  options: AgentLoopOptions
): Promise<AgentLoopResult> {
  const {
    userId,
    sessionId,
    workspaceDir,
    systemPrompt,
    maxIterations = 25,
    maxErrorRetries = 3,
    elevatedMode = false,
    selfHealMode = false,
  } = options

  const steps: AgentLoopStep[] = []
  const toolsForLLM = elevatedMode ? getAllToolsForLLM() : getToolsForLLM()

  // Choose system prompt based on mode
  const systemPromptText = systemPrompt || (selfHealMode ? SELF_HEAL_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT)

  // Build messages array for LLM
  const messages: Array<any> = [
    { role: 'system', content: systemPromptText },
    ...conversationHistory.map(m => ({ role: m.role === 'assistant' ? 'assistant' : m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let consecutiveErrors = 0
  const pendingConfirmations: Array<{ name: string; args: Record<string, any> }> = []
  let diagnosticsResult: any = null

  // ── Main loop ──
  for (let i = 0; i < maxIterations; i++) {
    const iterStart = Date.now()

    try {
      // Step 1: Call LLM with tools available
      const provider = getActiveProvider()
      if (!provider) {
        steps.push({ iteration: i + 1, type: 'error', input: userMessage, output: null, durationMs: Date.now() - iterStart })
        return {
          success: false,
          response: '错误：没有可用的 LLM 提供商。请检查 LLM_PROVIDER 配置。',
          steps,
          totalTokens: { prompt: 0, completion: 0 },
          error: 'No active LLM provider',
        }
      }

      // Call LLM with tools
      const apiKey = getApiKey(provider) || ''
      const llmResponse = await provider.chat(
        {
          messages,
          max_tokens: 4096,
          temperature: 0.3,
          tools: toolsForLLM as any,
        },
        apiKey,
      )

      // Check what LLM returned
      const hasToolCalls = llmResponse.tool_calls && llmResponse.tool_calls.length > 0
      const hasContent = llmResponse.content && llmResponse.content.trim().length > 0

      if (hasToolCalls) {
        const tcs = llmResponse.tool_calls!
        // ── TOOL_CALL state: execute tools and feed results back ──
        steps.push({
          iteration: i + 1,
          type: 'tool_call',
          input: `LLM requested ${tcs.length} tool call(s)`,
          output: null,
          toolCalls: tcs.map((tc: any) => ({ name: tc.function.name, args: JSON.parse(tc.function.arguments), result: {} as ToolResult })),
          durationMs: Date.now() - iterStart,
        })

        // Add LLM's response (with tool_calls) to message history
        messages.push({
          role: 'assistant',
          content: llmResponse.content || '',
          tool_calls: tcs,
        })

        // Execute all tool calls
        const toolCallList: ToolCall[] = tcs.map((tc: any) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        }))

        // Filter to only valid tool names
        const validCalls = toolCallList.filter(tc => toolsForLLM.some((t: any) => t.function.name === tc.name))

        if (validCalls.length < toolCallList.length) {
          const invalidNames = toolCallList.filter(c => !validCalls.includes(c)).map(c => c.name)
          messages.push({
            role: 'user' as any,
            content: `[System] Error: The following tools are not available: ${invalidNames.join(', ')}. Available tools: ${toolsForLLM.map((t: any) => t.function.name).join(', ')}. Please try again.`,
          })
          consecutiveErrors++
          if (consecutiveErrors >= maxErrorRetries) break
          continue
        }

        // Execute tools (with confirmation gate if not elevated mode)
        const execContext = { userId, sessionId, workspaceDir, maxTimeout: 30000 }
        
        let results: Map<string, ToolResult>
        if (!elevatedMode && selfHealMode) {
          // Use confirmation gate for write operations
          results = new Map()
          for (const tc of validCalls) {
            const result = await executeTool(tc, execContext)
            results.set(`${tc.name}:${JSON.stringify(tc.args)}`, result)
          }
        } else {
          // Execute in parallel (no confirmation gate)
          results = await executeToolsParallel(validCalls, execContext)
        }

        // Check for confirmation requests
        const needConfirmation = new Map<string, ToolResult>()
        for (const [key, result] of results.entries()) {
          if (result.needsConfirmation) {
            needConfirmation.set(key, result)
          }
        }

        if (needConfirmation.size > 0 && !elevatedMode) {
          // Collect pending confirmations and stop loop
          for (const [key, _result] of needConfirmation.entries()) {
            const [name, argsStr] = key.split(':')
            pendingConfirmations.push({ name, args: JSON.parse(argsStr) })
          }
          // Feed back that confirmation is needed
          messages.push({
            role: 'user' as any,
            content: `[User Confirmation Required] The following operations need user approval before proceeding:\n${pendingConfirmations.map(c => `- **${c.name}**: ${JSON.stringify(c.args).slice(0, 200)}`).join('\n')}\nPlease wait for user confirmation.`,
          })

          // Return partial result with confirmation request
          return {
            success: true,
            response: `⚠️ 需要 ${pendingConfirmations.length} 个操作的用户确认后才能继续执行。`,
            steps,
            totalTokens: normalizeUsage(llmResponse.usage),
            needsConfirmation: pendingConfirmations,
            diagnosticsResult,
          }
        }

        // Add tool results to message history (OpenAI format: each tool result as a separate message)
        for (const [key, result] of results.entries()) {
          const [name] = key.split(':')
          messages.push({
            role: 'tool' as any,
            content: result.success
              ? result.data || 'Operation completed successfully'
              : `[ERROR] ${result.error}`,
            name,
            tool_call_id: '', // not strictly needed for non-streaming
          })
        }

        // Update step with actual results
        const lastStep = steps[steps.length - 1]
        if (lastStep?.toolCalls) {
          for (const tc of lastStep.toolCalls) {
            for (const [key, r] of results.entries()) {
              if (key.startsWith(tc.name + ':')) {
                tc.result = r
                break
              }
            }
          }
        }

        // If self-heal mode and diagnostics were run, store results
        if (selfHealMode) {
          for (const [key, result] of results.entries()) {
            if (key.includes('run_diagnostics')) {
              diagnosticsResult = result.data
            }
          }
        }

        consecutiveErrors = 0 // reset on successful tool execution
        continue // next iteration: LLM sees tool results and decides next action

      } else if (hasContent) {
        // ── RESPOND state: LLM returned text, we're done ──
        messages.push({
          role: 'assistant',
          content: llmResponse.content,
        })

        steps.push({
          iteration: i + 1,
          type: 'respond',
          input: userMessage,
          output: llmResponse.content,
          durationMs: Date.now() - iterStart,
        })

        return {
          success: true,
          response: llmResponse.content,
          steps,
          totalTokens: normalizeUsage(llmResponse.usage),
          diagnosticsResult,
        }
      } else {
        // No content, no tool_calls — edge case
        steps.push({
          iteration: i + 1,
          type: 'error',
          input: userMessage,
          output: 'LLM returned empty response with no tool calls',
          durationMs: Date.now() - iterStart,
        })
        return {
          success: false,
          response: '抱歉，AI 没有返回有效回复。',
          steps,
          totalTokens: normalizeUsage(llmResponse.usage),
          error: 'Empty LLM response',
        }
      }

    } catch (e: any) {
      consecutiveErrors++
      const errMsg = e.message?.slice(0, 300) || String(e)

      steps.push({
        iteration: i + 1,
        type: 'error',
        input: userMessage,
        output: `Error at step ${i + 1}: ${errMsg}`,
        durationMs: Date.now() - iterStart,
      })

      // If self-heal mode, try to run diagnostics automatically on errors
      if (selfHealMode && consecutiveErrors >= 2) {
        try {
          console.log('[Agent Loop] 检测到连续错误，自动触发诊断...')
          const diagResult = await runDiagnostics({ workspaceDir })
          steps.push({
            iteration: i + 1,
            type: 'diagnose',
            input: 'Auto-diagnostics triggered due to consecutive errors',
            output: `Diagnostics: healthy=${diagResult.healthy}, errors=${diagResult.errors.length}`,
            durationMs: 0,
          })
          diagnosticsResult = diagResult
        } catch (diagErr) {
          console.error('[Agent Loop] 自动诊断失败:', diagErr)
        }
      }

      // Feed error back to LLM so it can retry
      messages.push({
        role: 'user' as any,
        content: `[System Error] ${errMsg}. Please retry or try a different approach.`,
      })

      if (consecutiveErrors >= maxErrorRetries) {
        return {
          success: false,
          response: `执行过程中遇到 ${consecutiveErrors} 次连续错误。最后错误：${errMsg}`,
          steps,
          totalTokens: { prompt: 0, completion: 0 },
          error: `Max error retries (${maxErrorRetries}) exceeded`,
          diagnosticsResult,
        }
      }
    }
  }

  // Max iterations reached without finishing
  return {
    success: false,
    response: `Agent 运行达到最大迭代次数 (${maxIterations}) 但仍未完成。可能需要更复杂的任务分解。`,
    steps,
    totalTokens: { prompt: 0, completion: 0 },
    error: `Max iterations (${maxIterations}) reached`,
    diagnosticsResult,
  }
}

/**
 * Run diagnostics and return formatted result (helper for API endpoint)
 */
export async function runAgentDiagnostics(workspaceDir?: string): Promise<any> {
  try {
    const result = await runDiagnostics({ workspaceDir })
    return {
      success: true,
      diagnostics: result,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    }
  }
}
