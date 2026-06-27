// AGENTS.md Enforcer — 读取 AGENTS.md 并注入约束到系统提示词
// 确保 DaShengOS 遵守端口管理、进程管理、端点契约等硬约束

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const WORKSPACE = '/Users/apple/Desktop/ai-workbench-v2'

interface AgentsConstraint {
  section: string
  priority: 'critical' | 'high' | 'medium'
  rules: string[]
}

let _cachedConstraints: AgentsConstraint[] | null = null

export function loadAgentsConstraints(): AgentsConstraint[] {
  if (_cachedConstraints) return _cachedConstraints

  const constraints: AgentsConstraint[] = []
  const agentsPath = resolve(WORKSPACE, 'AGENTS.md')

  if (!existsSync(agentsPath)) {
    console.warn('[AGENTS-MD] AGENTS.md not found, skipping constraint injection')
    _cachedConstraints = constraints
    return constraints
  }

  try {
    const content = readFileSync(agentsPath, 'utf-8')
    const lines = content.split('\n')
    let currentSection = ''
    let currentPriority: 'critical' | 'high' | 'medium' = 'medium'
    let currentRules: string[] = []

    for (const line of lines) {
      // Section headers
      const hMatch = line.match(/^## (\d+)\. (.+)/)
      if (hMatch) {
        // Save previous section
        if (currentRules.length > 0) {
          constraints.push({
            section: currentSection,
            priority: currentPriority,
            rules: [...currentRules],
          })
        }
        currentSection = hMatch[2]
        currentPriority = line.includes('🔴') ? 'critical' : line.includes('🟡') ? 'high' : 'medium'
        currentRules = []
        continue
      }

      // Priority indicators
      if (line.includes('最高优先级')) currentPriority = 'critical'

      // Collect rules (bullet points, numbered items, code blocks)
      const trimmed = line.trim()
      if (trimmed.startsWith('-') || trimmed.startsWith('|') || trimmed.startsWith('❌') || trimmed.startsWith('✅')) {
        currentRules.push(trimmed.replace(/^[-|]\s*/, ''))
      }
      if (trimmed.match(/^\d+[a-z]?\.?\s/)) {
        currentRules.push(trimmed)
      }
    }

    // Save last section
    if (currentRules.length > 0) {
      constraints.push({
        section: currentSection,
        priority: currentPriority,
        rules: [...currentRules],
      })
    }
  } catch (e: any) {
    console.warn('[AGENTS-MD] Failed to parse:', e.message)
  }

  _cachedConstraints = constraints
  return constraints
}

/**
 * Build AGENTS.md constraint injection for system prompt.
 * Only injects critical and high priority constraints.
 */
export function buildAgentsMDInjection(): string {
  const constraints = loadAgentsConstraints()
  if (constraints.length === 0) return ''

  const critical = constraints.filter(c => c.priority === 'critical')
  const high = constraints.filter(c => c.priority === 'high')

  const lines: string[] = []
  lines.push('=== SECTION 10: AGENTS.md HARD CONSTRAINTS (MUST OBEY) ===')
  lines.push('')
  lines.push('The following are HARD CONSTRAINTS from AGENTS.md. VIOLATION = SYSTEM FAILURE.')
  lines.push('')

  if (critical.length > 0) {
    lines.push('🔴 CRITICAL:')
    for (const c of critical) {
      lines.push(`  ${c.section}:`)
      for (const r of c.rules.slice(0, 5)) {
        lines.push(`    - ${r}`)
      }
    }
  }

  if (high.length > 0) {
    lines.push('')
    lines.push('🟡 HIGH:')
    for (const c of high) {
      lines.push(`  ${c.section}:`)
      for (const r of c.rules.slice(0, 3)) {
        lines.push(`    - ${r}`)
      }
    }
  }

  return lines.join('\n')
}

/** Reload constraints (e.g. after AGENTS.md changes) */
export function reloadAgentsConstraints(): void {
  _cachedConstraints = null
  loadAgentsConstraints()
}
