// packages/backend/src/core/harness/skill-discovery.ts · DaShengOS Skill Discovery Engine
// 2026-06-18 · 主动发现可复用模式 + 自动生成 SKILL.md + 工作流编排
//
// 核心:
// 1. 模式检测: 从对话历史中检测重复的工具调用序列 (≥3步 / 同类任务出现≥2次)
// 2. SKILL.md 生成: 从 tool_sequence + 上下文自动生成可复用技能
// 3. 工作流编排: 多步骤工具序列 → 可编排工作流 (workflow skill)
// 4. 注册: 写入 ~/.workbuddy/skills/ + 注册到 cross_session_memory

import fs from 'node:fs'
import path from 'node:path'
import { sqlite } from '../../storage/db.js'
import { saveCrossSessionMemory } from './memory.js'

// ─── Types ─────────────────────────────────────────────────

export interface DiscoveredPattern {
  /** 模式签名 (工具序列的 fingerprint) */
  signature: string
  /** 工具序列 e.g. ['web_search', 'web_fetch', 'write_file'] */
  toolSequence: string[]
  /** 出现次数 */
  frequency: number
  /** 最近的用户意图摘要 */
  recentIntents: string[]
  /** 首次出现时间 */
  firstSeen: number
  /** 最后出现时间 */
  lastSeen: number
  /** 是否为工作流候选 (≥3 步) */
  isWorkflow: boolean
}

export interface SkillDraft {
  name: string
  trigger: string       // 触发条件
  description: string   // 技能描述
  category: string      // 分类
  steps: SkillStepDef[] // 步骤定义
  tools: string[]       // 用到的工具
  riskLevel: 'low' | 'medium' | 'high'
  output: string        // 预期输出
  verification: string  // 验证方法
}

export interface SkillStepDef {
  name: string
  tool: string
  description: string
  args?: string        // 参数模板 (如 {{query}})
  verification: string // 验证条件
}

export interface WorkflowStep extends SkillStepDef {
  /** 依赖: 需要哪些前置步骤完成 */
  dependsOn: string[]
  /** 条件: 满足什么条件才执行 */
  condition?: string
  /** 失败处理: 跳过/重试/中止 */
  onFailure: 'skip' | 'retry' | 'abort'
  /** 最大重试次数 */
  maxRetries: number
}

// ─── 模式检测 ──────────────────────────────────────────────

/**
 * 从 cross_session_memory 中检测 skill_candidate 和 task_pattern
 * 条件: tool_sequence 长度 ≥ 3 或 出现频率 ≥ 2
 */
export function detectPatterns(userId: string, minFrequency = 2): DiscoveredPattern[] {
  ensurePatternTable()

  try {
    // 加载所有有 tool_sequence 的跨对话记忆
    const rows = sqlite
      .prepare(`
        SELECT id, summary, keywords, tool_sequence, created_at
        FROM cross_session_memory
        WHERE user_id = ? AND tool_sequence IS NOT NULL AND tool_sequence != '[]'
        ORDER BY created_at DESC LIMIT 100
      `)
      .all(userId) as Array<{
        id: number
        summary: string
        keywords: string
        tool_sequence: string
        created_at: number
      }>

    if (rows.length === 0) return []

    // 按 tool_sequence 分组
    const patternMap = new Map<string, DiscoveredPattern>()

    for (const row of rows) {
      const tools: string[] = JSON.parse(row.tool_sequence || '[]')
      if (tools.length < 2) continue

      const signature = tools.join('→')

      if (patternMap.has(signature)) {
        const existing = patternMap.get(signature)!
        existing.frequency++
        existing.recentIntents.push(row.summary.slice(0, 80))
        existing.lastSeen = row.created_at
      } else {
        patternMap.set(signature, {
          signature,
          toolSequence: tools,
          frequency: 1,
          recentIntents: [row.summary.slice(0, 80)],
          firstSeen: row.created_at,
          lastSeen: row.created_at,
          isWorkflow: tools.length >= 3,
        })
      }
    }

    // 过滤: 频率 ≥ minFrequency 或 工作流 (≥3步) 且频率 ≥ 1
    const patterns = Array.from(patternMap.values())
      .filter(p => p.frequency >= minFrequency || (p.isWorkflow && p.frequency >= 1))
      .sort((a, b) => b.frequency * b.toolSequence.length - a.frequency * a.toolSequence.length)

    return patterns
  } catch {
    return []
  }
}

