// DaShengOS v6.0 · Cloud Runner
// 蓝图 §3-5: 远程沙箱执行 — 独立 workspace + 命令执行 + diff 返回
// MVP: 本地模拟（临时目录隔离），后续接入真实云端

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { sqlite } from '../storage/db.js'

// ─── Types ────────────────────────────────────────────────

export interface CloudSession {
  id: string
  workspace: string           // 隔离工作区路径
  gitRemote?: string          // 原始 git remote (可选)
  baseBranch?: string         // 基准分支
  status: 'created' | 'running' | 'completed' | 'failed' | 'cleaned'
  createdAt: number
  expiresAt: number           // TTL 后自动清理
  commands: CloudCommand[]
  patches: CloudPatch[]
}

export interface CloudCommand {
  id: string
  toolId: string
  params: Record<string, any>
  networkPolicy: 'blocked' | 'whitelist'
  allowedDomains: string[]
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: CloudCommandResult
  createdAt: number
}

export interface CloudCommandResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface CloudPatch {
  path: string
  content: string
  reason: string
}

export interface CloudSessionResult {
  sessionId: string
  status: string
  commands: CloudCommand[]
  diff?: string              // git diff output
  modifiedFiles: string[]
  durationMs: number
}

// ─── Session Store (in-memory + DB) ───────────────────────

const WORKSPACE_ROOT = resolve(process.cwd(), '../../.cloud-workspaces')
const SESSION_TTL_MS = 30 * 60 * 1000  // 30 minutes
const CMD_TIMEOUT_MS = 120_000          // 2 minutes per command

const activeSessions = new Map<string, CloudSession>()

// ─── Session Lifecycle ────────────────────────────────────

