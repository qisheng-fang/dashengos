// apps/web/src/routes/sso.callback.tsx · v0.3 Phase 5+
// OIDC callback handler. Receives the redirect from the SSO provider
// (GitHub, Google, etc.), exchanges code→token via backend, stores
// the session, and redirects to the workspace.

import { useEffect, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { http, ApiError } from '@/lib/api'
import { useAuthStore, type AuthUser } from '@/lib/auth-store'

interface SSOCallbackResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: AuthUser
}

export const Route = createFileRoute('/sso/callback')({
  component: SSOCallbackPage,
})

function SSOCallbackPage() {
  const navigate = useNavigate()
  const setSession = useAuthStore((s) => s.setSession)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('处理中...')

  useEffect(() => {
    async function handle() {
      const params = new URLSearchParams(window.location.search)
      const code = params.get('code')
      const state = params.get('state')
      const sessionId = sessionStorage.getItem('sso_session')

      if (!code || !state || !sessionId) {
        setError('missing OAuth code/state/session_id')
        return
      }
      if (state !== sessionStorage.getItem('sso_state')) {
        setError('SSO state 不匹配 (可能 CSRF 攻击)')
        return
      }
      setStatus('与后端交换 access token...')
      try {
        const res = await http.post<SSOCallbackResponse>(
          '/api/v1/auth/sso/callback',
          { code, state, session_id: sessionId },
          { anonymous: true },
        )
        setSession(res.user, {
          access: res.access_token,
          refresh: res.refresh_token,
          expiresAt: Date.now() + res.expires_in * 1000,
        })
        // Clean up
        sessionStorage.removeItem('sso_state')
        sessionStorage.removeItem('sso_session')
        sessionStorage.removeItem('sso_provider')
        setStatus('登录成功! 跳转中...')
        void navigate({ to: '/' })
      } catch (e) {
        if (e instanceof ApiError) {
          setError(`${e.status} ${e.message}`)
        } else {
          setError(String(e))
        }
      }
    }
    handle()
  }, [navigate, setSession])

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-8 max-w-md w-full text-center">
        {error ? (
          <>
            <h1 className="text-2xl text-semantic-danger mb-2">SSO 登录失败</h1>
            <p className="text-sm text-neutral-400 mb-4">{error}</p>
            <a
              href="/login"
              className="inline-block px-4 py-2 bg-brand text-neutral-950 rounded-md text-sm font-medium hover:bg-brand-hover"
            >
              返回登录
            </a>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h1 className="text-lg text-neutral-100 mb-2">{status}</h1>
            <p className="text-xs text-neutral-500">请稍候, 正在通过 OIDC 验证你的身份</p>
          </>
        )}
      </div>
    </div>
  )
}