/**
 * 实时检测: 在对话过程中检测当前工具序列是否匹配已知模式
 * 如果匹配 → 建议使用已有 skill
 */
export function matchExistingSkill(toolSequence: string[]): {
  matched: boolean
  skillName?: string
  confidence: number
} {
  if (toolSequence.length < 2) return { matched: false, confidence: 0 }

  const signature = toolSequence.join('→')
  const skillsDir = getSkillsDir()

  if (!fs.existsSync(skillsDir)) return { matched: false, confidence: 0 }

  // 遍历已有 skill，比对 tool_sequence
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const skillTools = extractSkillTools(content)
      const skillSignature = skillTools.join('→')

      // 精确匹配
      if (skillSignature === signature) {
        return { matched: true, skillName: entry.name, confidence: 1.0 }
      }

      // 前缀匹配 (用户正在执行 skill 的前几步)
      if (signature.startsWith(skillSignature.split('→').slice(0, toolSequence.length).join('→'))) {
        return { matched: true, skillName: entry.name, confidence: 0.7 }
      }
    } catch { /* ok */ }
  }

  return { matched: false, confidence: 0 }
}

// ─── SKILL.md 生成 ─────────────────────────────────────────

/**
 * 从检测到的模式自动生成 SKILL.md
 * 写入 ~/.workbuddy/skills/<name>/SKILL.md
 */
export function generateSkillFromPattern(pattern: DiscoveredPattern): {
  success: boolean
  skillName: string
  skillPath: string
  error?: string
} {
  const draft = patternToSkillDraft(pattern)
  return saveSkillDraft(draft)
}

/**
 * 从对话上下文手动生成 SKILL.md
 * (由 Agent Loop / System Prompt 中的 Skill Creation Protocol 触发)
 */
export function generateSkillFromContext(opts: {
  name: string
  trigger: string
  description: string
  category?: string
  steps: Array<{
    name: string
    tool: string
    description: string
    args?: string
    verification: string
  }>
  output: string
}): {
  success: boolean
  skillName: string
  skillPath: string
  error?: string
} {
  const draft: SkillDraft = {
    name: opts.name,
    trigger: opts.trigger,
    description: opts.description,
    category: opts.category || 'general',
    steps: opts.steps,
    tools: opts.steps.map(s => s.tool),
    riskLevel: assessRiskLevel(opts.steps.map(s => s.tool)),
    output: opts.output,
    verification: '检查输出文件存在且非空',
  }

  return saveSkillDraft(draft)
}

/**
 * 将检测到的模式转换为 SkillDraft
 */
function patternToSkillDraft(pattern: DiscoveredPattern): SkillDraft {
  const intentSummary = pattern.recentIntents[0] || 'repeated task pattern'

  // 从工具序列推断 skill 名称
  const name = inferSkillName(pattern.toolSequence, intentSummary)

  // 从工具序列生成步骤定义
  const steps: SkillStepDef[] = pattern.toolSequence.map((tool, i) => ({
    name: `Step ${i + 1}: ${tool}`,
    tool,
    description: getToolDescription(tool),
    args: getToolArgsTemplate(tool),
    verification: inferVerification(tool),
  }))

  // 推断类别
  const category = inferCategory(pattern.toolSequence)

  return {
    name,
    trigger: inferTrigger(pattern.toolSequence, intentSummary),
    description: `Auto-discovered ${pattern.isWorkflow ? 'workflow' : 'skill'}: ${intentSummary.slice(0, 100)}`,
    category,
    steps,
    tools: pattern.toolSequence,
    riskLevel: assessRiskLevel(pattern.toolSequence),
    output: inferOutput(pattern.toolSequence),
    verification: `验证最终输出存在且符合预期`,
  }
}

/**
 * 保存 SkillDraft 为 SKILL.md 文件
 */
