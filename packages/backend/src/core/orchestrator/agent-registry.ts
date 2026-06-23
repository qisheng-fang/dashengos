// agent-registry.ts — DaShengOS v6.3 Agency Agents 注册表
// 解析 msitarzewski/agency-agents 的 254 个 Agent MD 文件
// 提供: 按名称/部门/意图检索 → 返回 Agent 人格系统提示词

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Types ─────────────────────────────────────────────

export interface AgentDef {
  name: string           // "Frontend Developer"
  slug: string           // "frontend-developer"
  description: string    // 简短描述
  division: string       // "engineering"
  divisionLabel: string  // "Engineering"
  emoji: string          // "🖥️"
  color: string          // "cyan"
  vibe: string           // 人格标签
  tools: string[]        // 可用工具
  systemPrompt: string   // 完整系统提示词
  filePath: string       // 源文件路径
}

export interface AgentDivision {
  slug: string
  label: string
  icon: string
  color: string
  agents: AgentDef[]
}

// ─── Division Metadata ─────────────────────────────────

const DIVISION_META: Record<string, { label: string; icon: string; color: string }> = {
  academic:              { label: '学术研究', icon: 'GraduationCap', color: '#8B5CF6' },
  design:                { label: '设计', icon: 'PenTool', color: '#EC4899' },
  engineering:           { label: '技术研发', icon: 'Code', color: '#3B82F6' },
  finance:               { label: '财务', icon: 'DollarSign', color: '#22C55E' },
  'game-development':    { label: '游戏开发', icon: 'Gamepad2', color: '#A855F7' },
  gis:                   { label: 'GIS地理', icon: 'Map', color: '#14B8A6' },
  marketing:             { label: '市场营销', icon: 'Megaphone', color: '#F97316' },
  'paid-media':          { label: '付费媒体', icon: 'Target', color: '#EAB308' },
  product:               { label: '产品', icon: 'Box', color: '#D946EF' },
  'project-management':  { label: '项目管理', icon: 'ClipboardList', color: '#06B6D4' },
  sales:                 { label: '销售', icon: 'TrendingUp', color: '#10B981' },
  security:              { label: '安全', icon: 'Shield', color: '#EF4444' },
  'spatial-computing':   { label: '空间计算', icon: 'VrHeadset', color: '#6366F1' },
  specialized:           { label: '专业领域', icon: 'Star', color: '#F59E0B' },
  strategy:              { label: '战略', icon: 'Target', color: '#8B5CF6' },
  support:               { label: '支持', icon: 'LifeBuoy', color: '#0EA5E9' },
  testing:               { label: '测试QA', icon: 'CheckCircle', color: '#84CC16' },
}

// ─── Intent → Division → Agent 路由表 ──────────────────

interface RouteRule {
  keywords: string[]
  division: string
  primaryAgent: string
  mode: 'pipeline' | 'parallel' | 'debate' | 'hierarchical' | 'auction'
  chain: string[]
}

