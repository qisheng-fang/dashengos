// apps/web/src/screens/OAuthManager.tsx · D6-3 (2026-06-18)
// 4 平台 OAuth 可视化管理 — 用 dashboard 聚合端点拉元数据
//   4 张卡片: 微信/飞书/视频号/Shopify
//   每张卡片显示: configured / connected / updated_at / expiring_soon
//   操作: connect (跳 /api/v1/oauth/:platform/start) / disconnect / test
//
// 老板用例:
//   1. 打开 Settings → 外部平台 OAuth
//   2. 看到 4 张卡片 (connected=false 默认)
//   3. 点"连接微信公众号" → 跳微信授权 → 回来 refresh
//   4. 看到 connected=true + expiring_soon
//   5. 点"测活" → 后端调微信 API 验证 token 还活着

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plug, ExternalLink, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Unplug, Activity } from 'lucide-react'
import { http } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'
interface DashboardData {
  ts: number
  user: { id: string; role: string }
  status: {
    version: string
    uptime_sec: number
    backend: { running: boolean; pid?: number }
    services: { fastify: any; vite: any; deerflow: any }
  }
  providers: {
    active: string
    configured: number
    total: number
    providers: Array<{ name: string; displayName: string; configured: boolean; defaultModel: string }>
  }
  oauth: {
    user_id: string
    connections: Array<{
      platform: 'wechat_mp' | 'feishu' | 'wechat_video' | 'shopify'
      connected: boolean
      openid?: string
      expires_at?: number
      updated_at?: number
      expiring_soon?: boolean
    }>
    connected_count: number
    total: number
  }
  doctor: {
    python_ok: boolean
    db_ok: boolean
    llm_configured: boolean
    health: 'healthy' | 'degraded'
  }
  _cache_hit?: boolean
  _cache_age_sec?: number
}

