// apps/web/src/lib/api.ts · v0.3 Phase 5+ 集中 API client
//
// Browser-side fetch wrapper that:
//   1. Reads JWT from auth store (zustand) and adds Authorization: Bearer
//   2. Auto-refreshes on 401 (calls /api/v1/auth/refresh once, retries)
//   3. Throws ApiError with structured fields
//   4. 空串 by default (走 Vite proxy /api → :8000); override via VITE_API_URL (生产环境)

import { useAuthStore } from './auth-store'

const DEFAULT_BASE =
  (typeof window !== 'undefined' && (window as any).__DASHE_API_URL__) ||
  (import.meta.env?.VITE_API_URL as string) ||
  ''  // 空串 = 走 Vite dev server proxy (/api → :8000), 避免浏览器走系统 http_proxy

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let _baseUrl = DEFAULT_BASE
let _onUnauthorized: (() => Promise<boolean> | boolean) | null = null

export const api = {
  /** Override the API base URL (used in tests). */
  setBaseUrl(url: string) {
    _baseUrl = url.replace(/\/$/, '')
  },
  /** Register a global 401 handler (returns true if retry should happen). */
  setUnauthorizedHandler(fn: () => Promise<boolean> | boolean) {
    _onUnauthorized = fn
  },
  get baseUrl() {
    return _baseUrl
  },
}

export interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  /** Skip auth (e.g. /api/v1/auth/login) */
  anonymous?: boolean
  /** Override retry-on-401 behavior */
  noRetry?: boolean
}

async function request<T>(method: string, path: string, opts: FetchOptions = {}): Promise<T> {
  const url = `${_baseUrl}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) ?? {}),
  }
  if (!opts.anonymous) {
    const token = useAuthStore.getState().accessToken
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  // 从 opts 剔除 body 避免 spread 时 unknown 报错 (fetch 要 BodyInit 类型)
  const { body: _omit, ...optsRest } = opts
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body as BodyInit | undefined,
      ...optsRest,
    })
  } catch (e) {
    throw new ApiError(`network error: ${(e as Error).message}`, 0)
  }

  // 401 → try refresh once
  if (res.status === 401 && !opts.anonymous && !opts.noRetry) {
    const retried = await tryRefresh()
    if (retried) {
      return request<T>(method, path, { ...opts, noRetry: true })
    } else {
      // logout
      useAuthStore.getState().clear()
      throw new ApiError('unauthorized', 401, 'UNAUTHORIZED')
    }
  }

  if (!res.ok) {
    let body: any = null
    try {
      body = await res.json()
    } catch {
      // ignore
    }
    throw new ApiError(
      body?.message || `HTTP ${res.status} ${res.statusText}`,
      res.status,
      body?.code,
      body?.details ?? body,
    )
  }

  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    return (await res.json()) as T
  }
  return (await res.text()) as unknown as T
}

let _refreshInFlight: Promise<boolean> | null = null
async function tryRefresh(): Promise<boolean> {
  if (_onUnauthorized) {
    const ok = await _onUnauthorized()
    if (ok) return true
  }
  // Default: call /api/v1/auth/refresh with the refresh token
  const refresh = useAuthStore.getState().refreshToken
  if (!refresh) return false
  // Coalesce concurrent refresh attempts
  if (_refreshInFlight) return _refreshInFlight
  _refreshInFlight = (async () => {
    try {
      const res = await fetch(`${_baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      })
      if (!res.ok) return false
      const json = (await res.json()) as { access_token: string; refresh_token?: string }
      useAuthStore.getState().setTokens({
        access: json.access_token,
        refresh: json.refresh_token ?? refresh,
        expiresAt: Date.now() + 60 * 60 * 1000, // conservative
      })
      return true
    } catch {
      return false
    } finally {
      _refreshInFlight = null
    }
  })()
  return _refreshInFlight
}

// HTTP verb helpers
export const http = {
  get: <T = unknown>(path: string, opts?: FetchOptions) => request<T>('GET', path, opts),
  post: <T = unknown>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>('POST', path, { ...opts, body }),
  put: <T = unknown>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>('PUT', path, { ...opts, body }),
  patch: <T = unknown>(path: string, body?: unknown, opts?: FetchOptions) =>
    request<T>('PATCH', path, { ...opts, body }),
  delete: <T = unknown>(path: string, opts?: FetchOptions) =>
    request<T>('DELETE', path, opts),
}

// ============================================================================
// Phase E (2026-06-17) HITL tool invocation
//   - 第一次调 /api/v1/tools/:id/invoke
//   - backend 返 202 + CONFIRM_REQUIRED → 弹 confirm 框 (默认用 window.confirm)
//   - 用户 OK → 重试带 confirm: true
//   - 用户 cancel → 抛 ApiError 'cancelled by user'
// ============================================================================
export interface InvokeToolOptions {
  params?: Record<string, unknown>
  timeoutMs?: number
  /** 自定义 confirm 弹窗 (默认 window.confirm) */
  confirmPrompt?: (reason: string) => boolean | Promise<boolean>
}

export async function invokeTool<T = unknown>(
  toolId: string,
  opts: InvokeToolOptions = {},
): Promise<T> {
  const body: Record<string, unknown> = { params: opts.params ?? {}, timeout_ms: opts.timeoutMs ?? 30_000 }
  try {
    return await http.post<T>(`/api/v1/tools/${toolId}/invoke`, body)
  } catch (e) {
    // 202 + CONFIRM_REQUIRED 走 ApiError, 重新调带 confirm:true
    if (e instanceof ApiError && e.code === 'CONFIRM_REQUIRED' && e.status === 202) {
      const reason = (e.details as { reason?: string })?.reason ?? '高危操作需确认'
      const ok = opts.confirmPrompt
        ? await opts.confirmPrompt(reason)
        : typeof window !== 'undefined'
          ? window.confirm(`⚠️ 高危操作\n\n工具: ${toolId}\n原因: ${reason}\n\n是否继续?`)
          : false
      if (!ok) {
        throw new ApiError('cancelled by user', 499, 'USER_CANCELLED')
      }
      return await http.post<T>(`/api/v1/tools/${toolId}/invoke`, { ...body, confirm: true })
    }
    throw e
  }
}
