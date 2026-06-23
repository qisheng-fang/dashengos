// DaShengOS Terminal Engine · 流式命令执行引擎
// 使用 child_process.spawn 实现实时流式输出
// node-pty 在 macOS 上存在 posix_spawnp 兼容问题，用 spawn + pipe 替代

import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'

export interface TerminalSession {
  id: string
  proc: ChildProcess
  cwd: string
  createdAt: number
  buffer: string
}

export interface PTYExecResult {
  sessionId: string
  exitCode: number
  output: string
  durationMs: number
}

const sessionPool = new Map<string, TerminalSession>()
const MAX_SESSIONS = 12
const IDLE_TIMEOUT = 300_000

export const terminalEvents = new EventEmitter()
terminalEvents.setMaxListeners(100)

export function createSession(cwd: string): TerminalSession {
  if (sessionPool.size >= MAX_SESSIONS) {
    const oldest = [...sessionPool.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0]
    if (oldest) destroySession(oldest[0])
  }

  const id = randomUUID()
  const shell = process.env.SHELL || '/bin/zsh'
  
  const proc = spawn(shell, ['-i'], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: TerminalSession = {
    id,
    proc,
    cwd: cwd || process.cwd(),
    createdAt: Date.now(),
    buffer: '',
  }

  if (proc.stdout) {
    proc.stdout.on('data', (data: Buffer) => {
      const str = data.toString()
      session.buffer += str
      if (session.buffer.length > 500_000) {
        session.buffer = session.buffer.slice(-200_000)
      }
      terminalEvents.emit(`pty:${id}`, str)
      terminalEvents.emit(`pty:${id}:data`, str)
    })
  }

  if (proc.stderr) {
    proc.stderr.on('data', (data: Buffer) => {
      const str = data.toString()
      session.buffer += str
      terminalEvents.emit(`pty:${id}`, str)
      terminalEvents.emit(`pty:${id}:data`, str)
    })
  }

  proc.on('error', (err) => {
    terminalEvents.emit(`pty:${id}:data`, `\x1b[31m[ERROR] ${err.message}\x1b[0m\n`)
  })

  proc.on('exit', (code) => {
    terminalEvents.emit(`pty:${id}:exit`, code ?? -1)
    setTimeout(() => {
      if (sessionPool.has(id)) destroySession(id)
    }, 30_000)
  })

  sessionPool.set(id, session)
  return session
}

export function writeToSession(sessionId: string, data: string): void {
  const session = sessionPool.get(sessionId)
  if (!session) throw new Error(`Session ${sessionId} not found`)
  if (session.proc.stdin && !session.proc.stdin.destroyed) {
    session.proc.stdin.write(data)
  }
}

export function resizeSession(_sessionId: string, _cols: number, _rows: number): void {
  // spawn 模式不支持 resize，保留接口兼容
}

export function getSession(sessionId: string): TerminalSession | undefined {
  return sessionPool.get(sessionId)
}

export function destroySession(sessionId: string): void {
  const session = sessionPool.get(sessionId)
  if (!session) return
  try { session.proc.kill('SIGTERM') } catch {}
  setTimeout(() => {
    try { if (!session.proc.killed) session.proc.kill('SIGKILL') } catch {}
  }, 3000)
  sessionPool.delete(sessionId)
  terminalEvents.emit(`pty:${sessionId}:closed`)
}

export function listSessions(): Array<{ id: string; cwd: string; age: number }> {
  const now = Date.now()
  return [...sessionPool.values()].map(s => ({
    id: s.id,
    cwd: s.cwd,
    age: now - s.createdAt,
  }))
}

// ─── 便捷: 执行单条命令并等待结果 ───

export function execPTY(command: string, cwd: string, timeoutMs = 60_000): Promise<PTYExecResult> {
  const t0 = Date.now()
  
  return new Promise((resolve, reject) => {
    const proc = spawn(command, [], {
      cwd,
      shell: true,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    if (proc.stdout) {
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    }
    if (proc.stderr) {
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    }

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      reject(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    proc.on('exit', (code) => {
      clearTimeout(timer)
      const output = stdout + (stderr ? '\n[STDERR]\n' + stderr : '')
      const clean = output
        .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
        .replace(/\r/g, '')
        .trim()

      resolve({
        sessionId: randomUUID(),
        exitCode: code ?? -1,
        output: clean,
        durationMs: Date.now() - t0,
      })
    })
  })
}

// 空闲会话清理
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessionPool) {
    if (now - session.createdAt > IDLE_TIMEOUT) {
      destroySession(id)
    }
  }
}, 60_000)

export function shutdownAll(): void {
  for (const [id] of sessionPool) {
    destroySession(id)
  }
}
