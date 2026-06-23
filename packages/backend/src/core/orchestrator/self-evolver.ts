// self-evolver.ts — DaShengOS v7.0 自进化引擎
// 任务后反思 → 模式提取 → 自动创建技能 → 技能优化 → 使用排名
// 存储: ~/.dasheng/evolution.json

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

const HOME = process.env.HOME || '/Users/apple'
const EVOLVE_DIR = join(HOME, '.dasheng')
const EVOLVE_FILE = join(EVOLVE_DIR, 'evolution.json')
const SKILLS_DIR = join(HOME, '.workbuddy', 'skills')

// ─── Types ─────────────────────────────────────────────

export interface TaskRecord {
  id: string
  task: string
  intent: string
  toolsUsed: string[]
  agentUsed: string
  success: boolean
  qualityScore: number
  durationMs: number
  timestamp: number
  summary: string
}

export interface PatternRecord {
  id: string
  pattern: string          // e.g. "行业报告+HTML+web_search+trend-researcher"
  taskType: string
  tools: string[]
  agent: string
  frequency: number
  successRate: number
  avgQuality: number
  lastUsed: number
  createdAt: number
  promotedToSkill: boolean
}

export interface ToolStats {
  uses: number
  successes: number
  avgQuality: number
  lastUsed: number
  bestFor: string[]
}

interface EvolutionDB {
  version: number
  taskHistory: TaskRecord[]
  patterns: PatternRecord[]
  toolStats: Record<string, ToolStats>
  agentStats: Record<string, ToolStats>
  skillStats: Record<string, ToolStats>
  createdSkills: string[]
  lastEvolveCheck: number
  totalTasks: number
  totalSuccesses: number
}

// ─── DB operations ─────────────────────────────────────

function loadDB(): EvolutionDB {
  if (!existsSync(EVOLVE_DIR)) mkdirSync(EVOLVE_DIR, { recursive: true })
  if (!existsSync(EVOLVE_FILE)) {
    const empty: EvolutionDB = {
      version: 1,
      taskHistory: [], patterns: [],
      toolStats: {}, agentStats: {}, skillStats: {},
      createdSkills: [], lastEvolveCheck: Date.now(),
      totalTasks: 0, totalSuccesses: 0,
    }
    saveDB(empty)
    console.log('[Evolver] 进化数据库已初始化')
    return empty
  }
  try {
    return JSON.parse(readFileSync(EVOLVE_FILE, 'utf-8'))
  } catch {
    console.warn('[Evolver] 数据库损坏，重建中...')
    const empty: EvolutionDB = {
      version: 1,
      taskHistory: [], patterns: [],
      toolStats: {}, agentStats: {}, skillStats: {},
      createdSkills: [], lastEvolveCheck: Date.now(),
      totalTasks: 0, totalSuccesses: 0,
    }
    saveDB(empty)
    return empty
  }
}

function saveDB(db: EvolutionDB) {
  if (!existsSync(EVOLVE_DIR)) mkdirSync(EVOLVE_DIR, { recursive: true })
  writeFileSync(EVOLVE_FILE, JSON.stringify(db, null, 2), 'utf-8')
}

// ─── Record task ───────────────────────────────────────

