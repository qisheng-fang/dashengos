// DaShengOS v8.8 — Sandbox Client
// JSON-RPC 2.0 over Unix socket to Go sandbox daemon
// Replaces host execSync with sandboxed command execution

import { connect } from 'node:net'
import { randomUUID } from 'node:crypto'

const SOCKET_PATH = '/tmp/dasheng/sandbox.sock'
const DEFAULT_TIMEOUT = 120_000 // 2 min

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params: Record<string, any>
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: { code: number; message: string }
}

interface ExecParams {
  command: string
  args?: string[]
  workdir?: string
  env?: string[]
  input?: string
  timeout_ms?: number
  memory_mb?: number
  cpu_percent?: number
}

interface ExecResult {
  exit_code: number
  stdout: string
  stderr: string
  duration_ms: number
  timed_out: boolean
  isolated: boolean
}

/**
 * Send a JSON-RPC call to the sandbox and await response.
 */
function sandboxCall(method: string, params: Record<string, any>, timeoutMs = DEFAULT_TIMEOUT): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    const req: JSONRPCRequest = { jsonrpc: '2.0', id, method, params }
    const payload = JSON.stringify(req) + '\n'

    const socket = connect(SOCKET_PATH)
    let buffer = ''
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      socket.destroy()
      reject(new Error(`Sandbox RPC timeout: ${method} (${timeoutMs}ms)`))
    }, timeoutMs)

    socket.on('connect', () => {
      socket.write(payload)
    })

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      // NDJSON: responses are newline-delimited
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg: JSONRPCResponse = JSON.parse(line)
          if (msg.id === id) {
            clearTimeout(timer)
            socket.destroy()
            if (msg.error) {
              reject(new Error(`Sandbox error: ${msg.error.message}`))
            } else {
              resolve(msg.result)
            }
            return
          }
        } catch { /* partial line, continue */ }
      }
    })

    socket.on('error', (err: Error) => {
      clearTimeout(timer)
      if (!timedOut) reject(new Error(`Sandbox connection failed: ${err.message}`))
    })

    socket.on('close', () => {
      clearTimeout(timer)
      if (!timedOut) reject(new Error('Sandbox connection closed prematurely'))
    })
  })
}

/**
 * Execute a shell command inside the sandbox.
 * Wraps the command with bash -c for shell feature support (pipes, redirects, etc.)
 */
export async function sandboxExec(
  shellCommand: string,
  opts?: { cwd?: string; timeout?: number; env?: Record<string, string>; input?: string }
): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number; isolated: boolean }> {
  try {
    const envList = opts?.env
      ? Object.entries(opts.env).map(([k, v]) => `${k}=${v}`)
      : undefined

    const result: ExecResult = await sandboxCall('sandbox.exec', {
      command: '/bin/bash',
      args: ['-c', shellCommand],
      workdir: opts?.cwd || process.cwd(),
      env: envList,
      input: opts?.input || '',
      timeout_ms: opts?.timeout || 120_000,
      memory_mb: 256,
      cpu_percent: 50,
    })

    return {
      success: result.exit_code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exit_code,
      isolated: result.isolated,
    }
  } catch (e: any) {
    // Sandbox unavailable — fallback message
    return {
      success: false,
      stdout: '',
      stderr: `Sandbox unavailable: ${e.message}. Is the sandbox daemon running? (screen -r dasheng-sandbox)`,
      exitCode: -1,
      isolated: false,
    }
  }
}

/**
 * Quick health check — is the sandbox reachable?
 */
export async function sandboxHealthCheck(): Promise<{ ok: boolean; version?: string; methods?: number }> {
  try {
    const result = await sandboxCall('health.ping', {}, 5000)
    return { ok: true, version: result.version, methods: result.methods }
  } catch {
    return { ok: false }
  }
}
