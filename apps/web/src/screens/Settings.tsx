// apps/web/src/screens/Settings.tsx · v0.3 Phase 5+ (real auth/billing) + Track C.3 (2026-06-15) 模型路由拆 3 页
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { http } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { User, Cpu, Key, Shield, ScrollText, Settings as SettingsIcon, Loader2, Crown } from 'lucide-react'

const SUB_PAGES = [
  // Track C.3 · 模型路由 拆 3 子页 (text/multimodal/provider)
  { to: '/settings/models/text', label: '模型路由', icon: Cpu, exact: false },
  { to: '/settings/profile', label: '个人资料', icon: User },
  { to: '/settings/api-keys', label: 'API Key', icon: Key },
  { to: '/settings/sandbox', label: '沙箱配额', icon: Shield },
  { to: '/settings/audit', label: '审计日志', icon: ScrollText },
  { to: '/settings/advanced', label: '高级', icon: SettingsIcon },
]

interface TierInfo {
  tier: 'free' | 'pro' | 'enterprise'
  limits: {
    calls_per_month: number
    tokens_per_month: number
    sandbox_exec_seconds_per_month: number
    storage_gb: number
  }
  features: {
    sso: boolean
    custom_agents: boolean
    priority_queue: boolean
    dedicated_sandbox: boolean
  }
}

interface UsageInfo {
  usage: {
    user_id: string
    calls: number
    tokens: number
    sandbox_exec_seconds: number
    storage_bytes: number
  }
  period: string
}

const TIER_LABEL = {
  free: '免费',
  pro: '专业',
  enterprise: '企业',
} as const

const TIER_COLOR = {
  free: 'text-neutral-300',
  pro: 'text-brand',
  enterprise: 'text-semantic-warning',
} as const

export function Settings() {
  const { t } = useTranslation()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const [tier, setTier] = useState<TierInfo | null>(null)
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [t, u] = await Promise.all([
          http.get<TierInfo>('/api/v1/billing/tier'),
          http.get<UsageInfo>('/api/v1/billing/usage'),
        ])
        if (cancelled) return
        setTier(t)
        setUsage(u)
      } catch {
        // 后端不可达时静默 fallback
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold text-neutral-100 mb-6">⚙️ {t('settings.title')}</h1>

      <div className="grid grid-cols-[200px_1fr] gap-6">
        <nav className="space-y-1" aria-label="设置子页">
          {SUB_PAGES.map((p) => {
            const Icon = p.icon
            const isActive = p.exact ? location.pathname === p.to : location.pathname.startsWith(p.to)
            return (
              <Link
                key={p.to}
                to={p.to}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors',
                  isActive
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100',
                )}
              >
                <Icon size={14} aria-hidden="true" />
                {p.label}
              </Link>
            )
          })}
        </nav>

        {/* Track C.3 · 模型路由 Outlet (3 子路由: text/multimodal/provider) */}
        <Outlet />

        {/* 套餐 & 用量 (Track C.3 保留, 跟模型路由并列) */}
        <Card className="bg-neutral-900/50 border-neutral-800 mt-6">
          <CardHeader>
            <CardTitle className="text-lg text-neutral-100">套餐 & 用量</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
                ⚠ {error}
              </div>
            )}

            {/* 当前用户 */}
            {user && (
              <div className="flex items-center justify-between p-3 rounded-md bg-neutral-800/50">
                <div>
                  <Label className="text-neutral-200">当前用户</Label>
                  <p className="text-xs text-neutral-400 mt-1">
                    {user.username} · {user.role} {user.provider ? `· 通过 ${user.provider} 登录` : ''}
                  </p>
                </div>
              </div>
            )}

            {/* 计费 Tier */}
            {loading ? (
              <div className="flex items-center gap-2 text-neutral-400 text-sm">
                <Loader2 size={16} className="animate-spin" /> 加载套餐...
              </div>
            ) : tier ? (
              <div className="flex items-center justify-between p-3 rounded-md bg-neutral-800/50">
                <div>
                  <Label className="text-neutral-200">订阅套餐</Label>
                  <p className={`text-xs mt-1 ${TIER_COLOR[tier.tier]}`}>
                    <Crown size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />
                    {TIER_LABEL[tier.tier]}
                  </p>
                </div>
                <div className="text-right text-xs text-neutral-400">
                  <div>每月 {tier.limits.calls_per_month.toLocaleString()} 次调用</div>
                  <div>每月 {(tier.limits.tokens_per_month / 1_000_000).toFixed(1)}M tokens</div>
                  <div>沙箱 {tier.limits.sandbox_exec_seconds_per_month / 60} 分钟</div>
                </div>
              </div>
            ) : null}

            {/* 用量 */}
            {usage && (
              <div className="p-3 rounded-md bg-neutral-800/50">
                <Label className="text-neutral-200">本周期用量 ({usage.period})</Label>
                <div className="mt-2 space-y-1 text-xs text-neutral-300">
                  <UsageBar label="调用次数" value={usage.usage.calls} max={tier?.limits.calls_per_month ?? 1000} />
                  <UsageBar
                    label="Token 数"
                    value={usage.usage.tokens}
                    max={tier?.limits.tokens_per_month ?? 100_000}
                  />
                  <UsageBar
                    label="沙箱执行 (秒)"
                    value={usage.usage.sandbox_exec_seconds}
                    max={tier?.limits.sandbox_exec_seconds_per_month ?? 600}
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function UsageBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  return (
    <div>
      <div className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-neutral-400">
          {value.toLocaleString()} / {max.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 bg-neutral-900 rounded mt-1 overflow-hidden">
        <div
          className={cn(
            'h-full',
            pct < 70 ? 'bg-semantic-success' : pct < 90 ? 'bg-semantic-warning' : 'bg-semantic-danger',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