const ROUTING_TABLE: RouteRule[] = [
  { keywords: ['行业报告','市场报告','调研','报告','行业分析','竞品分析','市场分析'], division: 'marketing', primaryAgent: 'trend-researcher', mode: 'pipeline', chain: ['trend-researcher','data-analytics-reporter','executive-summary-generator','reality-checker'] },
  { keywords: ['代码','修复','debug','bug','报错','错误','fix','程序','编程','开发','写一个','创建一个','实现'], division: 'engineering', primaryAgent: 'senior-developer', mode: 'pipeline', chain: ['senior-developer','test-results-analyzer'] },
  { keywords: ['设计','海报','UI','UX','界面','画一个','banner','logo','图标','配色'], division: 'design', primaryAgent: 'ui-designer', mode: 'hierarchical', chain: ['ui-designer','brand-guardian','ux-researcher'] },
  { keywords: ['视频','剪辑','动画','拍摄','短视频','抖音','tiktok'], division: 'specialized', primaryAgent: 'video-producer', mode: 'pipeline', chain: ['video-producer','reality-checker'] },
  { keywords: ['文案','营销','广告','文案策划','推广','活动策划','增长','用户增长','获客','A/B测试'], division: 'marketing', primaryAgent: 'growth-hacker', mode: 'parallel', chain: ['growth-hacker','content-creator','social-media-strategist'] },
  { keywords: ['SEO','关键词','搜索优化','排名','搜索'], division: 'marketing', primaryAgent: 'app-store-optimizer', mode: 'pipeline', chain: ['trend-researcher','app-store-optimizer'] },
  { keywords: ['数据','分析','可视化','图表','统计','报表','BI'], division: 'specialized', primaryAgent: 'data-analytics-reporter', mode: 'pipeline', chain: ['data-analytics-reporter','executive-summary-generator'] },
  { keywords: ['安全','漏洞','审计','渗透','合规','加密','攻击'], division: 'security', primaryAgent: 'penetration-tester', mode: 'debate', chain: ['penetration-tester','security-architect','compliance-auditor'] },
  { keywords: ['测试','QA','质量','自动化测试','单元测试','性能测试','E2E'], division: 'testing', primaryAgent: 'test-results-analyzer', mode: 'pipeline', chain: ['test-results-analyzer','reality-checker'] },
  { keywords: ['电商','店铺','商品','淘宝','京东','拼多多','亚马逊','跨境','直播带货','私域'], division: 'sales', primaryAgent: 'account-strategist', mode: 'parallel', chain: ['account-strategist','pipeline-analyst'] },
  { keywords: ['游戏','手游','Unity','Unreal','关卡','角色','NPC','玩法'], division: 'game-development', primaryAgent: 'game-designer', mode: 'pipeline', chain: ['game-designer','reality-checker'] },
  { keywords: ['财务','预算','投资','ROI','现金流','税务','会计','审计财务'], division: 'finance', primaryAgent: 'financial-analyst', mode: 'pipeline', chain: ['financial-analyst','executive-summary-generator'] },
  { keywords: ['GIS','地图','地理','空间','坐标','定位','GPS'], division: 'gis', primaryAgent: 'gis-analyst', mode: 'pipeline', chain: ['gis-analyst','executive-summary-generator'] },
  { keywords: ['项目管理','敏捷','Scrum','Sprint','Jira','甘特图','里程碑'], division: 'project-management', primaryAgent: 'senior-pm', mode: 'hierarchical', chain: ['senior-pm','project-shepherd'] },
  { keywords: ['空间计算','XR','AR','VR','Vision Pro','Apple Vision','头显','沉浸式'], division: 'spatial-computing', primaryAgent: 'xr-interface-architect', mode: 'pipeline', chain: ['xr-interface-architect','reality-checker'] },
]

// ─── Registry ──────────────────────────────────────────

let registry: Map<string, AgentDef> | null = null
let divisions: Map<string, AgentDivision> | null = null

const AGENCY_ROOT = join(dirname(dirname(dirname(dirname(dirname(__dirname))))), 'embedded', 'agency-agents')

function parseFrontmatter(content: string): { data: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { data: {}, body: content }
  const data: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)/)
    if (kv) data[kv[1]] = kv[2].trim()
  }
  return { data, body: match[2].trim() }
}

export function loadAgentRegistry(agencyPath?: string): Map<string, AgentDef> {
  if (registry) return registry
  const root = agencyPath || AGENCY_ROOT
  registry = new Map()

  if (!existsSync(root)) {
    console.warn(`[AgentRegistry] agency-agents not found at ${root}`)
    return registry
  }

  const SKIP_DIRS = new Set(['.git', '.github', 'examples', 'scripts', 'integrations'])
  let totalAgents = 0

  for (const dirName of readdirSync(root)) {
    const dirPath = join(root, dirName)
    if (SKIP_DIRS.has(dirName)) continue
    try {
      if (!readdirSync(dirPath).some) continue // not a directory
    } catch { continue }

    const divMeta = DIVISION_META[dirName]
    if (!divMeta) continue

    const files = readdirSync(dirPath).filter(f => f.endsWith('.md'))
    for (const file of files) {
      try {
        const content = readFileSync(join(dirPath, file), 'utf-8')
        const { data, body } = parseFrontmatter(content)
        if (!data.name) continue

        const slug = file.replace(/\.md$/, '').replace(/^[a-z]+-/, '')
        const tools = data.tools ? data.tools.split(/,\s*/).map(t => t.trim()) : []

        const agent: AgentDef = {
          name: data.name,
          slug,
          description: data.description || '',
          division: dirName,
          divisionLabel: divMeta.label,
          emoji: data.emoji || '🤖',
          color: data.color || divMeta.color,
          vibe: data.vibe || '',
          tools,
          systemPrompt: body,
          filePath: join(dirPath, file),
        }
        registry.set(`${dirName}/${slug}`, agent)
        registry.set(slug, agent) // also by short slug
        totalAgents++
      } catch (e: any) {
        // skip unparseable files
      }
    }
  }

  console.log(`[AgentRegistry] loaded ${totalAgents} agents from ${root}`)
  return registry
}