export function OAuthManager() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const qc = useQueryClient()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => http.get<DashboardData>('/api/v1/dashboard'),
    enabled: !!accessToken,
    refetchInterval: 30_000,  // 30s 自动刷新 (后端 30s 缓存)
  })

  const disconnectMutation = useMutation({
    mutationFn: (platform: string) => http.post(`/api/v1/oauth/${platform}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard'] }),
  })

  const testMutation = useMutation({
    mutationFn: (platform: string) => http.post<{ ok: boolean; info?: string; error?: string }>(`/api/v1/oauth/${platform}/test`),
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Plug className="w-6 h-6" />
            外部平台 OAuth
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            连接微信公众号 / 飞书 / 视频号 / Shopify, 让 DaShengOS 能直接调它们的 API
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?._cache_hit && (
            <span className="text-xs text-neutral-500">
              缓存 {data._cache_age_sec}s
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1" /> 刷新
          </Button>
        </div>
      </div>

      {/* 状态条 */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="后端" value={data.status.backend.running ? '运行中' : '已停止'} ok={data.status.backend.running} />
          <Stat label="DeerFlow" value={data.status.services.deerflow.running ? '运行中' : '已停止'} ok={data.status.services.deerflow.running} />
          <Stat label="LLM Provider" value={`${data.providers.configured}/${data.providers.total} 已配`} ok={data.providers.configured > 0} />
          <Stat label="OAuth" value={`${data.oauth.connected_count}/${data.oauth.total} 已连`} ok={data.oauth.connected_count > 0} />
        </div>
      )}

      {/* 4 平台卡片 */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          <span className="ml-2 text-neutral-400">加载中…</span>
        </div>
      )}

      {error && (
        <div className="text-red-400 text-sm">
          加载失败: {String((error as Error).message)}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PLATFORM_META_ORDER.map((meta) => {
            const conn = data.oauth.connections.find((c) => c.platform === meta.key)
            return (
              <PlatformCard
                key={meta.key}
                platformKey={meta.key}
                platformName={meta.name}
                color={meta.color}
                oauthMethod={meta.oauthMethod}
                connected={conn?.connected ?? false}
                openid={conn?.openid}
                updatedAt={conn?.updated_at}
                expiringSoon={conn?.expiring_soon}
                onConnect={() => {
                  // 浏览器跳到后端 /start, 走 OAuth 流程
                  const baseUrl = import.meta.env.VITE_API_URL || ''
                  window.location.href = `${baseUrl}/api/v1/oauth/${meta.key}/start`
                }}
                onDisconnect={() => disconnectMutation.mutate(meta.key)}
                onTest={() => testMutation.mutate(meta.key)}
                testResult={testMutation.data && testMutation.variables === meta.key ? testMutation.data : undefined}
                disconnecting={disconnectMutation.isPending && disconnectMutation.variables === meta.key}
                testing={testMutation.isPending && testMutation.variables === meta.key}
              />
            )
          })}
        </div>
      )}

      {/* 提示 */}
      {data && (
        <div className="text-xs text-neutral-500 border-t border-neutral-800 pt-4">
          <p>
            💡 4 平台说明:
            <span className="ml-2">微信公众号 = 浏览器跳微信授权</span>
            <span className="ml-2">·</span>
            <span className="ml-2">视频号 = 复用公众号 appid, 自动同步</span>
            <span className="ml-2">·</span>
            <span className="ml-2">飞书 = 浏览器跳飞书授权</span>
            <span className="ml-2">·</span>
            <span className="ml-2">Shopify = 在 Shopify 后台拿 admin token 直接填</span>
          </p>
          <p className="mt-1">
            凭证加密存于 <code>~/.dasheng/secrets.db</code> (AES-256-GCM), 重启 backend 不丢
          </p>
        </div>
      )}
    </div>
  )
}

const PLATFORM_META_ORDER = [
  { key: 'wechat_mp', configured: true, name: '微信公众号', color: 'emerald', oauthMethod: 'browser' as const },
  { key: 'feishu', configured: true, name: '飞书', color: 'sky', oauthMethod: 'browser' as const },
  { key: 'wechat_video', configured: true, name: '微信视频号', color: 'emerald', oauthMethod: 'browser' as const },
  { key: 'shopify', configured: true, name: 'Shopify (爱尤趣)', color: 'lime', oauthMethod: 'token' as const },
]

function Stat({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="border border-neutral-800 rounded-lg p-3 bg-neutral-900">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={cn('text-sm font-medium mt-1', ok ? 'text-emerald-400' : 'text-neutral-400')}>
        {value}
      </div>
    </div>
  )
}

interface PlatformCardProps {
  platformKey: string
  platformName: string
  color: string
  oauthMethod: 'browser' | 'token'
  connected: boolean
  openid?: string
  updatedAt?: number
  expiringSoon?: boolean
  onConnect: () => void
  onDisconnect: () => void
  onTest: () => void
  testResult?: { ok: boolean; info?: string; error?: string }
  disconnecting: boolean
  testing: boolean
}

function PlatformCard(p: PlatformCardProps) {
  const updatedStr = p.updatedAt
    ? new Date(p.updatedAt).toLocaleString('zh-CN', { hour12: false })
    : '—'

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Plug className={cn('w-4 h-4', `text-${p.color}-400`)} />
            {p.platformName}
          </CardTitle>
          {p.connected ? (
            <Badge variant="default" className="bg-emerald-600">
              <CheckCircle2 className="w-3 h-3 mr-1" /> 已连接
            </Badge>
          ) : (
            <Badge variant="outline" className="text-neutral-400">
              <XCircle className="w-3 h-3 mr-1" /> 未连接
            </Badge>
          )}
        </div>
        <CardDescription>
          {p.oauthMethod === 'browser' ? '浏览器跳第三方授权' : '在第三方后台拿 token 直接填'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {p.connected && (
          <div className="text-xs space-y-1 text-neutral-400 border-l-2 border-emerald-500/30 pl-3">
            {p.openid && <div>openid: <code className="text-neutral-300">{p.openid}</code></div>}
            <div>更新时间: {updatedStr}</div>
            {p.expiringSoon && (
              <div className="text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> 24h 内过期, 需重新授权
              </div>
            )}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex flex-wrap gap-2">
          {!p.connected ? (
            <Button size="sm" onClick={p.onConnect} disabled={p.disconnecting || p.testing}>
              <ExternalLink className="w-3 h-3 mr-1" /> 连接
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={p.onTest}
                disabled={p.testing || p.disconnecting}
              >
                {p.testing ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Activity className="w-3 h-3 mr-1" />}
                测活
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={p.onDisconnect}
                disabled={p.disconnecting || p.testing}
              >
                {p.disconnecting ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Unplug className="w-3 h-3 mr-1" />}
                断开
              </Button>
            </>
          )}
        </div>

        {/* 测活结果 */}
        {p.testResult && (
          <div
            className={cn(
              'text-xs p-2 rounded border',
              p.testResult.ok
                ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5'
                : 'border-red-500/30 text-red-300 bg-red-500/5',
            )}
          >
            {p.testResult.ok ? '✓ ' : '✗ '}
            {p.testResult.info || p.testResult.error || 'unknown'}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
