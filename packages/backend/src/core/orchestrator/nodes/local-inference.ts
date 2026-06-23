// orchestrator/nodes/local-inference.ts — DaShengOS v6.1 本地推理引擎
// Zero-dependency, instant (<1ms). Uses hash-BOW embeddings + rule scoring.
// Replaces LLM calls for fast pre/post processing.

import { embedText, cosineSimilarity } from '../../harness/vector-memory.js'

// ═══════════════════════════════════════════════════════
// 1. INTENT CLASSIFIER (replaces/supplements analyzeTaskContract)
// ═══════════════════════════════════════════════════════

interface IntentScore {
  category: string
  confidence: number
  needsWebSearch: boolean
  needsFileWrite: boolean
  expectedFormat: string
}

const INTENT_PATTERNS: Array<{ regex: RegExp; category: string; weight: number; search: boolean; file: boolean; format: string }> = [
  // HTML/generation
  { regex: /html|HTML|网页|页面|生成.*网页|创建.*页面|制作.*页面|写.*html/i, category: 'HTML', weight: 10, search: true, file: true, format: 'HTML' },
  // Reports
  { regex: /报告|report|分析报告|调研|行业报告|市场报告|趋势报告|研究|研报/i, category: 'REPORT', weight: 9, search: true, file: true, format: 'HTML report' },
  // Code fix
  { regex: /修复|fix|debug|bug|改.*码|修.*码|优化.*码|重构|报错|error|崩溃|crash/i, category: 'CODE_FIX', weight: 8, search: false, file: true, format: 'code changes' },
  // Design
  { regex: /设计|海报|UI|design|图|banner|logo|界面|画|渲染|生成.*图/i, category: 'DESIGN', weight: 8, search: false, file: false, format: 'design output' },
  // Video
  { regex: /视频|video|剪辑|蒙太奇|montage|生成.*视频|制作.*视频/i, category: 'VIDEO', weight: 8, search: false, file: false, format: 'video output' },
  // Document
  { regex: /文档|doc|word|ppt|excel|pdf|生成.*文档|导出/i, category: 'DOCUMENT', weight: 7, search: false, file: true, format: 'document' },
  // Question
  { regex: /[?？]|什么|怎么|如何|为什么|who|what|how|why|when|where|可以|能不能/i, category: 'QUESTION', weight: 5, search: false, file: false, format: 'text' },
  // Search-oriented
  { regex: /搜索|查|找|最新|202[4-6]|trend|news|recent|update/i, category: 'SEARCH', weight: 6, search: true, file: false, format: 'text' },
]

export function classifyIntentLocal(message: string): IntentScore {
  const scores: Record<string, number> = {}
  let bestFormat = 'text'
  let needsSearch = false
  let needsFile = false

  for (const pattern of INTENT_PATTERNS) {
    if (pattern.regex.test(message)) {
      scores[pattern.category] = (scores[pattern.category] || 0) + pattern.weight
      if (pattern.search) needsSearch = true
      if (pattern.file) needsFile = true
      if (pattern.weight >= 8) bestFormat = pattern.format
    }
  }

  // Find highest scoring category
  let bestCat = 'GENERAL'
  let bestScore = 0
  for (const [cat, score] of Object.entries(scores)) {
    if (score > bestScore) { bestCat = cat; bestScore = score }
  }

  // Normalize confidence (0-1)
  const confidence = Math.min(bestScore / 15, 1.0)

  return {
    category: bestCat,
    confidence,
    needsWebSearch: needsSearch,
    needsFileWrite: needsFile,
    expectedFormat: bestFormat,
  }
}

// ═══════════════════════════════════════════════════════
// 2. HTML COMPLETENESS VERIFIER (structural checks)
// ═══════════════════════════════════════════════════════

interface HtmlCheckResult {
  complete: boolean
  score: number // 0-100
  issues: string[]
  hasDoctype: boolean
  hasHtmlTag: boolean
  hasHead: boolean
  hasBody: boolean
  hasClosingTags: boolean
  contentLength: number
  sectionsFound: string[]
  missingSections: string[]
}

const REPORT_SECTIONS = [
  '执行摘要', 'executive summary', '概述', 'overview',
  '市场规模', 'market size', '市场', 'market',
  '趋势', 'trend', 'trends',
  '竞争', '竞品', 'competitor', 'competitive',
  '机会', '建议', 'opportunity', 'recommendation',
  '风险', 'risk',
]

