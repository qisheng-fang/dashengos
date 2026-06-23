// packages/backend/src/core/user-profile-evolver.ts · DaShengOS v6.0
// 动态用户档案进化 — 每次对话后自动更新用户画像
// 2026-06-23

import { sqlite } from '../storage/db.js'
import { appendLedger } from './memory-ledger.js'

// ─── Types ─────────────────────────────────────────────────

export interface DynamicUserProfile {
  userId: string
  username: string
  role: string

  // 行为偏好 (从对话中学习)
  preferredStyle: 'concise' | 'detailed'      // 简洁 vs 详细
  preferredFormat: 'text' | 'table' | 'chart' | 'bullet'  // 输出格式
  preferredLanguage: 'zh' | 'en' | 'mixed'
  
  // 领域知识 (对话涉及的主题)
  topTopics: string[]           // 最常讨论的5个主题
  topicExpertise: Record<string, number>  // 主题 → 熟练度 0-1
  
  // 工具使用偏好
  favoriteTools: string[]       // 最常用的5个工具
  toolSequencePatterns: string[] // 重复出现的工具调用模式
  
  // 行为模式
  avgSessionLength: number      // 平均会话轮数
  peakActivityHour: number      // 最活跃时段 (0-23)
  taskComplexity: 'simple' | 'moderate' | 'complex'  // 任务复杂度偏好
  
  // 元数据
  totalSessions: number
  totalInteractions: number
  lastEvolvedAt: number
  createdAt: number
  updatedAt: number
}

// ─── DB Schema ─────────────────────────────────────────────

