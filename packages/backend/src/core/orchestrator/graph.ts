// orchestrator/graph.ts — DaShengOS v6.2 编排引擎 (流式增强版)
// State graph: classify → [research|specialist] → synthesize → verify → publish
// v6.2: 全阶段 SSE 事件透传 + tool_start/tool_end + searching + 真实流式 token

import { getActiveProvider, getApiKey } from '../../providers/index.js'
import { convertToolsForProvider, normalizeProviderResponse, buildToolAwarePrompt } from '../../providers/tool-adapter.js'
import { executeToolsParallel, type ToolCall } from '../tools/registry.js'
import {
  analyzeTaskContract,
  buildDynamicToolOntology,
} from '../harness/tool-ontology.js'
import { buildResearcherPrompt, RESEARCHER_SYSTEM_PROMPT } from './agents/researcher.js'
import { classifyIntentLocal, verifyHtmlCompleteness, checkSemanticDuplicate, estimateOptimalTokens, quickQualityScore } from './nodes/local-inference.js'
import { buildSynthesizerPrompt, SYNTHESIZER_SYSTEM_PROMPT } from './agents/synthesizer.js'
import { buildVerifierPrompt, VERIFIER_SYSTEM_PROMPT } from './agents/verifier.js'
import { buildCoderPrompt, CODER_SYSTEM_PROMPT } from './agents/coder.js'
import { buildDesignerPrompt, buildVideomakerPrompt, DESIGNER_SYSTEM_PROMPT, VIDEOMAKER_SYSTEM_PROMPT } from './agents/designer.js'
import { routeIntent, buildAgentSystemPrompt, findAgent, loadAgentRegistry, type AgentDef, type RouteResult } from './agent-registry.js'
import { matchToolsForIntent, type ToolMatchResult } from './tool-matcher.js'
import { recordTask, extractPatterns, autoCreateSkills, optimizeSkills, shouldEvolve, markEvolved } from './self-evolver.js'
import { processAgentOutput, createGatewayContext, type GatewayContext } from '../output-gateway/index.js'
import type { AgentRawOutput, FilteredOutput } from '../output-gateway/types.js'

// ─── Types ─────────────────────────────────────────────

export interface OrchestratorState {
  userMessage: string
  agentRoute: RouteResult
  toolMatch: ToolMatchResult
  history: Array<{ role: string; content: string }>
  userId: string
  sessionId: string
  workspaceDir: string
  modelOverride?: string
  taskContract: ReturnType<typeof analyzeTaskContract>
  toolOntology: string
  researchFindings: string
  synthesizedContent: string
  filesWritten: string[]
  verificationResult: { pass: boolean; issues: string[]; score: number }
  phase: string
  iteration: number
  approvalMode: 'yolo' | 'ask' | 'safe'
  errors: string[]
  startTime: number
}

export interface OrchestratorResult {
  success: boolean
  response: string
  filesWritten: string[]
  phases: string[]
  error?: string
}

// ─── Helper: event emitter shorthand ──────────────────
type Emitter = ((e: { type: string; text?: string; name?: string; args?: any; success?: boolean; summary?: string; query?: string; message?: string }) => void) | undefined

function emitStatus(e: Emitter, text: string) { e?.({ type: 'status', text }) }
function emitToolStart(e: Emitter, name: string, args: any) { e?.({ type: 'tool_start', name, args }) }
function emitToolEnd(e: Emitter, name: string, success: boolean, summary: string) { e?.({ type: 'tool_end', name, success, summary }) }
function emitSearching(e: Emitter, query: string) { e?.({ type: 'searching', query }) }
function emitThinking(e: Emitter, text: string) { e?.({ type: 'thinking', text }) }
function emitError(e: Emitter, msg: string) { e?.({ type: 'error', message: msg }) }

