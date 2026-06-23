// =============================================================================
// packages/backend/src/core/harness/tool-ontology.ts
// DaShengOS v6.1 — Dynamic Tool Ontology Builder
// Runs at query time: reads live tool registry + MCP health + skill registry
// Generates tool usage guide injected into system prompt
// =============================================================================

import { TOOL_DEFINITIONS } from '../tools/registry.js'
import { getOfflineMCPToolNames } from '../mcp-client.js'

interface ToolCategory {
  name: string
  icon: string
  tools: Array<{ name: string; desc: string; available: boolean }>
}

interface TaskChain {
  type: string
  keywords: string[]
  chain: string
  fallback: string
  completionCondition: string
}

/**
 * Build a compact but complete tool/skill usage guide.
 * Returns a string intended for injection into SECTION 8 of system prompt.
 */
export function buildDynamicToolOntology(userMessage?: string): string {
  const offlineMCP = getOfflineMCPToolNames()
  const parts: string[] = []

  // ── 1. Category all tools ──
  const categories = categorizeTools(offlineMCP)

  // ── 2. Available tools table ──
  parts.push(buildAvailableTools(categories))

  // ── 3. Task → Tool Chain SOPs ──
  parts.push(buildTaskChains(categories))

  // ── 4. Fallback chains ──
  parts.push(buildFallbackChains(categories))

  // ── 5. Unavailable tools ──
  parts.push(buildUnavailable(categories))

  return parts.join('\n\n')
}

function categorizeTools(offlineMCP: Set<string>): Map<string, ToolCategory> {
  const cats = new Map<string, ToolCategory>()

  const categoryMap: Record<string, { name: string; icon: string }> = {
    file: { name: 'FILE OPS', icon: '📁' },
    system: { name: 'SYSTEM', icon: '⚙' },
    web: { name: 'WEB', icon: '🌐' },
    design: { name: 'DESIGN', icon: '🎨' },
    video: { name: 'VIDEO', icon: '🎬' },
    ai: { name: 'AI/ML', icon: '🤖' },
    docs: { name: 'DOCUMENTS', icon: '📄' },
    viz: { name: 'VISUALIZATION', icon: '📊' },
    git: { name: 'VERSION', icon: '🔀' },
    browser: { name: 'BROWSER', icon: '🖥' },
    mcp: { name: 'MCP', icon: '🔌' },
    other: { name: 'OTHER', icon: '📦' },
  }

  // Tool name → category classification
  const nameToCat: Record<string, string> = {
    read_file: 'file', write_file: 'file', edit_file: 'file',
    list_files: 'file', search_content: 'file',
    run_command: 'system', check_process: 'system', check_port: 'system',
    read_logs: 'system', db_query: 'system',
    restart_service: 'system', install_package: 'system',
    web_search: 'web', web_fetch: 'web',
    open_design_execute: 'design', opendesign_status: 'design', opendesign_generate: 'design',
    openmontage_read: 'video', openmontage_list: 'video', openmontage_execute: 'video',
    execute_skill: 'ai', list_skills: 'ai', create_skill: 'ai',
    agent_manage: 'ai', agent_tars_execute: 'ai',
    langgraph_execute: 'ai', langgraph_create_graph: 'ai',
    langgraph_agent_loop: 'ai', langgraph_multi_agent: 'ai',
    transformers_execute: 'ai', transformers_sentiment: 'ai',
    transformers_summarize: 'ai', transformers_classify: 'ai',
    document_generate: 'docs',
    visualization_generate: 'viz',
    git_op: 'git',
    browser_navigate: 'browser', browser_extract: 'browser',
  }

  for (const t of TOOL_DEFINITIONS) {
    const cat = nameToCat[t.name] || (t.name.startsWith('mcp__') ? 'mcp' : 'other')
    if (!cats.has(cat)) cats.set(cat, { ...categoryMap[cat], tools: [] })
    const available = !offlineMCP.has(t.name)
    cats.get(cat)!.tools.push({
      name: t.name,
      desc: (t.description || '').split('.')[0].slice(0, 80),
      available,
    })
  }

  return cats
}

function buildAvailableTools(cats: Map<string, ToolCategory>): string {
  const lines: string[] = ['## AVAILABLE TOOLS (current session)']
  const order = ['web', 'file', 'system', 'design', 'video', 'ai', 'docs', 'viz', 'browser', 'git', 'mcp', 'other']

  for (const key of order) {
    const cat = cats.get(key)
    if (!cat || cat.tools.length === 0) continue
    const available = cat.tools.filter(t => t.available)
    const unavailable = cat.tools.filter(t => !t.available)
    if (available.length === 0 && unavailable.length === 0) continue

    lines.push(`[${cat.name}]`)
    for (const t of available) {
      lines.push(`  ✅ ${t.name} — ${t.desc}`)
    }
    for (const t of unavailable) {
      lines.push(`  ❌ ${t.name} — OFFLINE`)
    }
  }
  return lines.join('\n')
}