export function verifyHtmlCompleteness(content: string, expectedType: string): HtmlCheckResult {
  const result: HtmlCheckResult = {
    complete: false, score: 0, issues: [],
    hasDoctype: false, hasHtmlTag: false, hasHead: false, hasBody: false, hasClosingTags: false,
    contentLength: content.length,
    sectionsFound: [], missingSections: [],
  }

  const lower = content.toLowerCase()

  // Structural checks
  result.hasDoctype = /<!doctype html/i.test(content)
  result.hasHtmlTag = /<html/i.test(content) && /<\/html>/i.test(content)
  result.hasHead = /<head/i.test(content) && /<\/head>/i.test(content)
  result.hasBody = /<body/i.test(content)
  result.hasClosingTags = content.includes('</html>') || content.includes('</body>')

  // Report section checks
  if (expectedType.includes('REPORT') || expectedType.includes('HTML')) {
    for (const section of REPORT_SECTIONS) {
      if (lower.includes(section.toLowerCase())) {
        if (!result.sectionsFound.includes(section)) result.sectionsFound.push(section)
      }
    }
    // Key sections that should be present
    const keySections = ['市场', 'market', '趋势', 'trend', '竞争', 'competitor']
    for (const ks of keySections) {
      if (!result.sectionsFound.some(s => s.toLowerCase().includes(ks.toLowerCase()))) {
        result.missingSections.push(ks)
      }
    }
  }

  // Calculate score
  let score = 0
  if (result.hasDoctype) score += 10
  if (result.hasHtmlTag) score += 20
  if (result.hasHead) score += 10
  if (result.hasBody) score += 10
  if (result.hasClosingTags) score += 15
  if (result.contentLength > 500) score += 10
  if (result.contentLength > 2000) score += 15
  if (result.contentLength > 5000) score += 10
  if (result.missingSections.length === 0) score += 10
  else if (result.missingSections.length <= 2) score += 5

  result.score = Math.min(score, 100)

  // Issues
  if (!result.hasDoctype) result.issues.push('Missing <!DOCTYPE html>')
  if (!result.hasHtmlTag) result.issues.push('Missing <html> tags')
  if (!result.hasClosingTags) result.issues.push('HTML not properly closed')
  if (result.contentLength < 500) result.issues.push('Content too short (<500 chars)')
  if (result.missingSections.length > 0) result.issues.push(`Missing sections: ${result.missingSections.join(', ')}`)

  result.complete = result.score >= 70 && result.hasHtmlTag

  return result
}

// ═══════════════════════════════════════════════════════
// 3. SEMANTIC DUPLICATE DETECTOR (loop prevention)
// ═══════════════════════════════════════════════════════

interface DuplicateCheck {
  isDuplicate: boolean
  similarity: number
  matchedContent: string
}

const recentOutputs: Array<{ vec: number[]; content: string; ts: number }> = []
const MAX_RECENT = 20

export function checkSemanticDuplicate(content: string, threshold = 0.85): DuplicateCheck {
  if (!content || content.length < 20) return { isDuplicate: false, similarity: 0, matchedContent: '' }

  const vec = embedText(content.slice(0, 500))
  const now = Date.now()

  // Clean old entries (>5 min)
  while (recentOutputs.length > 0 && now - recentOutputs[0].ts > 300000) {
    recentOutputs.shift()
  }

  let bestSimilarity = 0
  let bestMatch = ''

  for (const entry of recentOutputs) {
    const sim = cosineSimilarity(vec, entry.vec)
    if (sim > bestSimilarity) {
      bestSimilarity = sim
      bestMatch = entry.content
    }
  }

  // Store current
  recentOutputs.push({ vec, content, ts: now })
  if (recentOutputs.length > MAX_RECENT) recentOutputs.shift()

  return {
    isDuplicate: bestSimilarity > threshold,
    similarity: bestSimilarity,
    matchedContent: bestMatch.slice(0, 100),
  }
}

// ═══════════════════════════════════════════════════════
// 4. TOKEN BUDGET OPTIMIZER
// ═══════════════════════════════════════════════════════

export function estimateOptimalTokens(
  taskType: string,
  contentLength: number,
  hasSearchResults: boolean,
): { recommended: number; maxTurns: number; reasoning: string } {
  const searchDataTokens = hasSearchResults ? Math.ceil(contentLength / 2.5) : 0

  switch (taskType) {
    case 'HTML':
      return { recommended: 12288, maxTurns: 5, reasoning: 'HTML report: full generation, extended tokens' }
    case 'REPORT':
      return { recommended: searchDataTokens > 3000 ? 12288 : 8192, maxTurns: 6, reasoning: 'Report: data-driven synthesis' }
    case 'CODE_FIX':
      return { recommended: 8192, maxTurns: 8, reasoning: 'Code: read→edit→verify cycle' }
    case 'QUESTION':
      return { recommended: 2048, maxTurns: 2, reasoning: 'Simple Q&A: concise answer' }
    case 'DESIGN':
    case 'VIDEO':
      return { recommended: 2048, maxTurns: 3, reasoning: 'Design/Video: tool delegation' }
    default:
      return { recommended: 4096, maxTurns: 4, reasoning: 'General task' }
  }
}

