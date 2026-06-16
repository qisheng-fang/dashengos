// apps/web/src/routes/_workspace.settings.models.provider.tsx · Track C.3 (2026-06-15)
// 厂商管理 (DeepSeek / SiliconFlow / OpenAI / Anthropic / Ollama)
// 每厂商: API Key 凭证 + 健康检查
//
// Phase A (2026-06-16): 真接 backend · DELETE MOCK_PROVIDERS
//   - GET  /api/v1/settings                       拿 user 全部 settings
//   - PUT  /api/v1/settings/provider/:id         存 API key
//   - DELETE /api/v1/settings/provider/:id       清 key
//   - POST /api/v1/settings/provider/:id/test    真测连通 (打 provider 公共 API)

import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, RefreshCw, Key, Trash2 } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

interface ProviderMeta {
  id: string
  name: string
  envKey: string
  baseUrl: string
  /** 是否本地 (无 key) */
  local: boolean
}

interface Provider {
  id: string
  name: string
  envKey: string
  baseUrl: string
  local: boolean
  hasKey: boolean
  healthy: boolean | null
  lastChecked: number | null
  errorMessage: string | null
}

// 5 个 provider 的静态元数据 (id, 显示名, env var 名, base URL, 是否本地)
const PROVIDER_META: ProviderMeta[] = [
  { id: 'deepseek',    name: 'DeepSeek',     envKey: 'DEEPSEEK_API_KEY',    baseUrl: 'https://api.deepseek.com',     local: false },
  { id: 'siliconflow', name: 'SiliconFlow',  envKey: 'SILICONFLOW_API_KEY', baseUrl: 'https://api.siliconflow.cn/v1', local: false },
  { id: 'openai',      name: 'OpenAI',       envKey: 'OPENAI_API_KEY',      baseUrl: 'https://api.openai.com/v1',    local: false },
  { id: 'anthropic',   name: 'Anthropic',    envKey: 'ANTHROPIC_API_KEY',   baseUrl: 'https://api.anthropic.com/v1', local: false },
  { id: 'ollama',      name: 'Ollama (本地)', envKey: 'OLLAMA_HOST',         baseUrl: 'http://127.0.0.1:11434',      local: true  },
]

// Ollama 默认 "有 key" (本地),其他默认 false
function metaToProvider(m: ProviderMeta): Provider {
  return { ...m, hasKey: m.local, healthy: null, lastChecked: null, errorMessage: null }
}

export const Route = createFileRoute('/_workspace/settings/models/provider')({
  component: ProviderPage,
})