function saveSkillDraft(draft: SkillDraft): {
  success: boolean
  skillName: string
  skillPath: string
  error?: string
} {
  const skillsDir = getSkillsDir()
  const skillDir = path.join(skillsDir, draft.name)
  const skillMdPath = path.join(skillDir, 'SKILL.md')

  try {
    // 创建目录
    fs.mkdirSync(skillDir, { recursive: true })

    // 如果已存在，不覆盖 (除非是自动发现的 v0 草稿)
    if (fs.existsSync(skillMdPath)) {
      const existingContent = fs.readFileSync(skillMdPath, 'utf-8')
      if (existingContent.includes('agent_created: true')) {
        // 覆盖自动生成的草稿
      } else {
        // 不覆盖人工编写的 skill
        return {
          success: false,
          skillName: draft.name,
          skillPath: skillMdPath,
          error: 'Skill already exists (manually created)',
        }
      }
    }

    // 生成 SKILL.md 内容
    const content = buildSkillMarkdown(draft)
    fs.writeFileSync(skillMdPath, content, 'utf-8')

    // 注册到 cross_session_memory
    saveCrossSessionMemory({
      userId: 'system',
      sessionId: 'skill-discovery',
      category: 'skill_candidate',
      summary: `[SKILL] ${draft.name}: ${draft.description.slice(0, 150)}`,
      keywords: [draft.name, draft.category, ...draft.tools],
      toolSequence: draft.tools,
    })

    return {
      success: true,
      skillName: draft.name,
      skillPath: skillMdPath,
    }
  } catch (err: any) {
    return {
      success: false,
      skillName: draft.name,
      skillPath: skillMdPath,
      error: err.message,
    }
  }
}

/**
 * 生成 SKILL.md Markdown 内容
 */
function buildSkillMarkdown(draft: SkillDraft): string {
  const timestamp = new Date().toISOString().split('T')[0]

  const lines: string[] = [
    `---`,
    `name: "${draft.name}"`,
    `summary: "${draft.description.replace(/"/g, '\\"')}"`,
    `agent_created: true`,
    `auto_discovered: true`,
    `created_at: "${timestamp}"`,
    `category: "${draft.category}"`,
    `risk_level: "${draft.riskLevel}"`,
    `---`,
    ``,
    `# ${draft.name}`,
    ``,
    `${draft.description}`,
    ``,
    `## 触发条件`,
    ``,
    `${draft.trigger}`,
    ``,
    `## 步骤`,
    ``,
  ]

  for (let i = 0; i < draft.steps.length; i++) {
    const step = draft.steps[i]
    lines.push(`### ${i + 1}. ${step.name}`)
    lines.push(``)
    lines.push(`- **工具**: \`${step.tool}\``)
    lines.push(`- **说明**: ${step.description}`)
    if (step.args) {
      lines.push(`- **参数**: \`${step.args}\``)
    }
    lines.push(`- **验证**: ${step.verification}`)
    lines.push(``)
  }

  lines.push(`## 工具序列`)
  lines.push(``)
  lines.push(`\`${draft.tools.join(' → ')}\``)
  lines.push(``)

  lines.push(`## 预期输出`)
  lines.push(``)
  lines.push(draft.output)
  lines.push(``)

  lines.push(`## 验证方法`)
  lines.push(``)
  lines.push(draft.verification)
  lines.push(``)

  lines.push(`## 风险等级`)
  lines.push(``)
  lines.push(draft.riskLevel === 'high' ? '⚠️ 高风险 — 需要用户确认后执行' :
    draft.riskLevel === 'medium' ? '⚡ 中风险 — 建议用户确认' :
    '✅ 低风险 — 可自动执行')
  lines.push(``)

  return lines.join('\n')
}

// ─── 工作流编排 ─────────────────────────────────────────────

/**
 * 从工具序列生成工作流定义
 * 工作流 = 有依赖关系的步骤图 (DAG)
 */