function buildTaskChains(cats: Map<string, ToolCategory>): string {
  const hasWebSearch = toolAvailable(cats, 'web_search')
  const hasWebFetch = toolAvailable(cats, 'web_fetch')
  const hasWriteFile = toolAvailable(cats, 'write_file')
  const hasBrowser = toolAvailable(cats, 'browser_navigate')
  const hasOpenDesign = toolAvailable(cats, 'open_design_execute')
  const hasOpenMontage = toolAvailable(cats, 'openmontage_execute')
  const hasDocGen = toolAvailable(cats, 'document_generate')

  const primaryWeb = hasWebSearch ? 'web_search' : hasWebFetch ? 'web_fetch' : hasBrowser ? 'browser_navigate' : null
  const webStep = primaryWeb ? `${primaryWeb}(query) × 2~3 → ` : ''

  const chains: TaskChain[] = [
    {
      type: 'REPORT/RESEARCH',
      keywords: ['报告', 'report', '分析', '调研', '行业', '市场', '趋势'],
      chain: hasWriteFile
        ? `${webStep}synthesize results → write_file(report.html, full_html_content) → STOP. NEVER output report as chat text.`
        : `${webStep}synthesize results → output directly as formatted text.`,
      fallback: primaryWeb ? '' : 'NO web tools available. Use internal knowledge directly.',
      completionCondition: hasWriteFile ? 'write_file called successfully' : 'content > 500 chars',
    },
    {
      type: 'HTML/GENERATION',
      keywords: ['html', '网页', '页面', '生成', '创建', '制作'],
      chain: hasWriteFile
        ? `${webStep}write_file(name.html, full_html_content) → STOP. Output complete <!DOCTYPE html>...`
        : `${webStep}output complete HTML directly.`,
      fallback: primaryWeb ? '' : 'NO web tools. Use internal knowledge for HTML content.',
      completionCondition: hasWriteFile ? 'write_file called with .html extension' : 'response contains <!DOCTYPE html>',
    },
    {
      type: 'CODE FIX',
      keywords: ['修复', 'fix', 'debug', '改', '修', '优化代码', 'bug'],
      chain: 'read_file(path) → search_content(pattern) → edit_file(path, old, new) → run_command(test) → STOP',
      fallback: '',
      completionCondition: 'edit_file or write_file called + verify step complete',
    },
    {
      type: 'DESIGN',
      keywords: ['设计', '海报', 'UI', 'design', '图', '界面'],
      chain: hasOpenDesign
        ? 'open_design_execute(prompt) → STOP'
        : 'Inform user: Open Design is not available. Suggest alternative.',
      fallback: '',
      completionCondition: 'open_design_execute called successfully',
    },
    {
      type: 'VIDEO',
      keywords: ['视频', 'video', '剪辑', '蒙太奇', 'montage'],
      chain: hasOpenMontage
        ? 'openmontage_execute(config) → STOP'
        : 'Inform user: OpenMontage is not available.',
      fallback: '',
      completionCondition: 'openmontage_execute called successfully',
    },
    {
      type: 'DOCUMENT',
      keywords: ['文档', 'doc', 'word', 'ppt', 'excel', 'pdf'],
      chain: hasDocGen
        ? `${webStep}document_generate(format, content) → STOP`
        : `${webStep}write_file(name.format, content) → STOP`,
      fallback: '',
      completionCondition: 'document_generate or write_file called',
    },
    {
      type: 'QUESTION',
      keywords: ['?', '？', '什么', '怎么', '如何', 'why', 'how', 'what'],
      chain: primaryWeb
        ? `${primaryWeb}(query) → synthesize brief answer → STOP. Keep it concise.`
        : 'Answer directly from internal knowledge. Keep it concise.',
      fallback: '',
      completionCondition: 'content > 20 chars',
    },
  ]

  const lines: string[] = ['## TASK → TOOL CHAIN (follow exactly)']
  for (const c of chains) {
    lines.push(`\n${c.type}:`)
    lines.push(`  CHAIN: ${c.chain}`)
    if (c.fallback) lines.push(`  FALLBACK: ${c.fallback}`)
    lines.push(`  DONE WHEN: ${c.completionCondition}`)
  }

  // CRITICAL: chain completion enforcement
  lines.push(`\n## CHAIN COMPLETION RULES (MANDATORY)`)
  lines.push(`- Your job is NOT done until the chain is COMPLETE.`)
  lines.push(`- A web_search result alone is NOT a deliverable — you must synthesize and output.`)
  lines.push(`- After write_file → STOP. Do NOT retry. Do NOT "improve". Output file path and stop.`)
  lines.push(`- If a tool in the chain is unavailable → use the FALLBACK chain.`)
  lines.push(`- If ALL tools in a chain are unavailable → use internal knowledge and state the limitation.`)
  lines.push(`- Maximum 2 web_search calls per task. Then synthesize with what you have.`)
  lines.push(`- NEVER output "Let me search" or "好的我来搜索" as visible text. Just call the tool silently.`)

  return lines.join('\n')
}

