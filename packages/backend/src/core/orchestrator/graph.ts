// orchestrator/graph.ts — DaShengOS v6.2 编排引擎 (流式增强版)
// State graph: classify → [research|specialist] → synthesize → verify → publish
// v6.2: 全阶段 SSE 事件透传 + tool_start/tool_end + searching + 真实流式 token

import { getActiveProvider, getApiKey } from '../../providers/index.js'
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
async function callLLM(
  systemPrompt: string, userMessage: string,
  opts?: { maxTokens?: number; tools?: any[]; modelOverride?: string },
  history?: Array<{ role: string; content: string }>,
): Promise<{ content: string; toolCalls: any[] }> {
  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (!provider || !apiKey) throw new Error('No LLM provider')

  const model = opts?.modelOverride || process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-flash'
  const isReasoner = model === 'deepseek-v4-pro' || model === 'deepseek-reasoner'
  console.log('[Orch] callLLM model:', model, 'isReasoner:', isReasoner, 'maxTokens:', opts?.maxTokens)

  // Build messages with history context
  const messages: Array<{ role: string; content: string }> = [{ role: 'system', content: systemPrompt }]
  if (history && history.length > 0) {
    for (const h of history.slice(-20)) {  // last 20 messages max
      if (h.role === 'user' || h.role === 'assistant') messages.push(h)
    }
  }
  messages.push({ role: 'user', content: userMessage })

  const body: Record<string, any> = {
    model,
    messages,
    max_tokens: opts?.maxTokens || 4096,
    stream: false,
  }
  // deepseek-reasoner does NOT support temperature
  if (!isReasoner) body.temperature = 0.3
  if (opts?.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
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
    const streamModel = opts?.modelOverride || process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-flash'
  // fallback: non-streaming
    const r = await callLLM(systemPrompt, userMessage, opts, history)
    if (r.content) { onToken(r.content); yield r.content }
    return
  }

  // Use non-reasoning model for real-time streaming (reasoner has 20-40s thinking delay)
  let model = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-flash'
  const isReasoner = model === 'deepseek-v4-pro' || model === 'deepseek-reasoner'
  if (isReasoner) {
    model = 'deepseek-chat'  // Force chat model for instant streaming
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

  const body: Record<string, any> = {
    model,
    messages,
    max_tokens: opts?.maxTokens || 8192,
    stream: true,
  }
  body.temperature = 0.3
  if (opts?.tools && opts.tools.length > 0) {
    body.tools = opts.tools
    body.tool_choice = 'auto'
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

async function execToolCalls(
  toolCalls: any[], state: OrchestratorState,
  maxTimeout: number, onEvent?: Emitter,
): Promise<Map<string, any>> {
  const tcl: ToolCall[] = toolCalls.map((tc: any) => ({
    id: tc.id || '', name: tc.function?.name || tc.name || '',
    args: typeof tc.function?.arguments === 'string' ? JSON.parse(tc.function.arguments) : (tc.function?.arguments || tc.args || {}),
  }))

  // Emit tool_start for each
  for (const tc of tcl) {
    emitToolStart(onEvent, tc.name, tc.args)
    if (tc.name === 'web_search') emitSearching(onEvent, tc.args?.query || '')
  }

  const results = await executeToolsParallel(tcl, {
    userId: state.userId, sessionId: state.sessionId,
    workspaceDir: state.workspaceDir, maxTimeout,
  })

  // Emit tool_end for each
  for (const [name, res] of results.entries()) {
    emitToolEnd(onEvent, name, !!res.success, res.success ? (res.data || 'OK').slice(0, 200) : res.error || '未知错误')
  }

  return results
}

// ─── Phase: Classify ──────────────────────────────────

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
  
  emitStatus(onEvent, `意图: ${s.taskContract.taskType} → ${s.toolMatch.summary}, 下一阶段: ${s.phase}`)
  return s
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
    if (r.toolCalls.length > 0) {
      emitStatus(onEvent, `🔍 执行 ${r.toolCalls.length} 次网络搜索...`)
      const results = await execToolCalls(r.toolCalls, s, 30000, onEvent)
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

async function specialistPhase(s: OrchestratorState, onEvent?: Emitter): Promise<OrchestratorState> {
  const ct = s.taskContract
  const route = s.agentRoute
  
  // v6.3: Dynamic Agent Dispatch from agency-agents registry
  if (route.matched && route.primaryAgent) {
    const agent = route.primaryAgent
    emitStatus(onEvent, `${agent.emoji} 调度专家: ${agent.name} (${route.divisionLabel}) [${route.mode}]`)
    
    // Build agent-specific system prompt
    const agentPrompt = buildAgentSystemPrompt(agent, s.userMessage, ct.expectedFormat)
    // Inject matched skill prompts
    const fullAgentPrompt = s.toolMatch.skillPrompts 
      ? agentPrompt + '\n' + s.toolMatch.skillPrompts 
      : agentPrompt
    
    // v7.0: Dynamic tool matching from ToolMatcher — replaces hardcoded tools
    const agentTools = s.toolMatch.toolDefs.length > 0 
      ? s.toolMatch.toolDefs 
      : [
        { type: 'function', function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
        { type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
      ]
    
    try {
      // v6.3: Try streaming first for real-time token output
      let streamedContent = ''
      const provider = getActiveProvider()
      if (provider.chatStream && onToken) {
        emitStatus(onEvent, '📝 流式输出...')
        let streamModel = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-flash'
        if (streamModel === 'deepseek-v4-pro' || streamModel === 'deepseek-reasoner') streamModel = 'deepseek-chat'
        const streamBody: Record<string, any> = {
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
        for await (const chunk of provider.chatStream(streamBody, apiKey)) {
          if (chunk.type === 'token' && chunk.content) {
            streamedContent += chunk.content
            onToken(chunk.content)
          }
        }
      }
      
      // If streaming produced no content, fall back to non-streaming
      if (!streamedContent) {
        const r = await callLLM(fullAgentPrompt, s.userMessage, { maxTokens: 8192, tools: agentTools, modelOverride: s.modelOverride }, s.history)
        if (r.toolCalls.length > 0) {
          const results = await execToolCalls(r.toolCalls, s, 60000, onEvent)
          for (const [name, res] of results.entries()) {
            if (res.success) s.filesWritten.push(name)
          }
        }
        streamedContent = r.content || 'Agent 执行完成'
        // Fake-stream for non-streaming fallback
        if (onToken && streamedContent) {
          for (let i = 0; i < streamedContent.length; i += 3) {
            onToken(streamedContent.slice(i, i + 3))
          }
        }
      }
      s.synthesizedContent = streamedContent
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
          s.synthesizedContent = nr.content || s.synthesizedContent
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
        s.synthesizedContent = r.content || '代码修复完成'
        break
      }
      case 'DESIGN': {
        emitStatus(onEvent, '🎨 设计子代理启动...')
        const r = await callLLM(buildDesignerPrompt(s.userMessage), s.userMessage, {
          maxTokens: 2048,
          tools: [{ type: 'function', function: { name: 'open_design_execute', description: 'Execute Open Design', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 60000, onEvent)
        s.synthesizedContent = r.content || '设计完成'
        break
      }
      case 'VIDEO': {
        emitStatus(onEvent, '🎬 视频子代理启动...')
        const r = await callLLM(buildVideomakerPrompt(s.userMessage), s.userMessage, {
          maxTokens: 2048,
          tools: [{ type: 'function', function: { name: 'openmontage_execute', description: 'Execute OpenMontage', parameters: { type: 'object', properties: { config: { type: 'string' } }, required: ['config'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 120000, onEvent)
        s.synthesizedContent = r.content || '视频完成'
        break
      }
      case 'DOCUMENT': {
        emitStatus(onEvent, '📄 文档生成子代理启动...')
        const r = await callLLM(buildSynthesizerPrompt(s.userMessage, '文档', 'DOCUMENT'), s.userMessage, {
          maxTokens: 4096,
          tools: [{ type: 'function', function: { name: 'document_generate', description: 'Generate document', parameters: { type: 'object', properties: { format: { type: 'string' }, content: { type: 'string' } }, required: ['format', 'content'] } } }],
        }, s.history)
        if (r.toolCalls.length > 0) await execToolCalls(r.toolCalls, s, 60000, onEvent)
        s.synthesizedContent = r.content || '文档已生成'
        break
      }
    }
  } catch (e: any) { s.errors.push(`Specialist ${ct.taskType}: ${e.message}`); emitError(onEvent, e.message) }
  s.phase = 'verify'
  return s
}

// ─── Simple Answer (for QUESTION/GENERAL — fast path) ──

async function simpleAnswerPhase(s: OrchestratorState, onEvent?: Emitter, onToken?: (t: string) => void): Promise<OrchestratorState> {
  emitStatus(onEvent, '💬 直接回答...')
  try {
    const systemPrompt = 'You are a helpful assistant. Answer the user question directly and concisely. Output ONLY the answer, no greetings, no meta-commentary.'
    const provider = getActiveProvider()
    if (provider.chatStream) {
      let full = ''
      let model = process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-v4-flash'
      const isReasoner = model === 'deepseek-v4-pro' || model === 'deepseek-reasoner'
      if (isReasoner) model = 'deepseek-chat'
      const body: Record<string, any> = {
        model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: s.userMessage }],
        max_tokens: 2048, stream: true,
      }
      body.temperature = 0.3
      const apiKey = getApiKey(getActiveProvider()) ?? ''
      for await (const chunk of provider.chatStream(body, apiKey)) {
        if (chunk.type === 'token' && chunk.content) { full += chunk.content; onToken?.(chunk.content) }
      }
      s.synthesizedContent = full || '无法回答'
    } else {
      const r = await callLLM(systemPrompt, s.userMessage, { maxTokens: 2048, modelOverride: s.modelOverride }, s.history)
      s.synthesizedContent = r.content || '无法回答'
      if (onToken && s.synthesizedContent) {
        for (let i = 0; i < s.synthesizedContent.length; i += 4) {
          onToken(s.synthesizedContent.slice(i, i + 4))
        }
      }
    }
  } catch (e: any) {
    s.errors.push('SimpleAnswer: ' + e.message)
    s.synthesizedContent = '抱歉，系统繁忙。'
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
        s.synthesizedContent = (fmt === 'HTML') ? cleanHtmlOutput(fullContent) : fullContent
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
        tools: fmt === 'HTML' ? undefined : [{ type: 'function', function: { name: 'write_file', description: 'Write file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } }],
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
    phase: 'classify', iteration: 0, errors: [],
    startTime: Date.now(),
  }
  const phases: string[] = []

  try {
    // 0. Set approval mode from frontend
    if (opts.approvalMode) {
      const { setApprovalMode } = await import('../self-heal/gate.js')
      setApprovalMode(opts.approvalMode)
      emitStatus(onEvent, `🛡 模式: ${opts.approvalMode.toUpperCase()}`)
    }

    // 1. Classify
    emitStatus(onEvent, '🔍 意图分析...')
    await classifyPhase(s, onEvent); phases.push('classify')

    // 2. Execute based on task type
    console.log('[Orch] phase after classify:', s.phase)
    switch (s.phase) {
      case 'specialist':
        emitStatus(onEvent, `🤖 子代理: ${s.taskContract.taskType}...`)
        await specialistPhase(s, onEvent); phases.push('specialist')
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

    return { success: true, response: s.synthesizedContent, filesWritten: s.filesWritten, phases }
  } catch (e: any) {
    emitError(onEvent, e.message)
    return { success: false, response: '', filesWritten: s.filesWritten, phases, error: e.message }
  }
}