function ensureProfileTable(): void {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS dynamic_user_profiles (
      user_id TEXT PRIMARY KEY,
      username TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'USER',
      preferred_style TEXT DEFAULT 'concise',
      preferred_format TEXT DEFAULT 'text',
      preferred_language TEXT DEFAULT 'zh',
      top_topics TEXT DEFAULT '[]',
      topic_expertise TEXT DEFAULT '{}',
      favorite_tools TEXT DEFAULT '[]',
      tool_sequence_patterns TEXT DEFAULT '[]',
      avg_session_length REAL DEFAULT 0,
      peak_activity_hour INTEGER DEFAULT 9,
      task_complexity TEXT DEFAULT 'moderate',
      total_sessions INTEGER DEFAULT 0,
      total_interactions INTEGER DEFAULT 0,
      last_evolved_at INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()*1000)
    )
  `).run()
}

// ─── Core: 进化用户档案 ───────────────────────────────────

export function evolveUserProfile(opts: {
  userId: string
  username?: string
  role?: string
  sessionMessages: Array<{ role: string; content: string }>
  toolCallsInSession: string[]
  sessionDurationMs: number
}): DynamicUserProfile | null {
  ensureProfileTable()
  
  // 1. 加载或创建档案
  let profile = loadProfile(opts.userId)
  const isNew = !profile
  
  if (isNew) {
    profile = createDefaultProfile(opts.userId, opts.username || 'user', opts.role || 'USER')
  }

  const oldProfile = { ...profile }

  // 2. 分析本轮对话
  const analysis = analyzeSession(opts.sessionMessages, opts.toolCallsInSession)

  // 3. 进化各项指标 (指数移动平均)
  profile.preferredStyle = updatePreference(profile.preferredStyle, analysis.detectedStyle, 0.3)
  profile.preferredFormat = updatePreference(profile.preferredFormat, analysis.detectedFormat, 0.2)

  // 主题更新
  for (const topic of analysis.topics) {
    profile.topicExpertise[topic] = Math.min(1, (profile.topicExpertise[topic] || 0) + 0.1)
  }
  // 衰减未出现的主题
  for (const t of Object.keys(profile.topicExpertise)) {
    if (!analysis.topics.includes(t)) {
      profile.topicExpertise[t] = Math.max(0, profile.topicExpertise[t] - 0.05)
    }
  }
  profile.topTopics = Object.entries(profile.topicExpertise)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k)

  // 工具使用更新
  for (const tool of opts.toolCallsInSession) {
    const idx = profile.favoriteTools.indexOf(tool)
    if (idx >= 0) profile.favoriteTools.splice(idx, 1)
    profile.favoriteTools.unshift(tool)
  }
  profile.favoriteTools = profile.favoriteTools.slice(0, 8)

  // 统计更新
  profile.totalInteractions++
  if (isNew) profile.totalSessions = 1
  else profile.totalSessions = Math.max(profile.totalSessions, (sqlite.prepare(
    'SELECT COUNT(*) as c FROM sessions WHERE user_id = ?'
  ).get(opts.userId) as any)?.c || profile.totalSessions + 1)

  profile.avgSessionLength = profile.avgSessionLength * 0.8 + opts.sessionMessages.length * 0.2
  profile.updatedAt = Date.now()
  profile.lastEvolvedAt = Date.now()

  // 4. 持久化
  saveProfile(profile)

  // 5. 记录 Ledger
  appendLedger({
    userId: opts.userId,
    operation: isNew ? 'create' : 'update',
    targetType: 'profile',
    targetId: opts.userId,
    oldValue: isNew ? null : JSON.stringify(oldProfile).slice(0, 500),
    newValue: JSON.stringify(profile).slice(0, 500),
    source: 'auto_evolve',
  })

  return profile
}

// ─── 会话分析 ─────────────────────────────────────────────

interface SessionAnalysis {
  detectedStyle: 'concise' | 'detailed'
  detectedFormat: 'text' | 'table' | 'chart' | 'bullet'
  topics: string[]
  complexity: 'simple' | 'moderate' | 'complex'
}

function analyzeSession(
  messages: Array<{ role: string; content: string }>,
  toolCalls: string[]
): SessionAnalysis {
  const allText = messages.map(m => m.content).join(' ')
  const userText = messages.filter(m => m.role === 'user').map(m => m.content).join(' ')

  // 风格检测: 用户要求"简短/一句话" → concise; "详细/完整" → detailed
  const conciseHints = /简短|简洁|一句话|简单说|大概|简要|简略/.test(userText)
  const detailedHints = /详细|完整|全面|深度|透彻|一步步|仔细/.test(userText)
  const detectedStyle: 'concise' | 'detailed' = conciseHints && !detailedHints ? 'concise' : 'detailed'

  // 格式检测
  let detectedFormat: 'text' | 'table' | 'chart' | 'bullet' = 'text'
  if (/表格|列表|对比|表格形式/.test(userText)) detectedFormat = 'table'
  else if (/图表|可视化|画图|图形|chart/.test(userText)) detectedFormat = 'chart'
  else if (/列出|罗列|要点|bullet|几点/.test(userText)) detectedFormat = 'bullet'

  // 主题提取
  const topicPatterns = [
    '情趣娃娃', '实体娃娃', '硅胶娃娃', 'TPE', 'AI', '人工智能',
    '电商', '抖音', '小红书', '微信', '私域', 'CRM',
    '营销', '广告', '投放', 'SEO', '文案', '视频',
    '行业报告', '市场分析', '竞品', '定价', '供应链',
    '报告', '分析', '设计', '开发', '部署', '运维',
    'deepseek', '模型', 'LLM', 'Agent', 'MCP',
  ]
  const topics = topicPatterns.filter(t => allText.includes(t))

  // 复杂度
  const complexity: 'simple' | 'moderate' | 'complex' = 
    toolCalls.length >= 4 ? 'complex' :
    toolCalls.length >= 2 ? 'moderate' : 'simple'

  return { detectedStyle, detectedFormat, topics, complexity }
}

function updatePreference<T extends string>(current: T, detected: T, alpha: number): T {
  // 简单EMA: 如果检测到不同偏好, 以 alpha 概率切换
  if (detected !== current && Math.random() < alpha) return detected
  return current
}

// ─── Profile CRUD ─────────────────────────────────────────

function createDefaultProfile(userId: string, username: string, role: string): DynamicUserProfile {
  return {
    userId, username, role,
    preferredStyle: 'concise',
    preferredFormat: 'text',
    preferredLanguage: 'zh',
    topTopics: [],
    topicExpertise: {},
    favoriteTools: [],
    toolSequencePatterns: [],
    avgSessionLength: 0,
    peakActivityHour: 9,
    taskComplexity: 'moderate',
    totalSessions: 0,
    totalInteractions: 0,
    lastEvolvedAt: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export function loadProfile(userId: string): DynamicUserProfile | null {
  ensureProfileTable()
  const row = sqlite.prepare('SELECT * FROM dynamic_user_profiles WHERE user_id = ?').get(userId) as any
  if (!row) return null
  return {
    userId: row.user_id,
    username: row.username,
    role: row.role,
    preferredStyle: row.preferred_style,
    preferredFormat: row.preferred_format,
    preferredLanguage: row.preferred_language,
    topTopics: JSON.parse(row.top_topics || '[]'),
    topicExpertise: JSON.parse(row.topic_expertise || '{}'),
    favoriteTools: JSON.parse(row.favorite_tools || '[]'),
    toolSequencePatterns: JSON.parse(row.tool_sequence_patterns || '[]'),
    avgSessionLength: row.avg_session_length || 0,
    peakActivityHour: row.peak_activity_hour || 9,
    taskComplexity: row.task_complexity || 'moderate',
    totalSessions: row.total_sessions || 0,
    totalInteractions: row.total_interactions || 0,
    lastEvolvedAt: row.last_evolved_at || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function saveProfile(p: DynamicUserProfile): void {
  ensureProfileTable()
  sqlite.prepare(`
    INSERT OR REPLACE INTO dynamic_user_profiles
    (user_id, username, role, preferred_style, preferred_format, preferred_language,
     top_topics, topic_expertise, favorite_tools, tool_sequence_patterns,
     avg_session_length, peak_activity_hour, task_complexity,
     total_sessions, total_interactions, last_evolved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    p.userId, p.username, p.role,
    p.preferredStyle, p.preferredFormat, p.preferredLanguage,
    JSON.stringify(p.topTopics), JSON.stringify(p.topicExpertise),
    JSON.stringify(p.favoriteTools), JSON.stringify(p.toolSequencePatterns),
    p.avgSessionLength, p.peakActivityHour, p.taskComplexity,
    p.totalSessions, p.totalInteractions, p.lastEvolvedAt,
    p.createdAt, p.updatedAt,
  )
}

// ─── 注入 system prompt ───────────────────────────────────

export function getProfileContext(userId: string): string {
  const p = loadProfile(userId)
  if (!p || p.totalInteractions < 3) return ''  // 至少3次交互后才注入

  const parts: string[] = []
  parts.push(`[用户档案] ${p.username} (${p.role})`)
  if (p.preferredStyle !== 'concise') parts.push(`偏好风格: ${p.preferredStyle}`)
  if (p.preferredFormat !== 'text') parts.push(`偏好格式: ${p.preferredFormat}`)
  if (p.topTopics.length > 0) parts.push(`关注领域: ${p.topTopics.slice(0, 5).join(', ')}`)
  if (p.favoriteTools.length > 0) parts.push(`常用工具: ${p.favoriteTools.slice(0, 5).join(', ')}`)
  parts.push(`总交互: ${p.totalInteractions}次 | 任务复杂度: ${p.taskComplexity}`)

  return parts.join('\n')
}

console.log('[ProfileEvolver] 动态用户档案进化引擎已就绪')