function buildFallbackChains(cats: Map<string, ToolCategory>): string {
  const lines: string[] = ['## FALLBACK CHAINS (when primary tool unavailable)']

  const webFallbacks = ['web_search', 'web_fetch', 'browser_navigate']
  const availableWeb = webFallbacks.filter(t => toolAvailable(cats, t))
  const missingWeb = webFallbacks.filter(t => !toolAvailable(cats, t))

  if (missingWeb.length > 0 && availableWeb.length > 0) {
    lines.push(`- Web search: ${missingWeb.join('❌, ')}❌ → use ${availableWeb.join(' ✅, ')} ✅`)
  }
  if (availableWeb.length === 0) {
    lines.push(`- ALL web tools OFFLINE. Use internal knowledge. State: "基于现有知识..."`)
  }

  const fileFallbacks = ['write_file', 'edit_file']
  const availableFile = fileFallbacks.filter(t => toolAvailable(cats, t))
  if (availableFile.length === 0) {
    lines.push(`- ALL file tools OFFLINE. Output content directly in chat.`)
  }

  return lines.join('\n')
}

function buildUnavailable(cats: Map<string, ToolCategory>): string {
  const unavailable: string[] = []
  for (const [, cat] of cats) {
    for (const t of cat.tools) {
      if (!t.available) unavailable.push(t.name)
    }
  }
  if (unavailable.length === 0) return ''
  return `\n## UNAVAILABLE TOOLS (do NOT call these)\n${unavailable.map(n => `- ❌ ${n}`).join('\n')}`
}

function toolAvailable(cats: Map<string, ToolCategory>, name: string): boolean {
  for (const [, cat] of cats) {
    for (const t of cat.tools) {
      if (t.name === name) return t.available
    }
  }
  return false
}

/**
 * Analyze user message to determine what "done" means for this task.
 */
export function analyzeTaskContract(userMessage: string): {
  taskType: string
  needsFileWrite: boolean
  needsWebSearch: boolean
  minContentLength: number
  expectedFormat: string
} {
  const m = userMessage.toLowerCase()

  // HTML/网页/生成
  if (/html|HTML|网页|web\s*页|\.html|生成.*网页|创建.*页面|制作.*页面/.test(m)) {
    // Only search web for research/report-type HTML tasks, not simple code generation
    const needsResearch = /报告|report|分析|调研|行业|市场|趋势|数据|竞品/.test(m)
    return { taskType: 'HTML', needsFileWrite: true, needsWebSearch: needsResearch, minContentLength: needsResearch ? 2000 : 500, expectedFormat: '<!DOCTYPE html>...' }
  }

  // 报告/调研
  if (/报告|report|分析报告|调研|行业报告|市场报告/.test(m)) {
    return { taskType: 'REPORT', needsFileWrite: true, needsWebSearch: true, minContentLength: 3000, expectedFormat: 'HTML/markdown report' }
  }

  // 代码修复
  if (/修复|fix|debug|bug|改.*码|修.*码|优化.*码|重构/.test(m)) {
    return { taskType: 'CODE_FIX', needsFileWrite: true, needsWebSearch: false, minContentLength: 50, expectedFormat: 'code changes' }
  }

  // 设计
  if (/设计|海报|UI|design|图|banner|logo/.test(m)) {
    return { taskType: 'DESIGN', needsFileWrite: false, needsWebSearch: false, minContentLength: 20, expectedFormat: 'design output' }
  }

  // 视频
  if (/视频|video|剪辑|montage/.test(m)) {
    return { taskType: 'VIDEO', needsFileWrite: false, needsWebSearch: false, minContentLength: 20, expectedFormat: 'video output' }
  }

  // 文档
  if (/文档|doc|word|ppt|excel|pdf|生成.*文档/.test(m)) {
    return { taskType: 'DOCUMENT', needsFileWrite: true, needsWebSearch: false, minContentLength: 500, expectedFormat: 'document file' }
  }

  // 问答
  if (/[?？]|什么|怎么|如何|为什么|who|what|how|why|when|where/.test(m)) {
    return { taskType: 'QUESTION', needsFileWrite: false, needsWebSearch: !!m.match(/最新|news|recent|202[4-6]/), minContentLength: 20, expectedFormat: 'text answer' }
  }

  // 默认
  return { taskType: 'GENERAL', needsFileWrite: false, needsWebSearch: false, minContentLength: 20, expectedFormat: 'text response' }
}