export function recordTask(opts: {
  task: string
  intent: string
  toolsUsed: string[]
  agentUsed: string
  success: boolean
  qualityScore: number
  durationMs: number
  summary?: string
}): void {
  const db = loadDB()
  const record: TaskRecord = {
    id: randomUUID().slice(0, 8),
    task: opts.task,
    intent: opts.intent,
    toolsUsed: opts.toolsUsed,
    agentUsed: opts.agentUsed,
    success: opts.success,
    qualityScore: opts.qualityScore,
    durationMs: opts.durationMs,
    timestamp: Date.now(),
    summary: opts.summary || opts.task.slice(0, 100),
  }

  db.taskHistory.push(record)
  db.totalTasks++

  // Trim history — keep last 500 tasks
  if (db.taskHistory.length > 500) {
    db.taskHistory = db.taskHistory.slice(-500)
  }

  // Update tool stats
  for (const tool of opts.toolsUsed) {
    if (!db.toolStats[tool]) {
      db.toolStats[tool] = { uses: 0, successes: 0, avgQuality: 0, lastUsed: 0, bestFor: [] }
    }
    const ts = db.toolStats[tool]
    ts.uses++
    if (opts.success) ts.successes++
    ts.avgQuality = (ts.avgQuality * (ts.uses - 1) + opts.qualityScore) / ts.uses
    ts.lastUsed = Date.now()
  }

  // Update agent stats
  if (opts.agentUsed) {
    if (!db.agentStats[opts.agentUsed]) {
      db.agentStats[opts.agentUsed] = { uses: 0, successes: 0, avgQuality: 0, lastUsed: 0, bestFor: [] }
    }
    const as = db.agentStats[opts.agentUsed]
    as.uses++
    if (opts.success) as.successes++
    as.avgQuality = (as.avgQuality * (as.uses - 1) + opts.qualityScore) / as.uses
    as.lastUsed = Date.now()
  }

  if (opts.success) db.totalSuccesses++
  saveDB(db)
  console.log(`[Evolver] 任务记录: ${opts.intent} | ${opts.success ? '✅' : '❌'} | 质量:${opts.qualityScore} | 工具:${opts.toolsUsed.join(',')}`)
}

// ─── Pattern extraction ────────────────────────────────

export function extractPatterns(): PatternRecord[] {
  const db = loadDB()
  const recent = db.taskHistory.slice(-100).filter(t => t.success && t.qualityScore >= 60)
  if (recent.length < 2) return db.patterns

  // Group by (intent + tools + agent) signature
  const groups = new Map<string, TaskRecord[]>()
  for (const task of recent) {
    const sig = `${task.intent}|${task.toolsUsed.sort().join(',')}|${task.agentUsed}`
    if (!groups.has(sig)) groups.set(sig, [])
    groups.get(sig)!.push(task)
  }

  // Promote groups with 3+ occurrences to patterns
  for (const [sig, tasks] of groups) {
    if (tasks.length < 3) continue
    const existing = db.patterns.find(p => p.pattern === sig)
    if (existing) {
      existing.frequency = tasks.length
      existing.successRate = tasks.filter(t => t.success).length / tasks.length
      existing.avgQuality = tasks.reduce((s, t) => s + t.qualityScore, 0) / tasks.length
      existing.lastUsed = Math.max(...tasks.map(t => t.timestamp))
    } else {
      const [intent, toolsStr, agent] = sig.split('|')
      const pattern: PatternRecord = {
        id: randomUUID().slice(0, 8),
        pattern: sig,
        taskType: intent,
        tools: toolsStr ? toolsStr.split(',') : [],
        agent: agent || '',
        frequency: tasks.length,
        successRate: tasks.filter(t => t.success).length / tasks.length,
        avgQuality: tasks.reduce((s, t) => s + t.qualityScore, 0) / tasks.length,
        lastUsed: Math.max(...tasks.map(t => t.timestamp)),
        createdAt: Math.min(...tasks.map(t => t.timestamp)),
        promotedToSkill: false,
      }
      db.patterns.push(pattern)
      console.log(`[Evolver] 发现新模式: ${intent} → ${agent || 'general'} [${toolsStr}] (${tasks.length}次, ${pattern.successRate.toFixed(0)}% 成功率)`)
    }
  }

  // Trim patterns — keep top 50 by frequency
  db.patterns.sort((a, b) => b.frequency - a.frequency)
  if (db.patterns.length > 50) db.patterns = db.patterns.slice(0, 50)

  saveDB(db)
  return db.patterns
}

// ─── Auto-skill creation ───────────────────────────────

