// apps/web/src/lib/sandbox-client.ts · v0.3 Phase 4 前端接入
//
// Phase F (2026-06-17) 改走 backend · 走 permission + HITL 保护
//   之前: JSON-RPC 2.0 → ${baseUrl}/api/${method} (直连 sandbox-exporter :9100)
//   现在: REST → /api/v1/tools/${method}/invoke (backend :8000, 走 permission + HITL)
//
// 之前的安全漏洞: sandboxClient.sandboxExec / file.write 等高危操作走 :9100 旁路 backend
//   任何登录用户能直接调 Go daemon 的 sandbox.exec, 绕开 tool_permissions + HITL
//
// 现在: 所有调用经 backend 校验, 高危 (allow=1 + require_confirm=1) 自动触发前端 202 确认流

import type {
  ExecParams,
  ExecResult,
  FileReadResult,
  FileWriteResult,
  ResearchRunResult,
  AgentInfo,
} from './sandbox-types'
import { useAuthStore } from './auth-store'
import { http, ApiError, invokeTool, type InvokeToolOptions } from './api'

// 兼容旧 caller · 传 baseUrl + token (token 仍必填, 默认从 auth-store 读)
export interface SandboxClientOptions {
  baseUrl?: string
  fetchImpl?: typeof fetch
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

/** Phase F: 转换 backend 响应到 sandbox IPC 原始 result 形状 */
interface InvokeResponse {
  tool_id: string
  result: unknown
  executed_at: number
  duration_ms: number
  source: string
  permission_reason: string
  require_confirm: boolean
}

export class SandboxClient {
  private baseUrl?: string
  private token: string

  constructor(opts: SandboxClientOptions) {
    if (!opts.token) {
      throw new Error('SandboxClient: token 必填 (Phase B.3 JWT 强制)')
    }
    this.baseUrl = opts.baseUrl
    this.token = opts.token
  }

  /**
   * Phase F: 走 backend /api/v1/tools/:id/invoke
   * @param method  23 sandbox IPC 之一 (跟 backend SANDBOX_TOOLS 列表对齐)
   * @param params 透传给 sandbox daemon 的 params
   * @param invokeOpts 含 timeoutMs / confirmPrompt (HITL 弹窗)
   */
  async call<T = unknown>(method: string, params?: unknown, invokeOpts: InvokeToolOptions = {}): Promise<T> {
    // Phase F: invokeTool 已经处理 202 + confirm 弹窗, 我们直接用
    const r = await invokeTool<InvokeResponse>(method, {
      ...invokeOpts,
      params: (params ?? {}) as Record<string, unknown>,
    })
    return r.result as T
  }

  // ---------- typed convenience helpers ----------

  health(): Promise<{ status: string; version: string; methods: number }> {
    return this.call('health.ping')
  }

  sandboxExec(p: ExecParams, opts?: InvokeToolOptions): Promise<ExecResult> {
    return this.call('sandbox.exec', p, opts)
  }

  fileRead(path: string, encoding: 'utf-8' | 'base64' = 'utf-8', opts?: InvokeToolOptions): Promise<FileReadResult> {
    return this.call('file.read', { path, encoding }, opts)
  }

  fileWrite(path: string, content: string, createDirs = true, opts?: InvokeToolOptions): Promise<FileWriteResult> {
    return this.call('file.write', { path, content, create_dirs: createDirs }, opts)
  }

  fileList(path: string, opts?: InvokeToolOptions): Promise<{ files: string[] }> {
    return this.call('subagent.file_op', { op: 'list', src: path }, opts)
  }

  researchRun(query: string, maxResults = 5, opts?: InvokeToolOptions): Promise<ResearchRunResult> {
    return this.call('research.run', { query, max_results: maxResults }, opts)
  }

  agentList(opts?: InvokeToolOptions): Promise<{ agents: AgentInfo[] }> {
    return this.call('agent.list', undefined, opts)
  }

  metricsSnapshot(opts?: InvokeToolOptions): Promise<{ prom_text: string }> {
    return this.call('metrics.snapshot', undefined, opts)
  }
}

/** Phase F: 从 auth-store 实时读 token (login 后可用) */
function getAuthToken(): string {
  if (typeof window === 'undefined') return ''
  return useAuthStore.getState().accessToken ?? ''
}

// Default client · env-overridable for prod vs dev
// Phase F: 删 baseUrl 默认 :9100, 改走 :8000 (backend 走 permission + HITL)
export const sandboxClient =
  typeof window !== 'undefined'
    ? new SandboxClient({
        token: getAuthToken(),
      })
    : null