export function getAgentDivisions(): AgentDivision[] {
  const reg = loadAgentRegistry()
  if (divisions) return Array.from(divisions.values())

  const divMap = new Map<string, AgentDivision>()
  for (const agent of reg.values()) {
    if (!divMap.has(agent.division)) {
      const meta = DIVISION_META[agent.division] || { label: agent.division, icon: 'Folder', color: '#888' }
      divMap.set(agent.division, { slug: agent.division, label: meta.label, icon: meta.icon, color: meta.color, agents: [] })
    }
    divMap.get(agent.division)!.agents.push(agent)
  }
  divisions = divMap
  return Array.from(divMap.values())
}

export function findAgent(query: string): AgentDef | null {
  const reg = loadAgentRegistry()
  // Exact slug match
  if (reg.has(query)) return reg.get(query)!
  // Substring match on name or description
  const q = query.toLowerCase()
  for (const agent of reg.values()) {
    if (agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q)) return agent
  }
  return null
}

export function findAgentsByDivision(division: string): AgentDef[] {
  const reg = loadAgentRegistry()
  return Array.from(reg.values()).filter(a => a.division === division)
}

// ─── Intent Router ─────────────────────────────────────

export interface RouteResult {
  matched: boolean
  division: string
  divisionLabel: string
  primaryAgent: AgentDef | null
  mode: 'pipeline' | 'parallel' | 'debate' | 'hierarchical' | 'auction'
  chain: string[]       // agent slugs in execution order
  chainAgents: AgentDef[]
  confidence: number
}

export function routeIntent(message: string): RouteResult {
  const reg = loadAgentRegistry()
  const msg = message.toLowerCase()

  // 1. Keyword matching against routing table
  let bestRule: RouteRule | null = null
  let bestScore = 0

  for (const rule of ROUTING_TABLE) {
    let score = 0
    for (const kw of rule.keywords) {
      if (msg.includes(kw.toLowerCase())) score += kw.length
    }
    if (score > bestScore) { bestScore = score; bestRule = rule }
  }

  if (bestRule && bestScore > 0) {
    const chainAgents: AgentDef[] = []
    for (const slug of bestRule.chain) {
      const agent = findAgent(slug)
      if (agent) chainAgents.push(agent)
    }
    const primaryAgent = findAgent(bestRule.primaryAgent)
    const divMeta = DIVISION_META[bestRule.division] || { label: bestRule.division, icon: 'Folder', color: '#888' }
    return {
      matched: true,
      division: bestRule.division,
      divisionLabel: divMeta.label,
      primaryAgent,
      mode: bestRule.mode,
      chain: bestRule.chain,
      chainAgents,
      confidence: Math.min(bestScore / 30, 1),
    }
  }

  // 2. Fallback: search by description across all agents
  let bestAgent: AgentDef | null = null
  let bestDescScore = 0
  for (const agent of reg.values()) {
    const desc = agent.description.toLowerCase()
    let score = 0
    for (const word of msg.split(/\s+/)) {
      if (desc.includes(word)) score += word.length
    }
    if (score > bestDescScore) { bestDescScore = score; bestAgent = agent }
  }

  if (bestAgent) {
    const meta = DIVISION_META[bestAgent.division] || { label: bestAgent.division, icon: 'Folder', color: '#888' }
    return {
      matched: true,
      division: bestAgent.division,
      divisionLabel: meta.label,
      primaryAgent: bestAgent,
      mode: 'pipeline',
      chain: [bestAgent.slug],
      chainAgents: [bestAgent],
      confidence: Math.min(bestDescScore / 50, 0.6),
    }
  }

  return { matched: false, division: '', divisionLabel: '', primaryAgent: null, mode: 'pipeline', chain: [], chainAgents: [], confidence: 0 }
}

// ─── Agent System Prompt Builder ───────────────────────

export function buildAgentSystemPrompt(agent: AgentDef, task: string, format?: string): string {
  const toolsSection = agent.tools.length > 0
    ? `\n## Available Tools\n${agent.tools.map(t => `- ${t}`).join('\n')}`
    : ''

  const formatSection = format
    ? `\n## Output Format\n${format}`
    : ''

  return `${agent.emoji} ${agent.name} — ${agent.vibe}

${agent.systemPrompt}

---

## Current Task
${task}
${toolsSection}
${formatSection}

## Instructions
1. Follow your role-specific workflow above
2. Output ONLY the final deliverable — no meta-commentary or explanations
3. If you need additional tools, request them via function calling
4. Be thorough and professional
5. Output in ${format || 'text'} format`
}

// ─── Initialize on import ──────────────────────────────
// Lazy load: first call to loadAgentRegistry() triggers actual file reading
export function getAgentCount(): number {
  return loadAgentRegistry().size
}