export function autoCreateSkills(): string[] {
  const db = loadDB()
  const newSkills: string[] = []

  for (const pattern of db.patterns) {
    // Conditions for auto-skill creation:
    // 1. Used 5+ times
    // 2. Success rate > 70%
    // 3. Average quality > 70
    // 4. Not already promoted
    if (pattern.frequency < 5) continue
    if (pattern.successRate < 0.7) continue
    if (pattern.avgQuality < 70) continue
    if (pattern.promotedToSkill) continue
    if (db.createdSkills.includes(pattern.pattern)) continue

    const skillName = `auto-${pattern.taskType.toLowerCase()}-${pattern.agent.split('/').pop() || 'general'}`
      .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 50)

    // Find best example task for this pattern
    const bestTask = db.taskHistory
      .filter(t => {
        const sig = `${t.intent}|${t.toolsUsed.sort().join(',')}|${t.agentUsed}`
        return sig === pattern.pattern && t.success
      })
      .sort((a, b) => b.qualityScore - a.qualityScore)[0]

    const skillContent = `---
name: ${pattern.taskType} Auto-Skill
description: Auto-generated from ${pattern.frequency} successful executions. ${pattern.taskType} tasks using ${pattern.agent || 'general'} agent.
version: 1.0.0
category: auto-generated
risk_level: low
auto_created: true
pattern_id: ${pattern.id}
---

# ${pattern.taskType} — 自动进化技能

## 触发条件
当用户请求涉及 "${pattern.taskType}" 类型的任务时自动加载。

## 推荐工具链
${pattern.tools.map(t => `- ${t}`).join('\n')}

## 推荐 Agent
${pattern.agent || '通用 Agent'}

## 成功率
${(pattern.successRate * 100).toFixed(0)}% (基于 ${pattern.frequency} 次执行)

## 最佳实践
${bestTask ? `参考任务: "${bestTask.summary}"\n质量评分: ${bestTask.qualityScore}/100` : ''}

## 进化历史
- 首次发现: ${new Date(pattern.createdAt).toISOString()}
- 最后使用: ${new Date(pattern.lastUsed).toISOString()}
- 自动创建: ${new Date().toISOString()}
`

    try {
      const skillDir = join(SKILLS_DIR, skillName)
      if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true })
      writeFileSync(join(skillDir, 'SKILL.md'), skillContent, 'utf-8')
      
      pattern.promotedToSkill = true
      db.createdSkills.push(skillName)
      if (!db.skillStats[skillName]) {
        db.skillStats[skillName] = { uses: 0, successes: 0, avgQuality: 0, lastUsed: 0, bestFor: [pattern.taskType] }
      }
      
      newSkills.push(skillName)
      console.log(`[Evolver] 🧬 自动创建技能: ${skillName} (${pattern.taskType}, ${pattern.frequency}次成功)`)
    } catch (e: any) {
      console.warn(`[Evolver] 创建技能失败: ${skillName} — ${e.message}`)
    }
  }

  if (newSkills.length > 0) {
    saveDB(db)
  }
  return newSkills
}

// ─── Skill optimization ────────────────────────────────

