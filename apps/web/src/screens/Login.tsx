// apps/web/src/screens/Login.tsx · v0.3 Phase 5+ (real backend)
import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore, type AuthUser } from '@/lib/auth-store'
import { http, ApiError } from '@/lib/api'

interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user: AuthUser
}

export function Login() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // Phase 3 (2026-06-17): 读 redirect param，登录后跳回
  const search = useSearch({ from: '/login' }) as { redirect?: string }
  const setSession = useAuthStore((s) => s.setSession)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const fd = new FormData(e.currentTarget)
    const username = String(fd.get('username') ?? '').trim()
    const password = String(fd.get('password') ?? '')
    if (!username || !password) {
      setError('用户名和密码必填')
      setLoading(false)
      return
    }
    try {
      const res = await http.post<LoginResponse>('/api/v1/auth/login', { username, password }, { anonymous: true })
      setSession(res.user, {
        access: res.access_token,
        refresh: res.refresh_token,
        expiresAt: Date.now() + res.expires_in * 1000,
      })
      void navigate({ to: search.redirect || '/chats/default' })
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError('用户名或密码错误')
        else setError(`${e.status} ${e.message}`)
      } else {
        setError('网络错误: ' + String(e))
      }
    } finally {
      setLoading(false)
    }
  }

  async function startSSO(provider: 'github' | 'google') {
    try {
      const res = await http.post<{ auth_url: string; state: string; session_id: string }>(
        '/api/v1/auth/sso/init',
        { provider, redirect_uri: `${window.location.origin}/sso/callback` },
        { anonymous: true },
      )
      // Stash the session_id for the callback page
      sessionStorage.setItem('sso_state', res.state)
      sessionStorage.setItem('sso_session', res.session_id)
      sessionStorage.setItem('sso_provider', provider)
      window.location.href = res.auth_url
    } catch (e) {
      setError('SSO 启动失败: ' + String(e))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <Card className="w-full max-w-md bg-neutral-900 border-neutral-800">
        <CardHeader>
          <CardTitle className="text-2xl text-neutral-100">{t('auth.login')}</CardTitle>
          <CardDescription className="text-neutral-400">
            DaShengOS · 私有 AI 工作台
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-neutral-200">
                {t('auth.email')}
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                placeholder="用户名 (或邮箱)"
                autoComplete="username"
                required
                className="bg-neutral-800 border-neutral-700"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-neutral-200">
                {t('auth.password')}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                className="bg-neutral-800 border-neutral-700"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox id="remember" name="remember" />
                <Label htmlFor="remember" className="text-sm text-neutral-300 cursor-pointer">
                  {t('auth.rememberMe')}
                </Label>
              </div>
              <a href="#" className="text-sm text-brand hover:underline">
                {t('auth.forgotPassword')}
              </a>
            </div>
            {error && (
              <p role="alert" className="text-sm text-semantic-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={loading} aria-busy={loading}>
              {loading ? '登录中...' : t('auth.login')}
            </Button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-neutral-800" />
            <span className="text-xs text-neutral-500">或</span>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => startSSO('github')}
              aria-label="使用 GitHub 登录"
            >
              <span className="text-base mr-2">⌥</span>
              GitHub
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => startSSO('google')}
              aria-label="使用 Google 登录"
            >
              <span className="text-base mr-2">G</span>
              Google
            </Button>
          </div>

          <p className="text-center text-sm text-neutral-400 mt-4">
            {t('auth.noAccount')}{' '}
            <a href="#" className="text-brand hover:underline">
              {t('auth.signUp')}
            </a>
          </p>
          <p className="text-center text-xs text-neutral-400 pt-2">
            隐私声明 · 服务条款 · 状态页
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