// ═══════════════════════════════════════════════════════
// 5. QUALITY SCORER (fast pre-verify, no LLM)
// ═══════════════════════════════════════════════════════

export function quickQualityScore(content: string, taskType: string): { score: number; flags: string[] } {
  const flags: string[] = []
  let score = 100

  // Empty check
  if (!content || content.trim().length === 0) {
    return { score: 0, flags: ['Empty content'] }
  }

  // Placeholder check
  if (/TODO|TBD|FIXME|...{3,}|placeholder|lorem ipsum/i.test(content)) {
    flags.push('Contains placeholders')
    score -= 30
  }

  // Truncation check
  if (content.length > 100 && !/[\.。!！?？\n]$/.test(content.trim())) {
    flags.push('Possibly truncated (no ending punctuation)')
    score -= 10
  }

  // HTML-specific
  if (taskType === 'HTML' || taskType === 'REPORT') {
    if (content.length < 500) { flags.push('HTML too short (<500)'); score -= 40 }
    else if (content.length < 2000) { flags.push('HTML report too short (<2000)'); score -= 20 }
  }

  // Generic greeting filter
  if (/^(你好|hi|hello|好的|收到|OK)\b/i.test(content.trim())) {
    flags.push('Starts with greeting — possible incomplete')
    score -= 25
  }

  return { score: Math.max(0, score), flags }
}

// ═══════════════════════════════════════════════════════
// 6. AGENCY ORCHESTRATOR ROUTING TABLE
// ═══════════════════════════════════════════════════════

interface AgencyRoute {
  keywords: RegExp[]
  department: string
  primaryAgent: string
  mode: 'pipeline' | 'parallel' | 'debate' | 'hierarchical' | 'auction'
  chain: string[]
}

export const AGENCY_ROUTES: AgencyRoute[] = [
  {
    keywords: [/报告|report|调研|行业|市场|趋势|分析报告/i],
    department: '市场情报部', primaryAgent: '行业分析师',
    mode: 'pipeline', chain: ['researcher', 'data_scientist', 'synthesizer', 'verifier'],
  },
  {
    keywords: [/修复|fix|debug|bug|报错|error|crash|代码.*错/i],
    department: '技术研发部', primaryAgent: '全栈工程师',
    mode: 'pipeline', chain: ['coder', 'verifier'],
  },
  {
    keywords: [/设计|海报|UI|banner|logo|界面|画.*图|生成.*图/i],
    department: '内容创作部', primaryAgent: '平面设计师',
    mode: 'hierarchical', chain: ['designer'],
  },
  {
    keywords: [/视频|video|剪辑|蒙太奇|montage/i],
    department: '内容创作部', primaryAgent: '视频剪辑师',
    mode: 'pipeline', chain: ['videomaker'],
  },
  {
    keywords: [/文案|营销|推广|广告|slogan|宣传语/i],
    department: '内容创作部', primaryAgent: '文案策划',
    mode: 'parallel', chain: ['synthesizer'],
  },
  {
    keywords: [/SEO|seo|搜索.*优化|关键词.*研究|排名/i],
    department: '市场情报部', primaryAgent: 'SEO专家',
    mode: 'pipeline', chain: ['researcher', 'synthesizer'],
  },
  {
    keywords: [/数据.*分析|数据.*可视化|dashboard|图表|BI/i],
    department: '市场情报部', primaryAgent: '数据科学家',
    mode: 'pipeline', chain: ['researcher', 'synthesizer'],
  },
  {
    keywords: [/安全|漏洞|渗透|审计|scan/i],
    department: '技术研发部', primaryAgent: '安全工程师',
    mode: 'debate', chain: ['coder', 'verifier'],
  },
  {
    keywords: [/战略|规划|roadmap|路线图|决策/i],
    department: '战略指挥部', primaryAgent: 'CSO Agent',
    mode: 'hierarchical', chain: ['researcher', 'synthesizer', 'verifier'],
  },
  {
    keywords: [/文档|doc|word|ppt|excel|pdf/i],
    department: '技术研发部', primaryAgent: '全栈工程师',
    mode: 'pipeline', chain: ['synthesizer'],
  },
]

export function routeToAgency(message: string): AgencyRoute | null {
  for (const route of AGENCY_ROUTES) {
    for (const kw of route.keywords) {
      if (kw.test(message)) {
        return route
      }
    }
  }
  return null
}