// Strip AI pleasantries from output — what Codex/Hermes do before showing to user
const AI_FLAVOR_PATTERNS = [
  // Chinese pleasantries
  /^(好的[，,!！.。\s]*)+/gi,
  /^(收到[，,!！.。\s]*)+/gi,
  /^(明白[，,!！.。\s]*)+/gi,
  /^(让我[来们]?[，,!！.。\s]*)+/gi,
  /^(我来[，,!！.。\s]*)+/gi,
  /^(我先[，,!！.。\s]*)+/gi,
  /^(当然[，,!！.。\s]*)+/gi,
  /^(没问题[，,!！.。\s]*)+/gi,
  /^(很高兴[为你]?[，,!！.。\s]*)+/gi,
  /希望(这|能|可以|对).+?[！!。.]/gi,
  /如果你还有.+?[！!。.]/gi,
  /有什么问题.+?[！!。.]/gi,
  /随时(问我|联系|找我).*?[！!。.]/gi,
  /祝你.*?[！!。.]/gi,
  /以上[，,].*?[！!。.]/gi,
  // English pleasantries
  /^(Sure[!,.]*\s*)+/gi,
  /^(Great[!,.]*\s*)+/gi,
  /^(Absolutely[!,.]*\s*)+/gi,
  /^(Certainly[!,.]*\s*)+/gi,
  /^(Of course[!,.]*\s*)+/gi,
  /^(Let me\s)+/gi,
  /^(I will\s)+/gi,
  /^(I'll\s)+/gi,
  /^(First[,]?\s*)+/gi,
  /^(Here is\s)+/gi,
  /^(Here are\s)+/gi,
  /Hope (this|that|it) helps[!.]*/gi,
  /Feel free to.*[!.]/gi,
  /Let me know if.*[!.]/gi,
  // Trailing pleasantries
  /[\s]*希望(这|能).+?[！!。.]$/gi,
  /[\s]*如果[你还].+?[！!。.]$/gi,
  /[\s]*Happy to.*[!.]$/gi,
  // Emoji cleanup
  /[😊🙂😄😃😁😆🤗👍👋💪✨🎉🔥💡✅✔️☑️❤️💙💚🎯⭐🌟💫]/g,
  // Leading/trailing whitespace from stripped content
  /^[\s\n]+/,
  /[\s\n]+$/,
]

function stripAIFlavor(text: string): string {
  // Guard: don't strip if the entire response is just a greeting
  // (model is responding to user's greeting — this is valid)
  const original = text.trim()
  if (/^[你好hihey\s！!,，。.]{0,20}$/i.test(original)) return original
  let cleaned = text
  for (const pattern of AI_FLAVOR_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }
  // Clean up double spaces and double newlines from removal
  cleaned = cleaned.replace(/  +/g, ' ')
  cleaned = cleaned.replace(/\n\n\n+/g, '\n\n')
  // If we stripped everything, return original (avoid empty responses)
  return cleaned.trim() || text.trim()
}

// Post-process HTML: strip markdown wrapping, fix common LLM formatting issues
function cleanHtmlOutput(raw: string): string {
  // Aggressive: strip EVERYTHING before the first HTML tag
  let html = raw
  // Remove all markdown code fence markers anywhere in the text
  html = html.replace(/```html?\s*/gi, '')
  html = html.replace(/```\s*/g, '')
  // Remove any "Here is...", "这是...", "好的..." prefacing text
  // Find the actual HTML starting point
  const doctypeIdx = html.indexOf('<!DOCTYPE')
  const htmlIdx = html.indexOf('<html')
  let startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlIdx
  if (startIdx < 0) {
    // Fallback: find first < tag
    startIdx = html.indexOf('<')
  }
  if (startIdx > 0) {
    html = html.slice(startIdx)
  }
  // Strip trailing markdown fence
  html = html.replace(/\n?```\s*$/, '')
  // If still no HTML, try harder — look for <!DOCTYPE case-insensitive
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    const match = html.match(/<![Dd][Oo][Cc][Tt][Yy][Pp][Ee]|<html/i)
    if (match && match.index && match.index > 0) {
      html = html.slice(match.index)
    }
  }
  return html.trim()
}

// ─── LLM Call (non-streaming, used by researcher/verifier/specialist) ────

// ─── Provider-Adaptive Helpers (v6.2) ───────────────────

/** 获取当前 provider 的默认模型名 (不再硬编码 deepseek) */
function getDefaultModel(): string {
  try {
    const p = getActiveProvider()
    return p.defaultModel || 'deepseek-chat'
  } catch {
    return 'deepseek-chat'
  }
}

/** 判断当前模型是否为推理模型 (reasoner 不支持 temperature/tool_choice) */
function isReasonerModel(model: string): boolean {
  const reasoners = ['deepseek-v4-pro', 'deepseek-reasoner', 'o1', 'o1-mini', 'o3', 'o3-mini', 'claude-opus']
  return reasoners.some(r => model.toLowerCase().includes(r.toLowerCase()))
}

/** 适配工具定义到当前 provider 格式 */
function adaptTools(tools: any[] | undefined, providerName?: string): any[] | undefined {
  if (!tools || tools.length === 0) return undefined
  const pn = providerName || (() => { try { return getActiveProvider().name } catch { return 'openai' } })()
  return convertToolsForProvider(pn, tools)
}

/** 规范化 provider 响应 */
function normalizeResponse(raw: any, providerName?: string) {
  const pn = providerName || (() => { try { return getActiveProvider().name } catch { return 'openai' } })()
  return normalizeProviderResponse(pn, raw)
}

async function callLLM(
  systemPrompt: string, userMessage: string,
  opts?: { maxTokens?: number; tools?: any[]; modelOverride?: string },
  history?: Array<{ role: string; content: string }>,
): Promise<{ content: string; toolCalls: any[] }> {
  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (!provider || !apiKey) throw new Error('No LLM provider')

  const pn = provider.name
  const model = opts?.modelOverride || getDefaultModel()
  const isReasoner = isReasonerModel(model)
  console.log('[Orch] callLLM model:', model, 'isReasoner:', isReasoner, 'maxTokens:', opts?.maxTokens)

  // Build messages with history context
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }]
  if (history && history.length > 0) {
    for (const h of history.slice(-20)) {  // last 20 messages max
      if (h.role === 'user' || h.role === 'assistant') messages.push(h)
    }
  }
  messages.push({ role: 'user', content: userMessage })

  const body: any = {
    model,
    messages,
    max_tokens: opts?.maxTokens || 4096,
    stream: false,
  }
  // Reasoner models don't support temperature/tool_choice
  if (!isReasoner) body.temperature = 0.3
  if (opts?.tools && opts.tools.length > 0) {
    if (provider.supportsTools) {
      body.tools = adaptTools(opts.tools, provider.name)
      if (!isReasoner) body.tool_choice = 'auto'
    }
  }

  const resp = await provider.chat(body, apiKey)
  return { content: resp.content || '', toolCalls: resp.tool_calls || [] }
}

// ─── Streaming LLM Call (used by synthesize for real-time token stream) ──
async function* callLLMStreaming(
  systemPrompt: string, userMessage: string,
  onToken: (t: string) => void,
  opts?: { maxTokens?: number; tools?: any[]; modelOverride?: string },
  history?: Array<{ role: string; content: string }>,
): AsyncGenerator<string, void, undefined> {
  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (!provider || !apiKey) throw new Error('No LLM provider')
  if (!provider.chatStream) {
    // fallback: non-streaming
    const r = await callLLM(systemPrompt, userMessage, opts, history)
    if (r.content) { onToken(r.content); yield r.content }
    return
  }

  // Use non-reasoning model for real-time streaming (reasoner has 20-40s thinking delay)
  let model = getDefaultModel()
  const isReasoner = isReasonerModel(model)
  if (isReasoner) {
    model = provider.fallbackModels?.[0] || provider.defaultModel  // Force non-reasoner for streaming
    console.log('[Orch] Streaming: switching reasoner→chat for real-time output')
  }

  // Build messages with history context
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }]
  if (history && history.length > 0) {
    for (const h of history.slice(-20)) {
      if (h.role === 'user' || h.role === 'assistant') messages.push(h)
    }
  }
  messages.push({ role: 'user', content: userMessage })

  const body: any = {
    model,
    messages,
    max_tokens: opts?.maxTokens || 8192,
    stream: true,
  }
  body.temperature = 0.3
  if (opts?.tools && opts.tools.length > 0) {
    if (provider.supportsTools) {
      body.tools = adaptTools(opts.tools, provider.name)
      if (!isReasoner) body.tool_choice = 'auto'
    }
  }

  let full = ''
  let toolCallDetected = false
  for await (const chunk of provider.chatStream(body, apiKey)) {
    if (chunk.type === 'token' && chunk.content) {
      full += chunk.content
      onToken(chunk.content)
      yield chunk.content
    }
    if (chunk.type === 'tool_call') {
      toolCallDetected = true
      console.log('[Orch] Streaming: tool_call detected, breaking to fallback')
      break  // LLM wants to call tools — exit stream, caller handles fallback
    }
  }
  if (!full && !toolCallDetected) {
    // No content and no tool call — true fallback
    const r = await callLLM(systemPrompt, userMessage, opts, history)
    if (r.content) { onToken(r.content); yield r.content }
  }
  // If toolCallDetected: return empty, caller will use non-streaming callLLM with tools
}

// ─── Tool execution with event emission ───────────────

// ─── Safe command allowlist ──────────────────────────
const SAFE_COMMANDS = [
  /^pwd\s*$/, /^ls(\s|$)/, /^echo\s/, /^cat\s/, /^head\s/, /^tail\s/, /^wc\s/, /^find\s/,
  /^which\s/, /^whoami\s*$/, /^uname\s/, /^date\s*$/, /^env(\s|$)/, /^printenv/,
  /^npm\s+(test|run|ls|list|install|ci|--version)(\s|$)/, /^npm\s+install\s/,
  /^node\s+--version/, /^node\s+-e\s/,
  /^python3?\s+--version/, /^python3?\s+-c\s/, /^python3?\s+-m\s+pip\s+install/,
  /^pip3?\s+install/, /^pip3?\s+list/, /^pip3?\s+show/,
  /^git\s+(status|diff|log|branch|clone|remote|fetch|pull|--version)(\s|$)/,
  /^npx\s+--version/, /^npx\s+tsc\s+--/, /^yarn\s+--version/,
  /^brew\s+--version/, /^brew\s+list/,
  /^df\s/, /^du\s/, /^ps\s+aux/, /^pgrep\s/, /^screen\s+-ls/,
  /^curl\s+-s\s+http/, /^rg\s/, /^grep\s/, /^sort\s/, /^uniq\s/,
  /^mkdir\s+-p\s/, /^cp\s+-r?\s/, /^mv\s/,
  /^cargo\s+(build|check|test|run|--version)(\s|$)/,
  /^make(\s|$)/, /^cmake(\s|$)/,
]

function isSafeCommand(cmd: string): boolean {
  return SAFE_COMMANDS.some(r => r.test(cmd.trim()))
}

// ─── Tool execution with event emission + approval ────
async function execToolCalls(
  toolCalls: any[], state: OrchestratorState,
  maxTimeout: number, onEvent?: Emitter,
): Promise<Map<string, any>> {
  const tcl: ToolCall[] = toolCalls.map((tc: any) => ({
    id: tc.id || '', name: tc.function?.name || tc.name || '',
    args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.args || {}),
  }))

  // ★ Build confirmedSet based on approval mode
  const mode = state.approvalMode || 'ask'
  const confirmedSet = new Set<string>()

  // 需要轮询确认的命令列表
  const pendingConfirmations: Array<{ tc: any; pendingId: string; key: string }> = []

  if (mode !== 'safe') {
    for (const tc of tcl) {
      if (tc.name === 'run_command') {
        const cmd = tc.args?.command || ''
        if (mode === 'yolo' || isSafeCommand(cmd)) {
          confirmedSet.add(tc.name + ':' + JSON.stringify(tc.args))
        } else {
          // 不安全命令：加入确认队列，前端弹出确认门，轮询等待用户批准
          try {
            const { requestConfirmation } = await import('../self-heal/gate.js')
            const result = await requestConfirmation({
              userId: state.userId,
              sessionId: state.sessionId,
              action: tc.name,
              actionParams: { command: cmd, cwd: tc.args?.cwd || state.workspaceDir },
              description: `执行命令: ${cmd}`,
              riskLevel: 'high',
            })
            if (result.approved) {
              confirmedSet.add(tc.name + ':' + JSON.stringify(tc.args))
            } else if (result.pendingId) {
              emitStatus(onEvent, `⏳ 等待确认: ${cmd.slice(0, 50)}`)
              onEvent?.({ type: 'tool_confirm', tool: tc.name, args: cmd.slice(0, 100) })
              pendingConfirmations.push({ tc, pendingId: result.pendingId, key: tc.name + ':' + JSON.stringify(tc.args) })
            }
          } catch {
            emitStatus(onEvent, `⚠️ 确认系统不可用，跳过危险命令`)
          }
        }
      } else {
        confirmedSet.add(tc.name + ':' + JSON.stringify(tc.args))
      }
    }
  }

  // 轮询等待用户确认（最长 60 秒）
  for (const pc of pendingConfirmations) {
    let approved = false
    const startTime = Date.now()
    while (Date.now() - startTime < 60000) {
      try {
        const { getPendingActions } = await import('../self-heal/gate.js')
        const pending = getPendingActions(state.userId, state.sessionId)
        const action = pending.find(a => a.id === pc.pendingId)
        if (!action || action.status === 'rejected' || action.status === 'expired') {
          emitStatus(onEvent, `❌ 已拒绝: ${pc.tc.args?.command?.slice(0, 40)}`)
          break
        }
        if (action.status === 'approved') {
          confirmedSet.add(pc.key)
          emitStatus(onEvent, `✅ 已批准: ${pc.tc.args?.command?.slice(0, 40)}`)
          approved = true
          break
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 1500))  // poll every 1.5s
    }
    if (!approved) {
      emitStatus(onEvent, `⏰ 确认超时，跳过: ${pc.tc.args?.command?.slice(0, 40)}`)
    }
  }

  // Emit tool_start for each
  for (const tc of tcl) {
    emitToolStart(onEvent, tc.name, tc.args)
    if (tc.name === 'web_search') emitSearching(onEvent, tc.args?.query || '')
  }

  const results = await executeToolsParallel(tcl, {
    userId: state.userId, sessionId: state.sessionId,
    workspaceDir: state.workspaceDir, maxTimeout,
  }, confirmedSet)

  // Emit tool_confirm for tools that need user confirmation
  for (const [key, result] of results.entries()) {
    if ((result as any).needsConfirmation) {
      const [toolName, argsStr] = key.split(':', 2)
      emitStatus(onEvent, `⚠️ 需要确认: ${toolName}`)
      onEvent?.({ type: 'tool_confirm', tool: toolName, args: argsStr })
    }
  }

  // tool_end emitted by caller

  return results
}
// ─── Direct command detection ────────────────────────
const DIRECT_CMD_PATTERNS = [
  /^(pwd|ls|whoami|date|uname|hostname)\s*$/i,
  /^ls\s+/i, /^cat\s+/i, /^echo\s+/i, /^head\s+/i, /^tail\s+/i,
  /^npm\s+(test|run|ls|list)/i, /^git\s+(status|diff|log|branch)/i,
  /^python3?\s+--version/i, /^node\s+--version/i,
]
function isDirectCommand(msg: string): string | null {
  const trimmed = msg.trim()
  for (const p of DIRECT_CMD_PATTERNS) {
    if (p.test(trimmed)) return trimmed
  }
  return null
}

async function classifyPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  s.taskContract = analyzeTaskContract(s.userMessage)
  s.toolOntology = buildDynamicToolOntology(s.userMessage)

  const localIntent = classifyIntentLocal(s.userMessage)
  console.log('[Orch] classify:', s.taskContract.taskType, 'local:', localIntent.category, 'conf:', localIntent.confidence.toFixed(2))

  if (localIntent.confidence > 0.7 && localIntent.category !== s.taskContract.taskType) {
    console.log('[Orch] local override:', s.taskContract.taskType, '→', localIntent.category)
    s.taskContract.taskType = localIntent.category as any
    s.taskContract.needsWebSearch = localIntent.needsWebSearch
    s.taskContract.needsFileWrite = localIntent.needsFileWrite
    s.taskContract.expectedFormat = localIntent.expectedFormat
  }

  const budget = estimateOptimalTokens(s.taskContract.taskType, 0, false)
  console.log('[Orch] token budget:', budget.recommended, 'maxTurns:', budget.maxTurns)

  s.phase = s.taskContract.taskType === 'DESIGN' || s.taskContract.taskType === 'VIDEO' ||
    s.taskContract.taskType === 'CODE_FIX' || s.taskContract.taskType === 'DOCUMENT'
    ? 'specialist' : s.taskContract.needsWebSearch ? 'research' : 'synthesize'

  // v7.0: Dynamic tool/skill matching
  s.toolMatch = matchToolsForIntent(s.userMessage, s.taskContract.taskType)
  
  // If ToolMatcher found significant tools but task was classified as simple,
  // upgrade to specialist phase so tools get used
  if (s.phase === 'synthesize' && s.toolMatch.tools.length >= 4) {
    const hasMcpOrSkill = s.toolMatch.tools.some(t => t.source === 'mcp' || t.source === 'skill')
    if (hasMcpOrSkill || s.toolMatch.agents.length > 0) {
      s.phase = 'specialist'
      console.log('[Orch] Phase upgraded: synthesize → specialist (tools matched)')
    }
  }
  

  // v7.1: 检测命令执行意图 → 路由到 specialist
  const CMD_KW = ['运行', '执行', 'pwd', 'ls ', 'grep ', 'npm ', 'git ', 'node ', 'python', 'pip ', 'brew ', 'docker ', 'curl ', 'ps ', 'kill', 'chmod', 'mkdir', 'rm ', 'cp ', 'mv ']
  if (s.phase === 'synthesize' && CMD_KW.some((k: string) => s.userMessage.includes(k))) {
    s.phase = 'specialist'
  }
  emitStatus(onEvent, `意图: ${s.taskContract.taskType} → ${s.toolMatch.summary}, 下一阶段: ${s.phase}`)
  return s
}


// ─── Text-based Command Extraction (v6.2 fallback) ────────

/** 
 * 当模型不支持 function calling 时，从文本响应中提取可执行命令。
 * 匹配模式: 代码块中的 bash/shell 命令、以 $ 或 > 开头的命令行。
 */
function extractCommandsFromText(text: string): ToolCall[] {
  const commands: ToolCall[] = []
  
  // Pattern 1: code blocks with shell commands
  const codeBlockRe = /```(?:bash|sh|shell|zsh)?\s*\n([\s\S]*?)\n```/g
  let match
  while ((match = codeBlockRe.exec(text)) !== null) {
    const lines = match[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
    for (const line of lines) {
      commands.push({ name: 'run_command', args: { command: line.trim() } })
    }
  }

  // Pattern 2: Lines starting with $ or > (shell prompt)
  const promptRe = /^[$>]\s+(.+)$/gm
  while ((match = promptRe.exec(text)) !== null) {
    commands.push({ name: 'run_command', args: { command: match[1].trim() } })
  }

  // Pattern 3: Explicit "run:" or "command:" prefix
  const explicitRe = /(?:run|command|execute):\s*`([^`]+)`/gi
  while ((match = explicitRe.exec(text)) !== null) {
    commands.push({ name: 'run_command', args: { command: match[1].trim() } })
  }

  return commands
}

/**
 * 检测模型是否真正产出了工具调用。
 * 如果模型返回了 content 但没有 tool_calls，尝试从文本提取命令。
 */
function ensureToolExecution(
  response: { content: string; toolCalls: any[] },
  state: OrchestratorState,
  onEvent?: Emitter,
): { content: string; toolCalls: any[] } {
  // 已有工具调用 → 直接返回
  if (response.toolCalls && response.toolCalls.length > 0) return response

  // 无工具调用但有文本 → 尝试提取命令
  if (response.content && response.content.length > 0) {
    const extracted = extractCommandsFromText(response.content)
    if (extracted.length > 0) {
      emitStatus(onEvent, `🔧 从文本中提取到 ${extracted.length} 条命令`)
      return { content: response.content, toolCalls: extracted }
    }
  }

  return response
}

// ─── Phase: Research (researcher sub-agent) ───────────

async function researchPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  console.log('[Orch] researchPhase START, contract:', s.taskContract.taskType)
  emitStatus(onEvent, '🔬 研究员子代理启动...')
  try {
    const prompt = buildResearcherPrompt(s.userMessage, s.userMessage.slice(0, 80))
    emitThinking(onEvent, '研究员分析查询意图...')
    const r = await callLLM(prompt, s.userMessage, {
      maxTokens: 4096,
      tools: s.toolMatch.toolDefs.length > 0 ? s.toolMatch.toolDefs : [{ type: 'function', function: { name: 'web_search', description: 'Search web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }],
    }, s.history)
    let findings = r.content || ''
    if (enhanced.toolCalls.length > 0) {
      emitStatus(onEvent, `🔍 执行 ${enhanced.toolCalls.length} 次网络搜索...`)
      const results = await execToolCalls(enhanced.toolCalls, s, 30000, onEvent)
      const fb = Array.from(results.entries()).map(([n, r2]) =>
        `[${n}] ${r2.success ? (r2.data || 'OK').slice(0, 3000) : 'ERR: ' + r2.error}`).join('\n\n')
      emitStatus(onEvent, '🧠 研究员综合分析搜索结果...')
      const r3 = await callLLM(prompt + '\n\nSynthesize findings.', `SEARCH:\n${fb}`, { maxTokens: 4096, modelOverride: s.modelOverride }, s.history)
      findings = r3.content || findings
    }
    s.researchFindings = findings.slice(0, 8000)
    emitStatus(onEvent, `✅ 研究完成 (${findings.length} 字符)`)
  } catch (e: any) {
    s.errors.push(`Research: ${e.message}`)
    s.researchFindings = `搜索失败。使用内建知识。`
    emitError(onEvent, `研究阶段失败: ${e.message}`)
  }
  s.phase = 'synthesize'
  return s
}

// ─── Phase: Specialist (coder/designer/videomaker) ────

async function specialistPhase(s: OrchestratorState, onEvent?: Emitter, onToken?: (t: string) => void): Promise<OrchestratorState> {
  const ct = s.taskContract
  const route = s.agentRoute
  
  // v6.3: Dynamic Agent Dispatch from agency-agents registry
  if (route.matched && route.primaryAgent) {
    const agent = route.primaryAgent
    emitStatus(onEvent, `${agent.emoji} 调度专家: ${agent.name} (${route.divisionLabel}) [${route.mode}]`)
    
    // Build agent-specific system prompt
    const agentPrompt = buildAgentSystemPrompt(agent, s.userMessage, ct.expectedFormat)
    // Inject matched skill prompts
    // Augment agent prompt with tool awareness
        const toolAwarePrompt = agentPrompt + [
          '',
          '## FUNCTION CALLING TOOLS (YOU MUST USE THESE)',
          'You have function calling tools. ALWAYS call them instead of refusing.',
          '',
          'Available:',
          '- run_command(command) - Execute shell commands (bash/zsh)',
          '- web_search(query) - Search the web',
          '- write_file(path, content) - Create/overwrite a file',
          '- read_file(path) - Read a file',
          '',
          'RULES:',
          '1. NEVER say you cannot execute commands - you HAVE run_command',
          '2. Call run_command IMMEDIATELY when user asks to run something',
          '3. Output tool results directly, do not describe what you are doing',
        ].join('\n')
        const fullAgentPrompt = s.toolMatch.skillPrompts 
      ? agentPrompt + '\n' + s.toolMatch.skillPrompts 
      : agentPrompt
    
    // v7.0: Dynamic tool matching from ToolMatcher — replaces hardcoded tools
    const agentTools = s.toolMatch.toolDefs.length > 0 
      ? s.toolMatch.toolDefs 
      : [
        { type: 'function', function: { name: 'run_command', description: 'Execute shell command (bash/zsh). Use for pwd, ls, grep, find, cat, npm, git, node, python, curl, etc.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to execute' }, cwd: { type: 'string', description: 'Working directory' }, timeout: { type: 'number', description: 'Timeout ms', default: 30000 } }, required: ['command'] } } },
        { type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
        { type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
      ]
    
    try {
      // v6.3: Try streaming first for real-time token output
      let streamedContent = ''
      const provider = getActiveProvider()
      if (provider.chatStream && onToken) {
        emitStatus(onEvent, '📝 流式输出...')
        const prov = getActiveProvider()
        const pn2 = prov.name
        let streamModel = getDefaultModel()
        if (isReasonerModel(streamModel)) streamModel = prov.fallbackModels?.[0] || 'deepseek-chat'
        const streamBody: any = {
          model: streamModel,
          messages: (() => {
            const msgs: Array<{ role: string; content: string }> = [{ role: 'system', content: fullAgentPrompt }]
            if (s.history && s.history.length > 0) {
              for (const h of s.history.slice(-20)) {
                if (h.role === 'user' || h.role === 'assistant') msgs.push(h)
              }
            }
            msgs.push({ role: 'user', content: s.userMessage })
            return msgs
          })(),
          max_tokens: 8192, stream: true,
        }
        streamBody.temperature = 0.3
        if (agentTools.length > 0) { streamBody.tools = agentTools; streamBody.tool_choice = 'auto' }
        const apiKey = getApiKey(provider) ?? ''
        // ★ v7.2: 流式工具调用捕获
        const streamToolCalls = new Map<string, { name: string; args: string }>()
        for await (const chunk of provider.chatStream(streamBody, apiKey)) {
          if (chunk.type === 'token' && chunk.content) {
            streamedContent += chunk.content
            onToken(chunk.content)
          }
          if (chunk.type === 'tool_call' && (chunk.meta as any)?.tool_call_id) {
            const id = (chunk.meta as any).tool_call_id
            const existing = streamToolCalls.get(id)
            if (existing) {
              existing.args += (chunk.meta as any).tool_args || ''
            } else {
              streamToolCalls.set(id, {
                name: (chunk.meta as any).tool_name || '',
                args: (chunk.meta as any).tool_args || '',
              })
            }
          }
        }
        // 执行流式收集到的工具调用
        if (streamToolCalls.size > 0) {
          const tcl = Array.from(streamToolCalls.values()).map(tc => {
            let args = {}
            try { args = tc.args ? JSON.parse(tc.args) : {} } catch {}
            return { name: tc.name, args }
          })
          const results = await execToolCalls(tcl, s, 60000, onEvent)
          for (const [name, res] of results.entries()) {
            if (res.success && res.data) {
              streamedContent = (streamedContent ? streamedContent + '\\n' : '') + res.data.slice(0, 4000)
            }
            if (res.success) s.filesWritten.push(name)
          }
        }
      }
      
      // ★ AUTONOMOUS LOOP: 如果 LLM 返回更多 tool_calls，继续执行直到完成
      let loopContent = streamedContent
      let loopMessages = (() => {
        const msgs: Array<{ role: string; content: string }> = [{ role: 'system', content: fullAgentPrompt }]
        if (s.history && s.history.length > 0) {
          for (const h of s.history.slice(-20)) {
            if (h.role === 'user' || h.role === 'assistant') msgs.push(h)
          }
        }
        msgs.push({ role: 'user', content: s.userMessage })
        return msgs
      })()
      let maxLoops = 5  // 最多5轮自主循环
      
      while (maxLoops > 0) {
        maxLoops--
        
        // If streaming produced content, check for tool calls in it
        if (streamedContent && streamToolCalls.size > 0) {
          const tcl = Array.from(streamToolCalls.values()).map(tc => {
            let args = {}
            try { args = tc.args ? JSON.parse(tc.args) : {} } catch {}
            return { name: tc.name, args }
          })
          const results = await execToolCalls(tcl, s, 60000, onEvent)
          // Add tool results to conversation
          for (const [compositeKey, res] of results.entries()) {
            const name = compositeKey.split(':')[0]
            loopMessages.push({ role: 'assistant', content: `[调用工具: ${name}]` })
            loopMessages.push({ role: 'user', content: res.success ? (res.data || 'OK').slice(0, 2000) : `Error: ${res.error}` })
            if (res.success) s.filesWritten.push(name)
          }
          streamToolCalls.clear()
          streamedContent = ''  // Reset for next iteration
          emitStatus(onEvent, `🔄 继续执行 (剩余 ${maxLoops} 轮)...`)
        }
        
        // If no streaming content yet, fall back to non-streaming
        if (!streamedContent && !loopContent) {
          const r = await callLLM(fullAgentPrompt, s.userMessage, { maxTokens: 8192, tools: agentTools, modelOverride: s.modelOverride }, s.history)
          if (r.toolCalls.length > 0) {
            const results = await execToolCalls(r.toolCalls, s, 60000, onEvent)
            for (const [compositeKey, res] of results.entries()) {
              const name = compositeKey.split(':')[0]
              loopMessages.push({ role: 'assistant', content: `[调用工具: ${name}]` })
              loopMessages.push({ role: 'user', content: res.success ? (res.data || 'OK').slice(0, 2000) : `Error: ${res.error}` })
              if (res.success) s.filesWritten.push(name)
            }
            // Continue loop: ask LLM with updated context
            emitStatus(onEvent, `🔄 工具已执行，继续分析 (剩余 ${maxLoops} 轮)...`)
            loopMessages.push({ role: 'assistant', content: r.content || '工具已执行' })
            // Ask LLM again with full context
            const r2 = await callLLM(fullAgentPrompt, s.userMessage, { maxTokens: 8192, tools: agentTools, modelOverride: s.modelOverride }, loopMessages.slice(1))
            if (r2.toolCalls.length > 0) {
              const results2 = await execToolCalls(r2.toolCalls, s, 60000, onEvent)
              for (const [compositeKey, res] of results2.entries()) {
                const name = compositeKey.split(':')[0]
                loopMessages.push({ role: 'assistant', content: `[调用工具: ${name}]` })
                loopMessages.push({ role: 'user', content: res.success ? (res.data || 'OK').slice(0, 2000) : `Error: ${res.error}` })
                if (res.success) s.filesWritten.push(name)
              }
            }
            loopContent = r2.content || r.content || 'Agent 执行完成'
            if (onToken && loopContent) {
              for (let i = 0; i < loopContent.length; i += 3) {
                onToken(loopContent.slice(i, i + 3))
              }
            }
          } else {
            loopContent = r.content || 'Agent 执行完成'
          }
          break  // Non-streaming: one iteration is enough since we did follow-up
        }
        
        if (loopContent || !streamToolCalls.size) break
      }
      
      s.synthesizedContent = stripAIFlavor(loopContent || streamedContent)
    } catch (e: any) {
      s.errors.push(`Agent ${agent.name}: ${e.message}`)
      emitError(onEvent, `${agent.name}: ${e.message}`)
      // Fallback to legacy hardcoded agents
      await legacySpecialistPhase(s, onEvent)
      return s
    }
    
    // v6.3: Auto-save HTML reports and open preview
    if (s.synthesizedContent && (ct.expectedFormat.includes('HTML') || ct.taskType === 'HTML' || ct.taskType === 'REPORT')) {
      const isHtml = s.synthesizedContent.includes('<!DOCTYPE html>') || s.synthesizedContent.includes('<html')
      if (isHtml) {
        try {
          const { writeFileSync, mkdirSync } = await import('node:fs')
          const reportsDir = '/tmp/dasheng-reports'
          mkdirSync(reportsDir, { recursive: true })
          const filePath = `${reportsDir}/report-${Date.now()}.html`
          writeFileSync(filePath, s.synthesizedContent, 'utf-8')
          s.filesWritten.push(filePath)
          emitToolEnd(onEvent, 'write_file', true, filePath)
          emitStatus(onEvent, `📄 报告已保存: ${filePath}`)
        } catch (e: any) {
          emitToolEnd(onEvent, 'write_file', false, e.message)
        }
      } else {
        // Content is markdown or plain text → leave as-is, frontend will render
        emitStatus(onEvent, `⚠️ 内容非HTML格式，以文本输出 (${s.synthesizedContent.length} 字符)`)
      }
    }
    
    emitStatus(onEvent, `${agent.emoji} ${agent.name} 完成 (${s.synthesizedContent.length} 字符)`)
    
    // If multi-agent chain, execute remaining agents
    if (route.chain.length > 1 && route.chainAgents.length > 1) {
      for (let i = 1; i < route.chainAgents.length; i++) {
        const nextAgent = route.chainAgents[i]
        emitStatus(onEvent, `${nextAgent.emoji} 链式调度: ${nextAgent.name}...`)
        const nextPrompt = buildAgentSystemPrompt(nextAgent, 
          `Previous agent output:
${s.synthesizedContent.slice(0, 4000)}

Review and enhance the above.`, 
          ct.expectedFormat)
        try {
          const nr = await callLLM(nextPrompt, s.userMessage, { maxTokens: 4096, modelOverride: s.modelOverride }, s.history)
          s.synthesizedContent = stripAIFlavor(nr.content) || s.synthesizedContent
        } catch { /* chain agent failure is non-fatal */ }
      }
    }
    
    s.phase = 'verify'
    return s
  }
  
  // Fallback: legacy hardcoded specialist agents
  return legacySpecialistPhase(s, onEvent)
}

// Legacy specialist phase (kept as fallback)
async function legacySpecialistPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  const ct = s.taskContract
  try {
    switch (ct.taskType) {
      case 'CODE_FIX': {
        emitStatus(onEvent, '🤖 代码修复子代理启动...')
        const r = await callLLM(buildCoderPrompt(s.userMessage, s.workspaceDir), s.userMessage, {
          maxTokens: 8192,
          tools: [
            { type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
            { type: 'function', function: { name: 'search_content', description: 'Search code', parameters: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] } } },
            { type: 'function', function: { name: 'edit_file', description: 'Edit file', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } } },
            { type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
            { type: 'function', function: { name: 'run_command', description: 'Run command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
          ],
        }, s.history)
        if (r.toolCalls.length > 0) {
          await execToolCalls(r.toolCalls, s, 60000, onEvent)
          s.filesWritten.push(...r.toolCalls.filter((tc: any) =>
            (tc.function?.name || tc.name) === 'write_file' || (tc.function?.name || tc.name) === 'edit_file'
          ).map((tc: any) => tc.function?.arguments?.path || '').filter(Boolean))
        }
        s.synthesizedContent = stripAIFlavor(r.content) || '代码修复完成'
        break
      }
      case 'DESIGN': {
        emitStatus(onEvent, '🎨 设计子代理启动...')
        const r = await callLLM(buildDesignerPrompt(s.userMessage), s.userMessage, {
          maxTokens: 2048,
          tools: [{ type: 'function', function: { name: 'open_design_execute', description: 'Execute Open Design', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 60000, onEvent)
        s.synthesizedContent = stripAIFlavor(r.content) || '设计完成'
        break
      }
      case 'VIDEO': {
        emitStatus(onEvent, '🎬 视频子代理启动...')
        const r = await callLLM(buildVideomakerPrompt(s.userMessage), s.userMessage, {
          maxTokens: 2048,
          tools: [{ type: 'function', function: { name: 'openmontage_execute', description: 'Execute OpenMontage', parameters: { type: 'object', properties: { config: { type: 'string' } }, required: ['config'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 120000, onEvent)
        s.synthesizedContent = stripAIFlavor(r.content) || '视频完成'
        break
      }
      case 'DOCUMENT': {
        emitStatus(onEvent, '📄 文档生成子代理启动...')
        const r = await callLLM(buildSynthesizerPrompt(s.userMessage, '文档', 'DOCUMENT'), s.userMessage, {
          maxTokens: 4096,
          tools: [{ type: 'function', function: { name: 'document_generate', description: 'Generate document', parameters: { type: 'object', properties: { format: { type: 'string' }, content: { type: 'string' } }, required: ['format', 'content'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 60000, onEvent)
        s.synthesizedContent = stripAIFlavor(r.content) || '文档已生成'
        break
      }
    }
  } catch (e: any) { s.errors.push(`Specialist ${ct.taskType}: ${e.message}`); emitError(onEvent, e.message) }
  s.phase = 'verify'
  return s
}

// ─── Agentic Answer (for QUESTION/GENERAL — with tools!) ──

// ─── Agentic Answer (for QUESTION/GENERAL — with tools!) ──

async function simpleAnswerPhase(s: OrchestratorState, onEvent?: Emitter, onToken?: (t: string) => void): Promise<OrchestratorState> {
  emitStatus(onEvent, `🤖 Agent 模式 (${s.toolMatch.tools.length} 工具可用)...`)
  try {
    // Load long-term memory for personalized context
    let memoryContext = ''
    try {
      const { loadMemoryContext } = await import('../harness/memory.js')
      const mem = loadMemoryContext(s.userId)
      // Include all memory: facts, preferences, decisions, task patterns, insights
      const facts = (mem.crossSessionMemory || []).slice(0, 10)
      if (facts.length > 0) {
        memoryContext = '\n## Your Memory of This User\n' + facts.map((e: any) =>
          `- [${e.category}] ${(e.summary || '').slice(0, 120)}`
        ).join('\n') + '\n'
      }
      if (mem.recentTopics?.length > 0) {
        memoryContext += `\nRecent discussions: ${mem.recentTopics.slice(0, 5).join(', ')}\n`
      }
      console.log('[Agent] Memory loaded:', facts.length, 'facts')
    } catch (e: any) { console.log('[Agent] Memory skipped:', e.message) }

    // Load AGENTS.md and project context for workspace awareness
    let workspaceContext = ''
    try {
      const { readFileSync, existsSync } = await import('node:fs')
      const agentsPath = '/Users/apple/Desktop/ai-workbench-v2/AGENTS.md'
      if (existsSync(agentsPath)) {
        const agentsContent = readFileSync(agentsPath, 'utf-8').slice(0, 2000)
        workspaceContext = `\n## Project Context (AGENTS.md)\n${agentsContent}\n`
      }
    } catch { /* non-critical */ }

    const toolList = s.toolMatch.tools.map(t => `- ${t.name}: ${t.description}`).join('\n')
    const systemPrompt = `You are DaShengOS, an AI agent with LONG-TERM MEMORY. You remember past conversations and understand the user's project.
${workspaceContext}
${memoryContext}
## Tools
${toolList}

## Environment
Workspace: /Users/apple/Desktop/ai-workbench-v2

## Rules
1. ALWAYS use tools to get real data — never fabricate
2. Reference past conversations when relevant (see Your Memory above)
3. For file listing: use list_files with the full workspace path
4. For reading files: use read_file
5. For running commands: use run_command
6. Be concise, show actual tool results`

    const tools = s.toolMatch.toolDefs.length > 0 ? s.toolMatch.toolDefs : [
      { type: 'function', function: { name: 'list_files', description: 'List directory', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'read_file', description: 'Read file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
      { type: 'function', function: { name: 'run_command', description: 'Run shell command', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
      { type: 'function', function: { name: 'search_content', description: 'Search code', parameters: { type: 'object', properties: { pattern: { type: 'string' }, dir: { type: 'string' } }, required: ['pattern'] } } },
    ] as any[]

    // Call LLM with tools (non-streaming for reliability)
    const r = await callLLM(systemPrompt, s.userMessage, {
      maxTokens: 4096, modelOverride: s.modelOverride,
      tools: tools.length > 0 ? tools : undefined,
    }, s.history)

    let answer = r.content || ''

    // Execute any tool calls and get a follow-up response
    if (r.toolCalls && r.toolCalls.length > 0) {
      emitStatus(onEvent, `🔧 执行 ${r.toolCalls.length} 个工具...`)
      console.log('[Agent] Tool calls:', r.toolCalls.map((tc: any) => tc.function?.name || tc.name))

      const results = await execToolCalls(r.toolCalls, s, 30000, onEvent)
      
      const toolOutputs: string[] = []
      for (const [compositeKey, result] of results.entries()) {
        const name = compositeKey.split(':')[0] || compositeKey
        const output = result?.success ? String(result.data || 'OK').slice(0, 500) : (result?.error || 'Failed')
        const truncated = output.length > 400 ? output.slice(0, 400) + '...(truncated)' : output; toolOutputs.push(`[${name}]: ${truncated}`)
        emitToolEnd(onEvent, name, result?.success || false, output.slice(0, 200))
      }

      // Follow-up: synthesize tool results
      const synthPrompt = `Tool results:\n${toolOutputs.join('\n')}\n\nProvide a clear answer to: "${s.userMessage}"`
      const r2 = await callLLM(synthPrompt, s.userMessage, {
        maxTokens: 2048, modelOverride: s.modelOverride,
      }, s.history)

      answer = r2.content || answer || '工具已执行'
    }

    s.synthesizedContent = stripAIFlavor(answer) || answer || '(空响应)'
    
    // Stream tokens to UI
    if (onToken && s.synthesizedContent) {
      for (let i = 0; i < s.synthesizedContent.length; i += 4) {
        onToken(s.synthesizedContent.slice(i, i + 4))
      }
    }
  } catch (e: any) {
    s.errors.push('AgentAnswer: ' + e.message)
    s.synthesizedContent = '抱歉，系统繁忙。请重试。'
    emitError(onEvent, e.message)
  }
  s.phase = 'verify'
  return s
}

// ─── Phase: Synthesize (synthesizer sub-agent) ────────

async function synthesizePhase(s: OrchestratorState, onEvent?: Emitter, onToken?: (t: string) => void): Promise<OrchestratorState> {
  const isHTML = s.taskContract.expectedFormat.includes('HTML') || s.taskContract.taskType === 'HTML'
  const fmt = isHTML ? 'HTML' : s.taskContract.taskType === 'QUESTION' ? 'ANSWER' : 'TEXT'
  emitStatus(onEvent, `🧠 合成子代理启动 (${fmt})...`)

  try {
    const prompt = buildSynthesizerPrompt(s.userMessage, s.researchFindings || '无研究数据', fmt)

    // Try streaming first for real-time token output
    const provider = getActiveProvider()
    if (provider.chatStream && onToken) {
      let fullContent = ''
      emitStatus(onEvent, '📝 流式生成内容...')
      for await (const chunk of callLLMStreaming(prompt, s.userMessage, onToken, {
        maxTokens: fmt === 'HTML' ? 12288 : 8192,
        // v7.0: Dynamic tools from ToolMatcher
        tools: fmt === 'HTML' ? undefined : (s.toolMatch.toolDefs.length > 0 ? s.toolMatch.toolDefs : [{ type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }]),
      }, s.history)) {
        fullContent += chunk
      }
      if (fullContent) {
        s.synthesizedContent = (fmt === 'HTML') ? cleanHtmlOutput(fullContent) : stripAIFlavor(fullContent)
        // Auto-save HTML for streaming path
        if (fmt === 'HTML' && s.synthesizedContent && s.synthesizedContent.length > 100) {
          try {
            const { writeFileSync, mkdirSync } = await import('node:fs')
            const reportsDir = '/tmp/dasheng-reports'
            mkdirSync(reportsDir, { recursive: true })
            const filePath = `${reportsDir}/report-${Date.now()}.html`
            writeFileSync(filePath, s.synthesizedContent, 'utf-8')
            s.filesWritten.push(filePath)
            emitToolEnd(onEvent, 'write_file', true, filePath)
            emitStatus(onEvent, `📄 报告已保存: ${filePath}`)
          } catch (e: any) {
            emitToolEnd(onEvent, 'write_file', false, e.message)
          }
        }
      } else {
        // Fallback to non-streaming
        const r = await callLLM(prompt, s.userMessage, {
          maxTokens: fmt === 'HTML' ? 12288 : 8192,
          tools: fmt === 'HTML' ? undefined : (s.toolMatch.toolDefs.length > 0 ? s.toolMatch.toolDefs : [{ type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }]),
        }, s.history)
        s.synthesizedContent = (fmt === 'HTML' && r.content) ? cleanHtmlOutput(r.content) : (r.content || s.researchFindings || '内容生成完成')
        // For HTML: auto-save the output if it contains HTML
        if (fmt === 'HTML' && s.synthesizedContent && s.synthesizedContent.length > 100) {
          try {
            const { writeFileSync, mkdirSync } = await import('node:fs')
            const reportsDir = '/tmp/dasheng-reports'
            mkdirSync(reportsDir, { recursive: true })
            const filePath = `${reportsDir}/report-${Date.now()}.html`
            writeFileSync(filePath, s.synthesizedContent, 'utf-8')
            s.filesWritten.push(filePath)
            emitToolEnd(onEvent, 'write_file', true, filePath)
            emitStatus(onEvent, `📄 报告已保存: ${filePath}`)
          } catch (e: any) {
            emitToolEnd(onEvent, 'write_file', false, e.message)
          }
        }
        if (onToken && s.synthesizedContent) {
          for (let i = 0; i < s.synthesizedContent.length; i += 4) {
            onToken(s.synthesizedContent.slice(i, i + 4))
          }
        }
      }
    } else {
      // Non-streaming fallback
      const r = await callLLM(prompt, s.userMessage, {
        maxTokens: fmt === 'HTML' ? 12288 : 8192,
        tools: fmt === 'HTML' ? undefined : undefined,
      }, s.history)
      s.synthesizedContent = (fmt === 'HTML' && r.content) ? cleanHtmlOutput(r.content) : (r.content || s.researchFindings || '内容生成完成')
      if (r.toolCalls.length > 0) {
        const results = await execToolCalls(r.toolCalls, s, 30000, onEvent)
        for (const [name, res] of results.entries()) {
          if (res.success) s.filesWritten.push(name)
        }
      }
      s.synthesizedContent = r.content || s.researchFindings || '内容生成完成'
      if (onToken && s.synthesizedContent) {
        for (let i = 0; i < s.synthesizedContent.length; i += 4) {
          onToken(s.synthesizedContent.slice(i, i + 4))
        }
      }
    }

    // Handle write_file tool calls from streaming content (extract and execute)
    if (isHTML && s.synthesizedContent && s.synthesizedContent.includes('<!DOCTYPE html>')) {
      const filePath = `/tmp/dasheng-report-${Date.now()}.html`
      try {
        const { writeFileSync, mkdirSync } = await import('node:fs')
        mkdirSync('/tmp/dasheng-reports', { recursive: true })
        writeFileSync(filePath, s.synthesizedContent, 'utf-8')
        s.filesWritten.push(filePath)
        emitToolEnd(onEvent, 'write_file', true, filePath)
        emitStatus(onEvent, `📄 报告已保存: ${filePath}`)
      } catch (e: any) {
        emitToolEnd(onEvent, 'write_file', false, e.message)
      }
    }

    emitStatus(onEvent, `✅ 合成完成 (${s.synthesizedContent.length} 字符)`)
  } catch (e: any) {
    s.errors.push(`Synthesize: ${e.message}`)
    s.synthesizedContent = s.researchFindings || '合成失败'
    emitError(onEvent, `合成阶段失败: ${e.message}`)
  }
  s.phase = 'verify'
  return s
}

// ─── Phase: Verify (verifier sub-agent) ───────────────

async function verifyPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  emitStatus(onEvent, '✅ 校验师检查质量...')
  try {
    const quickScore = quickQualityScore(s.synthesizedContent, s.taskContract.taskType)
    console.log('[Orch] quickQuality:', quickScore.score, quickScore.flags)

    if (s.taskContract.taskType === 'HTML' || s.taskContract.taskType === 'REPORT') {
      const htmlCheck = verifyHtmlCompleteness(s.synthesizedContent, s.taskContract.expectedFormat)
      console.log('[Orch] htmlCheck:', htmlCheck.score, 'complete:', htmlCheck.complete, 'issues:', htmlCheck.issues)
      if (!htmlCheck.complete && quickScore.score < 70) {
        s.verificationResult = { pass: false, issues: htmlCheck.issues, score: htmlCheck.score }
        if (s.iteration < 1) { s.iteration++; s.phase = 'synthesize'; return s }
      }
    }

    const dupCheck = checkSemanticDuplicate(s.synthesizedContent)
    if (dupCheck.isDuplicate) {
      console.log('[Orch] semantic duplicate detected, similarity:', dupCheck.similarity.toFixed(2))
      s.verificationResult = { pass: true, issues: ['Semantic duplicate — accepted to prevent loop'], score: 60 }
      s.phase = 'publish'
      return s
    }

    if (s.taskContract.taskType !== 'QUESTION' && s.taskContract.taskType !== 'GENERAL') {
      const prompt = buildVerifierPrompt(s.userMessage, s.taskContract.expectedFormat, s.synthesizedContent, s.filesWritten)
      const r = await callLLM(prompt, 'Verify.', { maxTokens: 512, modelOverride: s.modelOverride }, s.history)
      const m = r.content.match(/\{[\s\S]*\}/)
      s.verificationResult = m ? JSON.parse(m[0]) : { pass: true, issues: [], score: 80 }
    } else {
      s.verificationResult = { pass: quickScore.score >= 50, issues: quickScore.flags, score: quickScore.score }
    }
  } catch {
    s.verificationResult = { pass: true, issues: [], score: 70 }
  }
  if (!s.verificationResult.pass && s.iteration < 1) {
    s.iteration++
    s.phase = 'synthesize'
    emitStatus(onEvent, '🔄 校验未通过，重新合成...')
    return s
  }
  emitStatus(onEvent, `✅ 质量评分: ${s.verificationResult.score}/100`)
  s.phase = 'publish'
  return s
}

// ─── Phase: Publish ───────────────────────────────────

async function publishPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  emitStatus(onEvent, s.filesWritten.length > 0 ? `📄 ${s.filesWritten.join(', ')}` : '✅ 完成')
  s.phase = 'done'
  return s
}

// ─── Phase: Evolve (self-evolution) ─────────────────────

async function evolvePhase(s: OrchestratorState, onEvent?: Emitter): Promise<void> {
  emitStatus(onEvent, '🧬 自进化分析...')
  const durationMs = Date.now() - s.startTime
  
  try {
    // 1. Record this task
    const success = s.verificationResult.score >= 50 && s.errors.length === 0
    recordTask({
      task: s.userMessage,
      intent: s.taskContract.taskType,
      toolsUsed: s.toolMatch.tools.filter(t => t.source === 'core').map(t => t.name),
      agentUsed: s.agentRoute.primaryAgent?.slug || '',
      success,
      qualityScore: s.verificationResult.score,
      durationMs,
      summary: s.synthesizedContent.slice(0, 100),
    })

    // 2. Periodic evolution check
    if (shouldEvolve()) {
      emitStatus(onEvent, '🧬 提取模式 + 自动创建技能...')
      
      // Extract patterns from task history
      const newPatterns = extractPatterns()
      if (newPatterns.length > 0) {
        emitStatus(onEvent, `📊 发现 ${newPatterns.length} 个使用模式`)
      }

      // Auto-create skills for high-confidence patterns
      const newSkills = autoCreateSkills()
      if (newSkills.length > 0) {
        emitStatus(onEvent, `🧬 自动创建 ${newSkills.length} 个新技能: ${newSkills.join(', ')}`)
      }

      // Optimize existing skills
      const optimized = optimizeSkills()
      if (optimized.length > 0) {
        emitStatus(onEvent, `🔧 优化 ${optimized.length} 个技能`)
      }

      markEvolved()
    }

    emitStatus(onEvent, '✅ 完成 (已记录到进化数据库)')
  } catch (e: any) {
    console.warn('[Evolver] evolvePhase error:', e.message)
  }
}

// ═══════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════

export async function runOrchestrator(
  userMessage: string,
  history: Array<{ role: string; content: string }>,
  opts: { userId: string; sessionId: string; workspaceDir: string; approvalMode?: 'yolo' | 'ask' | 'safe'; model?: string },
  onEvent?: (e: { type: string; text?: string; name?: string; args?: any; success?: boolean; summary?: string; query?: string; message?: string }) => void,
  onToken?: (t: string) => void,
): Promise<OrchestratorResult> {
  const s: OrchestratorState = {
    userMessage, history, userId: opts.userId, sessionId: opts.sessionId, workspaceDir: opts.workspaceDir,
    modelOverride: opts.model,
    taskContract: analyzeTaskContract(userMessage),
    agentRoute: routeIntent(userMessage),
    toolMatch: matchToolsForIntent(userMessage, 'GENERAL'),
    toolOntology: '', researchFindings: '', synthesizedContent: '', filesWritten: [],
    verificationResult: { pass: true, issues: [], score: 80 },
    phase: 'classify', iteration: 0, approvalMode: 'ask', errors: [],
    startTime: Date.now(),
  }
  const phases: string[] = []

  try {
    // 0. Set approval mode from frontend
    if (opts.approvalMode) {
      const { setApprovalMode } = await import('../self-heal/gate.js')
      setApprovalMode(opts.approvalMode)
      s.approvalMode = opts.approvalMode
      emitStatus(onEvent, `🛡 模式: ${opts.approvalMode.toUpperCase()}`)
    }

    // 1. Classify
    emitStatus(onEvent, '🔍 意图分析...')
    await classifyPhase(s, onEvent); phases.push('classify')

    // 1.5: Direct command execution (bypass LLM for simple commands)
    const directCmd = isDirectCommand(s.userMessage)
    if (directCmd && s.approvalMode !== 'safe') {
      emitStatus(onEvent, `⚡ 直接执行: ${directCmd}`)
      const results = await execToolCalls([{
        function: { name: 'run_command', arguments: JSON.stringify({ command: directCmd }) }
      }], s, 15000, onEvent)
      for (const [name, res] of results.entries()) {
        if (res.success) {
          s.synthesizedContent = res.data || 'OK'
        } else {
          s.synthesizedContent = res.error || '执行失败'
        }
      }
      return { success: true, response: s.synthesizedContent, filesWritten: s.filesWritten, phases: ['classify', 'direct_exec', 'publish'] }
    }

    // 2. Execute based on task type
    console.log('[Orch] phase after classify:', s.phase)
    switch (s.phase) {
      case 'specialist':
        emitStatus(onEvent, `🤖 子代理: ${s.taskContract.taskType}...`)
        await specialistPhase(s, onEvent, onToken); phases.push('specialist')
        break
      case 'research':
        emitStatus(onEvent, '🔬 子代理: 研究员搜索数据...')
        await researchPhase(s, onEvent); phases.push('research')
        await synthesizePhase(s, onEvent, onToken); phases.push('synthesize')
        break
      case 'synthesize':
      default:
        if (s.taskContract.taskType === 'QUESTION' || s.taskContract.taskType === 'GENERAL') {
          await simpleAnswerPhase(s, onEvent, onToken); phases.push('simple_answer')
        } else {
          await synthesizePhase(s, onEvent, onToken); phases.push('synthesize')
        }
        break
    }

    // 3. Verify
    emitStatus(onEvent, '✅ 子代理: 校验师检查质量...')
    await verifyPhase(s, onEvent); phases.push('verify')
    if (s.phase === 'synthesize') {
      emitStatus(onEvent, '🔄 校验未通过，重新合成...')
      await synthesizePhase(s, onEvent, onToken)
      await verifyPhase(s, onEvent)
      phases.push('synth_retry', 'verify_retry')
    }

    // 4. Publish
    await publishPhase(s, onEvent); phases.push('publish')

    // 5. Self-evolution
    await evolvePhase(s, onEvent); phases.push('evolve')

    // NOTE: onToken already called during streaming synthesize — no fake streaming needed
    if (onToken && s.synthesizedContent && phases.includes('simple_answer') === false) {
      // Only fake-stream if no real streaming happened (e.g. non-streaming fallback)
    }

    // Output Gateway: 最终输出安全管道
    const gatewayCtx = createGatewayContext({
      userId: opts.userId,
      sessionId: opts.sessionId,
      workspaceDir: opts.workspaceDir,
      approvalMode: s.approvalMode,
    })
    const gatewayResult = processAgentOutput(
      { kind: 'final_report', content: s.synthesizedContent || '' },
      gatewayCtx,
    )
    if (gatewayResult.status === 'deny') {
      return { success: false, response: gatewayResult.denyReason || '输出被安全策略阻止', filesWritten: s.filesWritten, phases, error: 'OUTPUT_BLOCKED' }
    }
    const finalResponse = typeof gatewayResult.safeContent === 'string'
      ? gatewayResult.safeContent
      : (gatewayResult.safeContent && typeof gatewayResult.safeContent === 'object'
        ? ((gatewayResult.safeContent as any).content || JSON.stringify(gatewayResult.safeContent))
        : s.synthesizedContent)
    return { success: true, response: finalResponse, filesWritten: s.filesWritten, phases }
  } catch (e: any) {
    emitError(onEvent, e.message)
    return { success: false, response: '', filesWritten: s.filesWritten, phases, error: e.message }
  }
}