export function buildWorkflowFromPattern(pattern: DiscoveredPattern): {
  name: string
  steps: WorkflowStep[]
  dag: string // Mermaid 格式的 DAG
} {
  const steps: WorkflowStep[] = pattern.toolSequence.map((tool, i) => ({
    name: `step_${i + 1}_${tool}`,
    tool,
    description: getToolDescription(tool),
    args: getToolArgsTemplate(tool),
    verification: inferVerification(tool),
    dependsOn: i > 0 ? [`step_${i}_${pattern.toolSequence[i - 1]}`] : [],
    condition: undefined,
    onFailure: tool === 'web_search' || tool === 'web_fetch' ? 'skip' : 'retry',
    maxRetries: tool === 'run_command' ? 2 : 1,
  }))

  // 生成 Mermaid DAG
  const dagLines = ['graph LR']
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const label = `${step.tool}(${step.tool})`
    if (step.dependsOn.length > 0) {
      for (const dep of step.dependsOn) {
        dagLines.push(`  ${dep.split('_').slice(1).join('_')} --> ${label}`)
      }
    }
  }
  if (dagLines.length === 1) {
    // 没有依赖关系，线性展示
    for (let i = 0; i < steps.length; i++) {
      dagLines.push(`  step_${i}("${steps[i].tool}")`)
      if (i > 0) {
        dagLines.push(`  step_${i - 1} --> step_${i}`)
      }
    }
  }

  return {
    name: inferSkillName(pattern.toolSequence, pattern.recentIntents[0] || ''),
    steps,
    dag: dagLines.join('\n'),
  }
}

/**
 * 批量编排: 检测所有模式 → 生成工作流 → 保存 SKILL.md
 * 后台定期调用 (cron) 或 手动触发
 */
export function discoverAndGenerateSkills(userId: string, minFrequency = 2): {
  discovered: number
  generated: number
  skills: Array<{ name: string; path: string; isNew: boolean }>
} {
  const patterns = detectPatterns(userId, minFrequency)
  const results: Array<{ name: string; path: string; isNew: boolean }> = []
  let generated = 0

  for (const pattern of patterns) {
    // 先检查是否已有此 skill
    const existing = matchExistingSkill(pattern.toolSequence)
    if (existing.matched && existing.confidence >= 0.9) {
      results.push({
        name: existing.skillName || 'unknown',
        path: path.join(getSkillsDir(), existing.skillName || 'unknown', 'SKILL.md'),
        isNew: false,
      })
      continue
    }

    // 生成新 skill
    const result = generateSkillFromPattern(pattern)
    results.push({
      name: result.skillName,
      path: result.skillPath,
      isNew: result.success,
    })
    if (result.success) generated++
  }

  return {
    discovered: patterns.length,
    generated,
    skills: results,
  }
}

// ─── 对话结束时自动检测 ──────────────────────────────────────

/**
 * 在对话结束时调用:
 * 1. 保存 tool_sequence 到跨对话记忆
 * 2. 检测是否匹配已有 skill → 建议用户使用
 * 3. 检测是否存在新模式 → 自动生成 skill 草稿
 */
export function analyzeConversationEnd(opts: {
  userId: string
  sessionId: string
  userMessage: string
  assistantResponse: string
  toolCalls: string[]
}): {
  suggestedSkill?: string
  newSkillGenerated?: string
  patternDetected: boolean
} {
  const { userId, sessionId, userMessage, assistantResponse, toolCalls } = opts

  // 1. 如果工具调用 ≥ 2，保存到跨对话记忆
  if (toolCalls.length >= 2) {
    saveCrossSessionMemory({
      userId,
      sessionId,
      category: toolCalls.length >= 3 ? 'task_pattern' : 'skill_candidate',
      summary: assistantResponse.replace(/\n/g, ' ').slice(0, 200),
      keywords: extractKeywords(userMessage + ' ' + assistantResponse.slice(0, 300)),
      toolSequence: toolCalls,
    })
  }

  // 2. 检查是否匹配已有 skill
  if (toolCalls.length >= 2) {
    const match = matchExistingSkill(toolCalls)
    if (match.matched) {
      return {
        suggestedSkill: match.skillName,
        patternDetected: true,
      }
    }
  }

  // 3. 检测新模式 (需要 ≥ 2 次出现)
  const patterns = detectPatterns(userId, 2)
  const currentSignature = toolCalls.join('→')

  for (const pattern of patterns) {
    if (pattern.signature === currentSignature && pattern.frequency >= 2) {
      // 找到重复模式 → 自动生成 skill
      const result = generateSkillFromPattern(pattern)
      return {
        newSkillGenerated: result.success ? result.skillName : undefined,
        patternDetected: true,
      }
    }
  }

  return { patternDetected: false }
}

// ─── 辅助函数 ──────────────────────────────────────────────

function getSkillsDir(): string {
  return path.join(process.env.HOME || '/Users/apple', '.workbuddy/skills')
}

