// apps/web/src/routes/_workspace.settings.social-cookies.tsx · Track B.1 (2026-06-17)
// 社交媒体 Cookie 管理 — 抖音/小红书/公众号
// API: GET/PUT/DELETE /api/v1/social/cookies/:platform

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, Trash2, Save, Music2, Camera, MessageCircle } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

interface PlatformMeta {
  id: string
  name: string
  icon: typeof Music2
  description: string
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'douyin',
    name: '抖音',
    icon: Music2,
    description: '抖音短视频发布需要 cookie，过期后需重新获取。从浏览器 DevTools → Application → Cookies 复制。',
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    icon: Camera,
    description: '小红书笔记发布需要 cookie认证。从浏览器 DevTools → Application → Cookies 复制。',
  },
  {
    id: 'wechat',
    name: '微信公众号',
    icon: MessageCircle,
    description: '微信公众号通过 session_id 机制认证（非传统 cookie）。微信扫码登录后自动获取。',
  },
]

interface CookieStatus {
  platform: string
  has_cookie: boolean
  count: number
}

interface CookieInfo {
  id: string
  platform: string
  cookie_name: string
  metadata: {
    nickname?: string
    avatar?: string
    expires_at?: number
    notes?: string
  }
  created_at: number
  updated_at: number
}

// 手动路由树使用, 不需要 createFileRoute (避免 TanStack Router 类型冲突)
export { SocialCookiesPage }

function SocialCookiesPage() {
  const [status, setStatus] = useState<Record<string, CookieStatus>>({})
  const [cookies, setCookies] = useState<CookieInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editPlatform, setEditPlatform] = useState<string | null>(null)
  const [draftValue, setDraftValue] = useState('')
  const [showValue, setShowValue] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await http.get<{ cookies: CookieInfo[]; status: Record<string, CookieStatus> }>(
        '/api/v1/social/cookies',
      )
      setCookies(data.cookies ?? [])
      setStatus(data.status ?? {})
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function startEdit(platform: string) {
    setEditPlatform(platform)
    setDraftValue('')
    setShowValue(null)
  }

  async function saveCookie(platform: string) {
    if (!draftValue.trim()) return
    setSaving(platform)
    setError(null)
    try {
      await http.put(`/api/v1/social/cookies/${platform}`, {
        cookie_value: draftValue.trim(),
        cookie_name: 'default',
        metadata: {},
      })
      setEditPlatform(null)
      setDraftValue('')
      setSaved(platform)
      setTimeout(() => setSaved(null), 2000)
      await load()
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`)
    } finally {
      setSaving(null)
    }
  }

  async function deleteCookie(platform: string) {
    if (!confirm(`确定删除 ${platform} 的 cookie?`)) return
    setSaving(platform)
    setError(null)
    try {
      await http.delete(`/api/v1/social/cookies/${platform}`)
      await load()
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`)
    } finally {
      setSaving(null)
    }
  }

  async function viewCookie(platform: string) {
    if (showValue === platform) {
      setShowValue(null)
      return
    }
    setError(null)
    try {
      const data = await http.get<{ cookie_value: string }>(`/api/v1/social/cookies/${platform}`)
      setDraftValue(data.cookie_value)
      setShowValue(platform)
    } catch (e) {
      setError(`解密失败: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-4" data-testid="social-cookies-page">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 size={12} className="animate-spin" /> 加载中...
        </div>
      ) : (
        PLATFORMS.map((p) => {
          const Icon = p.icon
          const s = status[p.id]
          const hasCookie = s?.has_cookie ?? false
          const isEditing = editPlatform === p.id
          const isRevealing = showValue === p.id
          const platformCookies = cookies.filter((c) => c.platform === p.id)
          const meta = platformCookies[0]?.metadata

          return (
            <Card key={p.id} className="bg-neutral-900/50 border-neutral-800">
              <CardHeader>
                <CardTitle className="text-base text-neutral-100 flex items-center gap-2">
                  <Icon size={14} aria-hidden="true" />
                  {p.name}
                  <span className="ml-auto flex items-center gap-1.5">
                    {hasCookie ? (
                      <>
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        <span className="text-xs text-emerald-400">已配置</span>
                      </>
                    ) : (
                      <>
                        <XCircle size={14} className="text-red-400" />
                        <span className="text-xs text-red-400">未配置</span>
                      </>
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-neutral-500">{p.description}</p>

                {/* 已有 cookie 信息 */}
                {meta?.nickname && (
                  <div className="text-xs text-neutral-400">
                    👤 {meta.nickname}
                    {meta.expires_at && (
                      <> · 过期: {new Date(meta.expires_at).toLocaleDateString('zh-CN')}</>
                    )}
                  </div>
                )}

                {/* 编辑模式 */}
                {isEditing ? (
                  <div className="space-y-2">
                    <Label className="text-xs text-neutral-400">Cookie 值 (加密存储)</Label>
                    <div className="flex gap-1.5">
                      <input
                        type={isRevealing ? 'text' : 'password'}
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        placeholder="从浏览器 DevTools 复制完整 cookie 字符串..."
                        className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100 font-mono"
                        data-testid={`cookie-input-${p.id}`}
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowValue(isRevealing ? null : p.id)}
                      >
                        {isRevealing ? <EyeOff size={12} /> : <Eye size={12} />}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => saveCookie(p.id)}
                        disabled={saving === p.id || !draftValue.trim()}
                        data-testid={`cookie-save-${p.id}`}
                      >
                        {saving === p.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        保存
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditPlatform(null)
                          setDraftValue('')
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-300 font-mono flex items-center">
                      {hasCookie ? '•••••••••••• (加密)' : '未配置'}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p.id)}>
                      {hasCookie ? '更换' : '配置'}
                    </Button>
                    {hasCookie && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => viewCookie(p.id)}>
                          <Eye size={12} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteCookie(p.id)}
                          disabled={saving === p.id}
                        >
                          <Trash2 size={12} />
                        </Button>
                      </>
                    )}
                  </div>
                )}

                {saved === p.id && (
                  <p className="text-xs text-emerald-400">✓ 已保存</p>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      <p className="text-[10px] text-neutral-600 leading-relaxed">
        ℹ️ Cookie 使用 AES-256-GCM 加密存储于 backend 数据库 (per-user)。仅在后端内存中解密用于 API 调用，
        前端仅传输加密值。生产环境请设置 COOKIE_ENCRYPTION_KEY 环境变量 (≥32字符)。
      </p>
    </div>
  )
}