/**
 * Verify progress: has the chain completed enough steps?
 */
export function verifyTaskProgress(
  contract: ReturnType<typeof analyzeTaskContract>,
  stepCount: number,
  toolCalls: string[],
  lastContent: string,
): { complete: boolean; pushMessage: string | null } {
  const hasWriteFile = toolCalls.includes('write_file')
  const hasWebSearch = toolCalls.includes('web_search')
  const hasWebFetch = toolCalls.includes('web_fetch')
  const hasSearched = hasWebSearch || hasWebFetch
  const contentLen = (lastContent || '').trim().length

  // HTML: needs write_file with .html
  if (contract.taskType === 'HTML') {
    if (hasWriteFile && contentLen > contract.minContentLength) {
      return { complete: true, pushMessage: null }
    }
    if (!hasSearched && stepCount === 1) {
      return { complete: false, pushMessage: '[SYSTEM] Step 1/3: Search for data first. Use web_search with relevant queries.' }
    }
    if (hasSearched && !hasWriteFile && stepCount >= 2) {
      return { complete: false, pushMessage: '[SYSTEM] Step 2/3: Write the HTML file. Use write_file with a .html filename and full content. Do NOT output HTML as chat text.' }
    }
    if (stepCount >= 5) {
      return { complete: false, pushMessage: '[SYSTEM] HARD PUSH: ' + stepCount + ' steps taken. Write the HTML file NOW using write_file. No more searching.' }
    }
    return { complete: false, pushMessage: null }
  }

  // REPORT: needs substantial content + write_file
  if (contract.taskType === 'REPORT') {
    if (hasWriteFile && contentLen > contract.minContentLength) {
      return { complete: true, pushMessage: null }
    }
    if (!hasSearched && stepCount <= 2) {
      return { complete: false, pushMessage: null } // still searching, OK
    }
    if (!hasWriteFile && hasSearched && stepCount >= 3) {
      return { complete: false, pushMessage: '[SYSTEM] Search complete. Now write the report using write_file. Include ALL sections: executive summary, market size, trends, competitors, opportunities, recommendations.' }
    }
    if (stepCount >= 6) {
      return { complete: false, pushMessage: '[SYSTEM] HARD PUSH: Write the report NOW. Use write_file. Output file path when done.' }
    }
    return { complete: false, pushMessage: null }
  }

  // QUESTION: just needs content
  if (contract.taskType === 'QUESTION') {
    if (contentLen > contract.minContentLength) {
      return { complete: true, pushMessage: null }
    }
    return { complete: false, pushMessage: null }
  }

  // CODE_FIX
  if (contract.taskType === 'CODE_FIX') {
    if (hasWriteFile || toolCalls.includes('edit_file')) {
      return { complete: true, pushMessage: null }
    }
    return { complete: false, pushMessage: null }
  }

  // DESIGN / VIDEO
  if (contract.taskType === 'DESIGN' || contract.taskType === 'VIDEO') {
    const designTools = ['open_design_execute', 'opendesign_generate', 'openmontage_execute']
    if (toolCalls.some(t => designTools.includes(t))) {
      return { complete: true, pushMessage: null }
    }
    return { complete: false, pushMessage: null }
  }

  // Default: content-based
  if (contentLen > contract.minContentLength) {
    return { complete: true, pushMessage: null }
  }
  return { complete: false, pushMessage: null }
}

/**
 * Verify the final deliverable meets quality bar.
 */
export function verifyDeliverable(
  contract: ReturnType<typeof analyzeTaskContract>,
  response: string,
  filesWritten: string[],
): { valid: boolean; issue: string | null } {
  const content = response || ''

  // HTML: must contain doctype or html tag
  if (contract.taskType === 'HTML') {
    if (!/<!DOCTYPE html|<html/i.test(content) && filesWritten.length === 0) {
      return { valid: false, issue: 'HTML missing: no <!DOCTYPE html> found and no file was written. Retry with write_file.' }
    }
    if (content.length > 0 && !/<\/html>/i.test(content) && filesWritten.length === 0) {
      return { valid: false, issue: 'HTML truncated: missing closing </html> tag. Regenerate complete HTML.' }
    }
  }

  // REPORT: must be substantial
  if (contract.taskType === 'REPORT') {
    if (content.length < 500 && filesWritten.length === 0) {
      return { valid: false, issue: 'Report too short (< 500 chars). Generate complete report.' }
    }
  }

  return { valid: true, issue: null }
}