function inferSkillName(tools: string[], intent: string): string {
  // 从工具序列和意图推断 skill 名称
  const toolNameMap: Record<string, string> = {
    'web_search': 'search',
    'web_fetch': 'fetch',
    'write_file': 'write',
    'edit_file': 'edit',
    'read_file': 'read',
    'run_command': 'exec',
    'db_query': 'query',
    'search_content': 'grep',
    'list_files': 'ls',
    'install_pkg': 'install',
    'git_op': 'git',
    'execute_skill': 'skill',
  }

  const shortNames = tools.map(t => toolNameMap[t] || t)

  // 如果意图中有关键词，优先用意图命名
  const intentWords = intent
    .replace(/[帮我请让我需要使用执行搜索查询生成创建写入修改]/g, '')
    .trim()
    .split(/\s+/)
    .filter((w: string) => w.length >= 2 && w.length <= 6)

  if (intentWords.length > 0) {
    // 拼音化: 用英文前缀 (简化)
    const prefix = intentWords[0]
    return `auto-${shortNames.join('-')}-${prefix}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
  }

  return `auto-${shortNames.join('-')}`.toLowerCase()
}

function getToolDescription(tool: string): string {
  const descriptions: Record<string, string> = {
    'read_file': '读取文件内容',
    'write_file': '创建新文件',
    'edit_file': '精确编辑文件',
    'list_files': '浏览目录结构',
    'search_content': '正则搜索代码库',
    'run_command': '执行 shell 命令',
    'check_process': '检查运行中的进程',
    'check_port': '检查端口占用',
    'read_logs': '读取服务日志',
    'db_query': '查询 SQLite 数据库 (只读)',
    'web_fetch': '抓取网页内容',
    'web_search': '搜索互联网',
    'restart_service': '重启服务',
    'install_pkg': '安装软件包',
    'git_op': 'Git 操作',
    'execute_skill': '执行 WorkBuddy 技能',
  }
  return descriptions[tool] || `使用 ${tool} 工具`
}

function getToolArgsTemplate(tool: string): string {
  const templates: Record<string, string> = {
    'read_file': '{{file_path}}',
    'write_file': '{{file_path}}:{{content}}',
    'edit_file': '{{file_path}}:{{old_string}}→{{new_string}}',
    'list_files': '{{directory}}',
    'search_content': '{{pattern}}:{{path}}',
    'run_command': '{{command}}',
    'check_process': '{{process_name}}',
    'check_port': '{{port}}',
    'read_logs': '{{service}}',
    'db_query': '{{sql}}',
    'web_fetch': '{{url}}',
    'web_search': '{{query}}',
    'restart_service': '{{service}}',
    'install_pkg': '{{package}}',
    'git_op': '{{operation}}:{{args}}',
    'execute_skill': '{{skill_name}}:{{params}}',
  }
  return templates[tool] || '{{args}}'
}

function inferVerification(tool: string): string {
  const verifications: Record<string, string> = {
    'read_file': '文件内容非空',
    'write_file': '文件已创建且内容正确',
    'edit_file': '修改已生效，无语法错误',
    'list_files': '目录列表已获取',
    'search_content': '搜索结果非空',
    'run_command': '命令退出码 = 0',
    'check_process': '进程状态已确认',
    'check_port': '端口状态已确认',
    'read_logs': '日志已获取',
    'db_query': '查询结果非空',
    'web_fetch': '页面内容已获取',
    'web_search': '搜索结果非空',
    'restart_service': '服务已正常运行',
    'install_pkg': '包已安装',
    'git_op': 'Git 操作成功',
    'execute_skill': '技能已执行',
  }
  return verifications[tool] || '操作已完成'
}

function inferCategory(tools: string[]): string {
  if (tools.some(t => ['web_search', 'web_fetch'].includes(t)) && tools.includes('write_file')) {
    return 'research'
  }
  if (tools.some(t => ['read_file', 'edit_file', 'run_command'].includes(t))) {
    return 'development'
  }
  if (tools.some(t => ['db_query', 'web_search'].includes(t)) && tools.includes('write_file')) {
    return 'analysis'
  }
  if (tools.some(t => ['git_op', 'run_command', 'install_pkg'].includes(t))) {
    return 'devops'
  }
  if (tools.includes('execute_skill')) {
    return 'automation'
  }
  return 'general'
}

function inferTrigger(tools: string[], _intent: string): string {
  const triggers: string[] = []

  if (tools.includes('web_search')) {
    triggers.push('需要搜索互联网获取最新信息')
  }
  if (tools.includes('web_fetch')) {
    triggers.push('需要抓取网页内容')
  }
  if (tools.includes('read_file') || tools.includes('edit_file')) {
    triggers.push('需要读取或修改文件')
  }
  if (tools.includes('run_command')) {
    triggers.push('需要执行命令')
  }
  if (tools.includes('db_query')) {
    triggers.push('需要查询数据库')
  }

  if (triggers.length === 0) {
    triggers.push('用户请求执行多步骤任务')
  }

  return triggers.join(' + ')
}

function inferOutput(tools: string[]): string {
  if (tools.includes('write_file')) {
    return '生成的文件 (路径+内容概要)'
  }
  if (tools.includes('db_query')) {
    return '结构化查询结果 (表格/列表)'
  }
  if (tools.includes('web_search')) {
    return '搜索结果汇总 (含来源)'
  }
  return '任务完成确认 + 关键结果'
}

function assessRiskLevel(tools: string[]): 'low' | 'medium' | 'high' {
  const highRisk = ['run_command', 'install_pkg', 'edit_file', 'write_file']
  const mediumRisk = ['git_op', 'restart_service', 'db_query']

  if (tools.some(t => highRisk.includes(t))) {
    if (tools.filter(t => highRisk.includes(t)).length >= 2) return 'high'
    return 'medium'
  }
  if (tools.some(t => mediumRisk.includes(t))) return 'medium'
  return 'low'
}

function extractSkillTools(content: string): string[] {
  const tools: string[] = []
  const toolRegex = /(?:工具|tool)[：:]\s*`?(\w+)`?/gi
  let match
  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1].toLowerCase()
    if (['read_file', 'write_file', 'edit_file', 'list_files', 'search_content',
      'run_command', 'check_process', 'check_port', 'read_logs', 'db_query',
      'web_fetch', 'web_search', 'restart_service', 'install_pkg', 'git_op',
      'execute_skill'].includes(toolName)) {
      tools.push(toolName)
    }
  }
  return tools
}

function extractKeywords(text: string): string[] {
  const stopwords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', 'that', 'the', 'is', 'a', 'an', 'and', 'or', 'to', 'of'])

  const words: string[] = []
  const segments = text.split(/[，。！？、；：""''（）\s,.\-!?;:()[\]{}]+/)
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 8 && !stopwords.has(seg)) {
      words.push(seg)
    }
  }
  return [...new Set(words)].slice(0, 10)
}

function ensurePatternTable(): void {
  try {
    sqlite.prepare(`CREATE TABLE IF NOT EXISTS skill_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      signature TEXT NOT NULL,
      tool_sequence TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      recent_intents TEXT DEFAULT '[]',
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      is_workflow INTEGER DEFAULT 0,
      UNIQUE(user_id, signature)
    )`).run()

    sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_sp_user ON skill_patterns(user_id)').run()
  } catch { /* already exists */ }
}

// ─── 获取已发现的 skill 列表 (给 API 用) ────────────────────

export function listDiscoveredSkills(): Array<{
  name: string
  autoDiscovered: boolean
  path: string
  category: string
  riskLevel: string
}> {
  const skillsDir = getSkillsDir()
  const results: Array<{
    name: string
    autoDiscovered: boolean
    path: string
    category: string
    riskLevel: string
  }> = []

  if (!fs.existsSync(skillsDir)) return results

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
    if (!fs.existsSync(skillMdPath)) continue

    try {
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const isAuto = content.includes('auto_discovered: true')
      const categoryMatch = content.match(/category:\s*"?(\w+)"?/)
      const riskMatch = content.match(/risk_level:\s*"?(\w+)"?/)

      results.push({
        name: entry.name,
        autoDiscovered: isAuto,
        path: skillMdPath,
        category: categoryMatch?.[1] || 'general',
        riskLevel: riskMatch?.[1] || 'low',
      })
    } catch { /* ok */ }
  }

  return results
}