export function createSession(options: {
  gitRemote?: string
  baseBranch?: string
  localWorkspace?: string   // 复制本地工作区到隔离环境
}): CloudSession {
  const id = `cloud_${Date.now()}_${randomUUID().slice(0, 8)}`
  const workspace = join(WORKSPACE_ROOT, id)

  if (!existsSync(WORKSPACE_ROOT)) mkdirSync(WORKSPACE_ROOT, { recursive: true })
  mkdirSync(workspace, { recursive: true })

  // Initialize git repo in workspace
  try {
    execSync('git init', { cwd: workspace, timeout: 5000, stdio: 'pipe' })
    execSync('git config user.email "cloud-runner@dashengos.dev"', { cwd: workspace, timeout: 3000 })
    execSync('git config user.name "DaShengOS Cloud Runner"', { cwd: workspace, timeout: 3000 })
  } catch (e: any) {
    console.error('[CloudRunner] git init failed:', e.message)
  }

  // Clone from remote or copy from local
  if (options.gitRemote) {
    try {
      execSync(`git clone --depth 1 ${options.gitRemote} .`, { cwd: workspace, timeout: 60000, stdio: 'pipe' })
    } catch (e: any) {
      console.error('[CloudRunner] git clone failed:', e.message)
    }
  } else if (options.localWorkspace && existsSync(options.localWorkspace)) {
    // Copy workspace files (excluding node_modules, .git, dist)
    copyDirSafe(options.localWorkspace, workspace)
  }

  // Initial commit
  try {
    execSync('git add -A && git commit -m "initial workspace"', { cwd: workspace, timeout: 10000, stdio: 'pipe' })
  } catch { /* may already be empty */ }

  const session: CloudSession = {
    id,
    workspace,
    gitRemote: options.gitRemote,
    baseBranch: options.baseBranch || 'main',
    status: 'created',
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    commands: [],
    patches: [],
  }

  activeSessions.set(id, session)

  // Persist to DB
  try {
    sqlite.prepare(`
      INSERT INTO cloud_sessions (id, workspace, git_remote, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, workspace, options.gitRemote || null, 'created', session.createdAt, session.expiresAt)
  } catch { /* table may not exist yet */ }

  console.log(`[CloudRunner] Session ${id} created at ${workspace}`)
  return session
}

// ─── Command Execution ────────────────────────────────────

export async function executeCommand(
  sessionId: string,
  toolId: string,
  params: Record<string, any>,
  networkPolicy: 'blocked' | 'whitelist' = 'blocked',
  allowedDomains: string[] = [],
): Promise<CloudCommand> {
  const session = activeSessions.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)
  if (session.status === 'cleaned') throw new Error('Session already cleaned')

  const cmdId = `cmd_${Date.now()}_${randomUUID().slice(0, 6)}`
  const command: CloudCommand = {
    id: cmdId,
    toolId,
    params,
    networkPolicy,
    allowedDomains,
    status: 'running',
    createdAt: Date.now(),
  }

  session.commands.push(command)
  session.status = 'running'

  const start = Date.now()

  try {
    const commandStr = params.command || 'sh'
    const args = params.args || []
    const env = params.env || []
    const input = params.input || ''
    const timeoutMs = params.timeout_ms || CMD_TIMEOUT_MS

    // Apply network policy
    const effectiveEnv = [...env]
    if (networkPolicy === 'blocked') {
      effectiveEnv.push('http_proxy=', 'https_proxy=', 'HTTP_PROXY=', 'HTTPS_PROXY=', 'no_proxy=*')
    }

    const result = await runCommand(commandStr, args, {
      cwd: session.workspace,
      env: effectiveEnv,
      input,
      timeout: timeoutMs,
    })

    command.result = result
    command.status = result.timedOut ? 'failed' : (result.exitCode === 0 ? 'completed' : 'failed')
  } catch (e: any) {
    command.result = {
      exitCode: -1,
      stdout: '',
      stderr: e.message,
      durationMs: Date.now() - start,
      timedOut: false,
    }
    command.status = 'failed'
  }

  // Auto-commit after command execution
  try {
    execSync('git add -A && git commit -m "cloud-runner: command execution"', {
      cwd: session.workspace, timeout: 5000, stdio: 'pipe',
    })
  } catch { /* ok */ }

  return command
}

// ─── Apply Patch ──────────────────────────────────────────

export function applyPatch(sessionId: string, path: string, content: string, reason: string = ''): CloudPatch {
  const session = activeSessions.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  const fullPath = join(session.workspace, path)
  const dir = join(fullPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  writeFileSync(fullPath, content, 'utf-8')

  const patch: CloudPatch = { path, content, reason }
  session.patches.push(patch)

  // Auto-commit
  try {
    execSync(`git add "${path}" && git commit -m "cloud-runner: patch ${path}${reason ? ` (${reason})` : ''}"`, {
      cwd: session.workspace, timeout: 5000, stdio: 'pipe',
    })
  } catch { /* ok */ }

  return patch
}

// ─── Get Diff ─────────────────────────────────────────────

export function getDiff(sessionId: string): { diff: string; files: string[] } {
  const session = activeSessions.get(sessionId)
  if (!session) throw new Error(`Session not found: ${sessionId}`)

  try {
    const diff = execSync('git diff HEAD~1..HEAD -- . 2>/dev/null || git diff --cached -- . 2>/dev/null || echo empty', {
      cwd: session.workspace, timeout: 10000, encoding: 'utf-8',
    })
    const files = execSync('git diff --name-only HEAD~1..HEAD', {
      cwd: session.workspace, timeout: 5000, encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean)

    return { diff, files }
  } catch {
    return { diff: '', files: [] }
  }
}

// ─── Cleanup ──────────────────────────────────────────────

export function cleanupSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId)
  if (!session) return false

  try {
    if (existsSync(session.workspace)) {
      rmSync(session.workspace, { recursive: true, force: true })
    }
  } catch (e: any) {
    console.error(`[CloudRunner] Cleanup failed for ${sessionId}:`, e.message)
  }

  session.status = 'cleaned'
  activeSessions.delete(sessionId)

  try {
    sqlite.prepare(`UPDATE cloud_sessions SET status = 'cleaned' WHERE id = ?`).run(sessionId)
  } catch { /* ok */ }

  console.log(`[CloudRunner] Session ${sessionId} cleaned`)
  return true
}

// ─── List Sessions ────────────────────────────────────────

export function listSessions(): CloudSession[] {
  return Array.from(activeSessions.values())
}

export function getSession(sessionId: string): CloudSession | undefined {
  return activeSessions.get(sessionId)
}

// ─── Auto-cleanup expired sessions ────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null


// ─── Restore sessions on startup ─────────────────────────

export function restoreSessionsFromDB(): number {
  try {
    const rows = sqlite.prepare(
      "SELECT id, workspace, git_remote, status, created_at, expires_at FROM cloud_sessions WHERE status != 'cleaned' AND expires_at > ?"
    ).all(Date.now()) as any[]

    let restored = 0
    for (const row of rows) {
      if (activeSessions.has(row.id)) continue
      const session: CloudSession = {
        id: row.id,
        workspace: row.workspace,
        gitRemote: row.git_remote,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        commands: [],
        patches: [],
      }
      activeSessions.set(row.id, session)
      restored++
    }
    if (restored > 0) console.log(`[CloudRunner] Restored ${restored} sessions from DB`)
    return restored
  } catch {
    return 0
  }
}

export function startCloudCleanup(): void {
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, session] of activeSessions) {
      if (now > session.expiresAt) {
        console.log(`[CloudRunner] Auto-cleaning expired session: ${id}`)
        cleanupSession(id)
      }
    }
  }, 5 * 60 * 1000) // every 5 minutes

  console.log('[CloudRunner] Auto-cleanup started (interval: 5min, TTL: 30min)')
}

export function stopCloudCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }
}

// ─── Helpers ──────────────────────────────────────────────

function runCommand(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: string[]; input: string; timeout: number },
): Promise<CloudCommandResult> {
  return new Promise((resolve) => {
    const start = Date.now()
    let stdout = ''
    let stderr = ''

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...Object.fromEntries(opts.env.map(e => {
        const idx = e.indexOf('=')
        return idx > 0 ? [e.slice(0, idx), e.slice(idx + 1)] : [e, '']
      })) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + '\n[TIMEOUT]',
        durationMs: Date.now() - start,
        timedOut: true,
      })
    }, opts.timeout)

    if (opts.input) {
      child.stdin?.write(opts.input)
      child.stdin?.end()
    }

    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        exitCode: code ?? -1,
        stdout: stdout.slice(0, 50000),  // 50KB max
        stderr: stderr.slice(0, 50000),
        durationMs: Date.now() - start,
        timedOut: false,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        exitCode: -1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - start,
        timedOut: false,
      })
    })
  })
}

function copyDirSafe(src: string, dest: string): void {
  const excludes = ['node_modules', '.git', 'dist', '.next', 'build', '__pycache__', '.venv', '.env', '.DS_Store']

  try {
    const entries = require('fs').readdirSync(src, { withFileTypes: true })
    for (const entry of entries) {
      if (excludes.includes(entry.name)) continue
      const srcPath = join(src, entry.name)
      const destPath = join(dest, entry.name)
      if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true })
        copyDirSafe(srcPath, destPath)
      } else {
        cpSync(srcPath, destPath)
      }
    }
  } catch (e: any) {
    console.error('[CloudRunner] copyDirSafe error:', e.message)
  }
}
