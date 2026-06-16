// apps/web/src/lib/sandbox-client.ts · v0.3 Phase 4 前端接入
//
// Browser-friendly HTTP client for the Go sandbox daemon.
//
// Architecture:
//   Browser → fetch → /api/sandbox/{method} (sandbox-exporter HTTP)
//                                       OR
//            → /api/v1/sandbox/{method} (Fastify backend proxy, recommended for prod)
//
// In dev, point this at the sandbox-exporter :9100 directly.
// In prod, the Fastify backend should expose /api/v1/sandbox/{method}
// that proxies to the daemon (authn, audit, rate-limit in one place).
//
// Phase B.3 (2026-06-16): JWT 强制 — token 必填, 默认 client 从 auth-store 读, 永远发 Authorization 头

import type {
  ExecParams,
  ExecResult,
  FileReadResult,
  FileWriteResult,
  ResearchRunResult,
  AgentInfo,
} from './sandbox-types'
import { useAuthStore } from './auth-store'

export interface SandboxClientOptions {
  baseUrl: string
  fetchImpl?: typeof fetch
  /** Phase B.3: 必填 (从 auth-store 读) */
  token: string
}

export class SandboxHttpError extends Error {
  constructor(
    message: string,
    public code: number,
    public data?: unknown,
  ) {
    super(message)
    this.name = 'SandboxHttpError'
  }
}

export class SandboxClient {
  private baseUrl: string
  private fetchImpl: typeof fetch
  private token: string
  private nextId = 1

  constructor(opts: SandboxClientOptions) {
    if (!opts.token) {
      throw new Error('SandboxClient: token 必填 (Phase B.3 JWT 强制)')
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis)
    this.token = opts.token
  }

  /** Low-level JSON-RPC 2.0 call. */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    const url = `${this.baseUrl}/api/${method}`
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    })
    // Phase B.3: 永远发 Authorization 头, token 没了就先 clear auth
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    }

    const res = await this.fetchImpl(url, { method: 'POST', headers, body })
    if (res.status === 401) {
      // token 失效, 清登录态
      useAuthStore.getState().clear?.()
    }
    if (!res.ok) {
      throw new SandboxHttpError(
        `HTTP ${res.status} ${res.statusText} from ${url}`,
        res.status,
      )
    }
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } }
    if (json.error) {
      throw new SandboxHttpError(json.error.message, json.error.code, json.error.data)
    }
    return json.result as T
  }

  // ---------- typed convenience helpers ----------

  health(): Promise<{ status: string; version: string; methods: number }> {
    return this.call('health.ping')
  }

  sandboxExec(p: ExecParams): Promise<ExecResult> {
    return this.call('sandbox.exec', p)
  }

  fileRead(path: string, encoding: 'utf-8' | 'base64' = 'utf-8'): Promise<FileReadResult> {
    return this.call('file.read', { path, encoding })
  }

  fileWrite(path: string, content: string, createDirs = true): Promise<FileWriteResult> {
    return this.call('file.write', { path, content, create_dirs: createDirs })
  }

  fileList(path: string): Promise<{ files: string[] }> {
    // Use subagent.file_op since list is a first-class op there
    return this.call('subagent.file_op', { op: 'list', src: path })
  }

  researchRun(query: string, maxResults = 5): Promise<ResearchRunResult> {
    return this.call('research.run', { query, max_results: maxResults })
  }

  agentList(): Promise<{ agents: AgentInfo[] }> {
    return this.call('agent.list')
  }

  metricsSnapshot(): Promise<{ prom_text: string }> {
    return this.call('metrics.snapshot')
  }
}

/** Phase B.3: 从 auth-store 实时读 token (login 后可用) */
function getAuthToken(): string {
  if (typeof window === 'undefined') return ''
  return useAuthStore.getState().accessToken ?? ''
}

// Default client — env-overridable for prod vs dev
export const sandboxClient =
  typeof window !== 'undefined'
    ? new SandboxClient({
        baseUrl: (import.meta.env?.VITE_SANDBOX_URL as string) || 'http://127.0.0.1:9100',
        token: getAuthToken(),
      })
    : null
