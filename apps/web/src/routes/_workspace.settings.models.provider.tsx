// apps/web/src/routes/_workspace.settings.models.provider.tsx · Track C.3 (2026-06-15)
// 厂商管理 (DeepSeek / SiliconFlow / OpenAI / Anthropic / Ollama)
// 每厂商: API Key 凭证 + 健康检查 + 余额

import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, CheckCircle2, XCircle, Eye, EyeOff, RefreshCw, Key, Trash2 } from 'lucide-react'
import { useState } from 'react'

interface Provider {
  id: string
  name: string
  envKey: string
  baseUrl: string
  hasKey: boolean
  healthy: boolean | null
  /** 上次余额检查时间戳 (ms) */
  lastChecked: number | null
  /** 余额 (USD) — null 表示未查 */
  balance: number | null
}

const MOCK_PROVIDERS: Provider[] = [
  { id: 'deepseek',    name: 'DeepSeek',     envKey: 'DEEPSEEK_API_KEY',    baseUrl: 'https://api.deepseek.com',          hasKey: false, healthy: false, lastChecked: null, balance: null },
  { id: 'siliconflow', name: 'SiliconFlow',  envKey: 'SILICONFLOW_API_KEY', baseUrl: 'https://api.siliconflow.cn/v1',      hasKey: false, healthy: null,  lastChecked: null, balance: null },
  { id: 'openai',      name: 'OpenAI',       envKey: 'OPENAI_API_KEY',      baseUrl: 'https://api.openai.com/v1',         hasKey: false, healthy: null,  lastChecked: null, balance: null },
  { id: 'anthropic',   name: 'Anthropic',    envKey: 'ANTHROPIC_API_KEY',   baseUrl: 'https://api.anthropic.com/v1',      hasKey: false, healthy: null,  lastChecked: null, balance: null },
  { id: 'ollama',      name: 'Ollama (本地)', envKey: 'OLLAMA_HOST',        baseUrl: 'http://127.0.0.1:11434',           hasKey: true,  healthy: true,  lastChecked: Date.now() - 60_000, balance: null },
]

export const Route = createFileRoute('/_workspace/settings/models/provider')({
  component: ProviderPage,
})

function ProviderPage() {
  const [providers, setProviders] = useState(MOCK_PROVIDERS)
  const [revealId, setRevealId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftKey, setDraftKey] = useState('')
  const [testing, setTesting] = useState<string | null>(null)

  async function testHealth(id: string) {
    setTesting(id)
    await new Promise((r) => setTimeout(r, 500))
    setProviders((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, healthy: p.hasKey ? Math.random() > 0.3 : false, lastChecked: Date.now() }
          : p,
      ),
    )
    setTesting(null)
  }

  function startEdit(p: Provider) {
    setEditingId(p.id)
    setDraftKey('')
    setRevealId(null)
  }

  function saveKey() {
    if (!editingId) return
    setProviders((prev) =>
      prev.map((p) => (p.id === editingId ? { ...p, hasKey: draftKey.length > 0 } : p)),
    )
    setEditingId(null)
    setDraftKey('')
  }

  function clearKey(id: string) {
    if (!confirm('确定清除该厂商的 API key?')) return
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, hasKey: false, healthy: false, balance: null } : p)))
  }

  return (
    <div className="space-y-4" data-testid="provider-page">
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
                      placeholder="sk-... 粘贴到 .env 或直接保存"
                      className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100 font-mono"
                      data-testid={`key-input-${p.id}`}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setRevealId(isRevealed ? null : p.id)}>
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </Button>
                    <Button size="sm" onClick={saveKey} data-testid={`key-save-${p.id}`}>
                      保存
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingId(null)}>
                      取消
                    </Button>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2">
                    <code className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-300 font-mono flex items-center">
                      {p.hasKey ? (isRevealed ? p.envKey + ' (mock 显示)' : '••••••••••••••••') : '未配置'}
                    </code>
                    <Button variant="ghost" size="sm" onClick={() => setRevealId(isRevealed ? null : p.id)} disabled={!p.hasKey}>
                      {isRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => startEdit(p)} data-testid={`key-edit-${p.id}`}>
                      {p.hasKey ? '更换' : '配置'}
                    </Button>
                    {p.hasKey && (
                      <Button variant="ghost" size="sm" onClick={() => clearKey(p.id)}>
                        <Trash2 size={12} />
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
                      <span className="text-red-400">{p.hasKey ? '不可达' : '凭证缺失'}</span>
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
        ℹ️ 凭证实际存到 packages/backend/.env (Track A 等老板提供真 key)。本 UI 暂为 mock, 真实保存路径: POST /api/v1/settings/provider/:id
      </p>
    </div>
  )
}
