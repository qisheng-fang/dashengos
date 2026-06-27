// DaShengOS v6.0 · PR Workflow
// 从 Cloud Runner 会话生成 PR: git branch → commit → push → create PR

import { execSync } from 'node:child_process'
import { getSession, getDiff } from './cloud-runner.js'

export interface PROptions {
  title: string
  description: string
  branch: string
  baseBranch?: string
}

export interface PRResult {
  success: boolean
  branch: string
  title: string
  url?: string         // GitHub PR URL
  diff: string
  files: string[]
  sessionId: string
}

export async function createPR(sessionId: string, options: PROptions): Promise<PRResult> {
  const session = getSession(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.status === 'cleaned') throw new Error('Session already cleaned')

  const workspace = session.workspace
  const branch = options.branch
  const baseBranch = options.baseBranch || 'main'

  // 1. Create branch
  try {
    execSync(`git checkout -b ${branch}`, { cwd: workspace, timeout: 10000, stdio: 'pipe' })
  } catch {
    // Branch may already exist
    execSync(`git checkout ${branch}`, { cwd: workspace, timeout: 10000, stdio: 'pipe' })
  }

  // 2. Get diff
  const { diff, files } = getDiff(sessionId)

  if (files.length === 0) {
    return {
      success: false,
      branch,
      title: options.title,
      diff: '',
      files: [],
      sessionId,
    }
  }

  // 3. Try GitHub CLI (gh) first, fallback to git
  let prUrl: string | undefined

  try {
    // Check if gh CLI is available
    execSync('which gh', { timeout: 5000, stdio: 'pipe' })

    // Create PR via gh CLI
    const body = `${options.description}\n\n---\n**DaShengOS Cloud Runner** | Session: \`${sessionId}\` | ${files.length} files changed`
    const result = execSync(
      `gh pr create --title "${options.title}" --body "${body}" --base ${baseBranch} --head ${branch}`,
      { cwd: workspace, timeout: 30000, encoding: 'utf-8' },
    )
    prUrl = result.trim()
    console.log(`[PR] Created: ${prUrl}`)
  } catch (e: any) {
    // gh CLI not available — generate instructions instead
    console.warn('[PR] gh CLI not found, generating manual PR instructions')
  }

  // 4. Mark session as PR-ready
  session.status = 'completed'

  return {
    success: !!prUrl,
    branch,
    title: options.title,
    url: prUrl,
    diff: diff.slice(0, 10000),
    files,
    sessionId,
  }
}

/**
 * Generate PR description from session data.
 */
export function generatePRDescription(sessionId: string): string {
  const session = getSession(sessionId)
  if (!session) return ''

  const lines = [
    '## DaShengOS Cloud Runner — Automated Changes',
    '',
    `**Session**: \`${sessionId}\``,
    `**Created**: ${new Date(session.createdAt).toISOString()}`,
    '',
    '### Commands Executed',
    ...session.commands.map((c, i) => {
      const status = c.status === 'completed' ? '✅' : c.status === 'failed' ? '❌' : '⏳'
      return `${i + 1}. ${status} \`${c.toolId}\` (${c.networkPolicy}, ${c.result?.durationMs || 0}ms)`
    }),
    '',
    '### Patches Applied',
    ...session.patches.map((p, i) => `${i + 1}. \`${p.path}\` — ${p.reason || 'no reason'}`),
    '',
    '### Files Changed',
  ]

  const { files } = getDiff(sessionId)
  files.forEach(f => lines.push(`- \`${f}\``))

  return lines.join('\n')
}
