// DaShengOS Terminal Engine · bash pipe-based PTY
// macOS 兼容方案：spawn bash + pipe，实时流式输出

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

  const proc = spawn('bash', [], {
    cwd: cwd || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color', PS1: '$ ' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const session: TerminalSession = {
    id,
    proc,
    cwd: cwd || process.cwd(),
    createdAt: Date.now(),
    buffer: '',
  }

  proc.stdout?.on('data', (data: Buffer) => {
    const str = data.toString()
    session.buffer += str
    if (session.buffer.length > 500_000) session.buffer = session.buffer.slice(-200_000)
    terminalEvents.emit(`pty:${id}:data`, str)
  })

  proc.stderr?.on('data', (data: Buffer) => {
    terminalEvents.emit(`pty:${id}:data`, data.toString())
  })

  proc.on('error', (err) => {
    terminalEvents.emit(`pty:${id}:data`, `\r\n\x1b[31m[ERROR] ${err.message}\x1b[0m\r\n`)
  })

  proc.on('exit', (code) => {
    terminalEvents.emit(`pty:${id}:exit`, code ?? -1)
    setTimeout(() => { if (sessionPool.has(id)) destroySession(id) }, 30_000)
  })

  sessionPool.set(id, session)
  return session
}

export function writeToSession(sessionId: string, data: string): void {
  const session = sessionPool.get(sessionId)
  if (!session || !session.proc.stdin || session.proc.stdin.destroyed) return
  session.proc.stdin.write(data)
}

export function resizeSession(_sid: string, _cols: number, _rows: number): void {}

export function destroySession(sessionId: string): void {
  const session = sessionPool.get(sessionId)
  if (!session) return
  try { session.proc.kill('SIGTERM') } catch {}
  setTimeout(() => { try { if (!session.proc.killed) session.proc.kill('SIGKILL') } catch {} }, 3000)
  sessionPool.delete(sessionId)
  terminalEvents.emit(`pty:${sessionId}:closed`)
}

export function listSessions(): Array<{ id: string; cwd: string; age: number }> {
  const now = Date.now()
  return [...sessionPool.values()].map(s => ({ id: s.id, cwd: s.cwd, age: now - s.createdAt }))
}

export function execPTY(command: string, cwd: string, timeoutMs = 60_000): Promise<PTYExecResult> {
  const t0 = Date.now()
  return new Promise((resolve, reject) => {
    const proc = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })
    const timer = setTimeout(() => { try { proc.kill() } catch {}; reject(new Error('timeout')) }, timeoutMs)
    proc.on('exit', (code) => {
      clearTimeout(timer)
      resolve({
        sessionId: randomUUID(),
        exitCode: code ?? -1,
        output: output.trim(),
        durationMs: Date.now() - t0,
      })
    })
  })
}

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessionPool) {
    if (now - session.createdAt > IDLE_TIMEOUT) destroySession(id)
  }
}, 60_000)

export function shutdownAll(): void {
  for (const [id] of sessionPool) destroySession(id)
}