function ProviderPage() {
  const [providers, setProviders] = useState<Provider[]>(PROVIDER_META.map(metaToProvider))
  const [revealId, setRevealId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Phase A: 启动时拉 server 端 user settings
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await http.get<{ providers: Record<string, { hasKey: boolean }>; text: unknown }>(
        '/api/v1/settings',
      )
      setProviders((prev) =>
        prev.map((p) => {
          const serverCfg = data.providers?.[p.id]
          if (!serverCfg) return p
          return { ...p, hasKey: p.local || !!serverCfg.hasKey }
        }),
      )
    } catch (e) {
      setError((e as Error).message ?? '加载 settings 失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Phase A: 真接 backend test endpoint (打 provider 公共 API)
  async function testHealth(id: string) {
    setTesting(id)
    setError(null)
    try {
      const res = await http.post<{ healthy: boolean; latency_ms: number; error?: string }>(
        `/api/v1/settings/provider/${id}/test`,
      )
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, healthy: res.healthy, lastChecked: Date.now(), errorMessage: res.error ?? null }
            : p,
        ),
      )
    } catch (e) {
      setProviders((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, healthy: false, lastChecked: Date.now(), errorMessage: (e as Error).message }
            : p,
        ),
      )
    } finally {
      setTesting(null)
    }
  }

  function startEdit(p: Provider) {
    setEditingId(p.id)
    setDraftKey('')
    setRevealId(null)
  }

  // Phase A: 真 PUT API key
  async function saveKey() {
    if (!editingId || !draftKey.trim()) return
    const id = editingId
    setSaving(id)
    setError(null)
    try {
      await http.put<{ ok: boolean; hasKey: boolean }>(
        `/api/v1/settings/provider/${id}`,
        { apiKey: draftKey.trim() },
      )
      setProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, hasKey: true, healthy: null, lastChecked: null } : p)),
      )
      setEditingId(null)
      setDraftKey('')
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`)
    } finally {
      setSaving(null)
    }
  }

  // Phase A: 真 DELETE key
  async function clearKey(id: string) {
    if (!confirm('确定清除该厂商的 API key?')) return
    setSaving(id)
    setError(null)
    try {
      await http.delete<{ ok: boolean; hasKey: boolean }>(`/api/v1/settings/provider/${id}`)
      setProviders((prev) =>
        prev.map((p) => (p.id === id ? { ...p, hasKey: p.local, healthy: null, lastChecked: null, errorMessage: null } : p)),
      )
    } catch (e) {
      setError(`清除失败: ${(e as Error).message}`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-4" data-testid="provider-page">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300" data-testid="provider-error">
          {error}
        </div>
      )}
      {loading && providers.every((p) => p.healthy === null && !p.hasKey && !p.local) && (
        <div className="text-xs text-neutral-500" data-testid="provider-loading">加载 settings 中...</div>
      )}
      {providers.map((p) => {
        const isEditing = editingId === p.id
        const isRevealed = revealId === p.id
        return (
          <Card key={p.id} className="bg-neutral-900/50 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-base text-neutral-100 flex items-center gap-2">
                <Key size={14} aria-hidden="true" />
                {p.name}
                <span className="text-[10px] font-mono text-neutral-500 ml-auto">
                  {p.envKey}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-[10px] text-neutral-500 font-mono">{p.baseUrl}</div>

              {/* 凭证输入 */}
              <div>
                <Label className="text-xs text-neutral-400">API Key 凭证</Label>
                {isEditing ? (
                  <div className="mt-1 flex gap-1.5">
                    <input
                      type={isRevealed ? 'text' : 'password'}
                      value={draftKey}
                      onChange={(e) => setDraftKey(e.target.value)}
                      placeholder="sk-... 粘贴到 backend, 立即生效"
                      className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100 font-mono"
                      data-testid={`key-input-${p.id}`}
                      autoFocus
                    />
                    <Button variant="ghost" size="sm" onClick={() => setRevealId(isRevealed ? null : p.id)}>
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </Button>
                    <Button size="sm" onClick={saveKey} disabled={saving === p.id || !draftKey.trim()} data-testid={`key-save-${p.id}`}>
                      {saving === p.id ? <Loader2 size={12} className="animate-spin" /> : '保存'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setEditingId(null); setDraftKey('') }}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-300 font-mono flex items-center">
                      {p.hasKey ? (isRevealed ? p.envKey : '••••••••••••••••') : '未配置'}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => setRevealId(isRevealed ? null : p.id)} disabled={!p.hasKey}>
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p)} data-testid={`key-edit-${p.id}`} disabled={saving === p.id}>
                      {p.hasKey ? '更换' : '配置'}
                    </Button>
                    {p.hasKey && !p.local && (
                      <Button variant="ghost" size="sm" onClick={() => clearKey(p.id)} disabled={saving === p.id} data-testid={`key-clear-${p.id}`}>
                        {saving === p.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* 健康状态 */}
              <div className="flex items-center justify-between text-xs text-neutral-400 pt-1 border-t border-neutral-800">
                <div className="flex items-center gap-2">
                  {p.healthy === true && (
                    <>
                      <CheckCircle2 size={12} className="text-emerald-400" />
                      <span className="text-emerald-400">健康</span>
                    </>
                  )}
                  {p.healthy === false && (
                    <>
                      <XCircle size={12} className="text-red-400" />
                      <span className="text-red-400" title={p.errorMessage ?? ''}>
                        {p.hasKey ? (p.errorMessage ?? '不可达') : '凭证缺失'}
                      </span>
                    </>
                  )}
                  {p.healthy === null && <span>未测</span>}
                  {p.lastChecked && (
                    <span className="text-[10px] text-neutral-600">
                      · {Math.round((Date.now() - p.lastChecked) / 1000)}s 前
                    </span>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => testHealth(p.id)}
                  disabled={testing === p.id}
                  data-testid={`test-provider-${p.id}`}
                >
                  {testing === p.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  测试连接
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}

      <p className="text-[10px] text-neutral-600 leading-relaxed">
        ℹ️ 凭证存到 backend `user_settings` 表 (per-user), 测试连接会真打 provider 公共 API (5s timeout)。
        老板给的 SiliconFlow key 走 `packages/backend/.env` (env 优先) 或这里覆盖。
      </p>
    </div>
  )
}