export function optimizeSkills(): string[] {
  const db = loadDB()
  const optimized: string[] = []

  for (const skillName of db.createdSkills) {
    const stats = db.skillStats[skillName]
    if (!stats || stats.uses < 3) continue

    const skillDir = join(SKILLS_DIR, skillName)
    const skillFile = join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) continue

    try {
      let content = readFileSync(skillFile, 'utf-8')

      // Check if quality is declining → needs optimization
      const recentUses = db.taskHistory
        .filter(t => t.toolsUsed.includes(skillName) || t.agentUsed.includes(skillName))
        .slice(-10)
      
      if (recentUses.length < 3) continue
      
      const recentQuality = recentUses.reduce((s, t) => s + t.qualityScore, 0) / recentUses.length
      const olderQuality = stats.avgQuality

      // If quality dropped > 10 points, add an optimization note
      if (recentQuality < olderQuality - 10) {
        const note = `\n## ⚠️ 优化建议 (自动生成 ${new Date().toISOString()})\n最近 ${recentUses.length} 次平均质量: ${recentQuality.toFixed(0)}/100 (下降 ${(olderQuality - recentQuality).toFixed(0)} 点)\n考虑: 更新工具链或调整 Agent 策略。\n`
        if (!content.includes('优化建议')) {
          content += note
          writeFileSync(skillFile, content, 'utf-8')
          optimized.push(skillName)
          console.log(`[Evolver] 🔧 优化技能: ${skillName} (质量 ${olderQuality.toFixed(0)}→${recentQuality.toFixed(0)})`)
        }
      }

      // Update version if quality improved significantly
      if (recentQuality > olderQuality + 10 && recentUses.length >= 5) {
        const versionMatch = content.match(/version:\s*(\d+\.\d+\.\d+)/)
        if (versionMatch) {
          const [major, minor, patch] = versionMatch[1].split('.').map(Number)
          const newVersion = `${major}.${minor}.${patch + 1}`
          content = content.replace(/version:\s*\d+\.\d+\.\d+/, `version: ${newVersion}`)
          writeFileSync(skillFile, content, 'utf-8')
          optimized.push(skillName)
          console.log(`[Evolver] ⬆️ 升级技能: ${skillName} v${versionMatch[1]} → v${newVersion} (质量 +${(recentQuality - olderQuality).toFixed(0)})`)
        }
      }
    } catch (e: any) {
      console.warn(`[Evolver] 优化技能失败: ${skillName} — ${e.message}`)
    }
  }

  if (optimized.length > 0) saveDB(db)
  return optimized
}

// ─── Usage ranking for ToolMatcher ─────────────────────

export function getToolRankings(): {
  tools: Array<{ name: string; uses: number; successRate: number; avgQuality: number }>
  agents: Array<{ name: string; uses: number; successRate: number; avgQuality: number }>
  skills: Array<{ name: string; uses: number; successRate: number; avgQuality: number }>
} {
  const db = loadDB()
  
  const rank = (stats: Record<string, ToolStats>) =>
    Object.entries(stats)
      .map(([name, s]) => ({
        name,
        uses: s.uses,
        successRate: s.uses > 0 ? s.successes / s.uses : 0,
        avgQuality: s.avgQuality,
      }))
      .sort((a, b) => b.uses - a.uses)

  return {
    tools: rank(db.toolStats),
    agents: rank(db.agentStats),
    skills: rank(db.skillStats),
  }
}

// ─── Evolution health report ───────────────────────────

export function getEvolutionReport(): string {
  const db = loadDB()
  const rankings = getToolRankings()
  const topTools = rankings.tools.slice(0, 5).map(t => `${t.name}(${t.uses}次,${(t.successRate*100).toFixed(0)}%)`)
  const topAgents = rankings.agents.slice(0, 3).map(a => `${a.name}(${a.uses}次)`)

  return [
    `## 🧬 DaShengOS 自进化报告`,
    ``,
    `- 总任务: ${db.totalTasks} | 成功: ${db.totalSuccesses} | 成功率: ${db.totalTasks > 0 ? (db.totalSuccesses/db.totalTasks*100).toFixed(0) : 0}%`,
    `- 发现模式: ${db.patterns.length} | 自动创建技能: ${db.createdSkills.length}`,
    `- 热门工具: ${topTools.join(', ') || '暂无'}`,
    `- 热门 Agent: ${topAgents.join(', ') || '暂无'}`,
    `- 最后进化: ${new Date(db.lastEvolveCheck).toLocaleString()}`,
  ].join('\n')
}

// ─── Periodic evolution check ──────────────────────────

export function shouldEvolve(): boolean {
  const db = loadDB()
  const hoursSinceLastCheck = (Date.now() - db.lastEvolveCheck) / 3600000
  // Check every 6 hours or every 50 tasks
  return hoursSinceLastCheck >= 6 || db.taskHistory.length % 50 === 0
}

export function markEvolved() {
  const db = loadDB()
  db.lastEvolveCheck = Date.now()
  saveDB(db)
}

// ─── Initialize ────────────────────────────────────────
// Load DB on import to ensure it exists
const _init = loadDB()
console.log(`[Evolver] 自进化引擎就绪 — ${_init.totalTasks} 任务, ${_init.patterns.length} 模式, ${_init.createdSkills.length} 技能`)
