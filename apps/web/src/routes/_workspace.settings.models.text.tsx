// apps/web/src/routes/_workspace.settings.models.text.tsx · Track C.3 (2026-06-15)
// 文本模型路由 (LLM 文本对话 / 推理)
// 降级链可视化: 1 个主模型 + N 个备选, 失败自动降级
//
// Phase A (2026-06-16): chain 真接 backend · DELETE setTimeout mock
//   - GET /api/v1/settings (读 text.chain)
//   - PUT /api/v1/settings/models/text (存)

import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { GripVertical, Plus, Trash2, Loader2 } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

interface TextModel {
  id: string
  name: string
  provider: string
  context_window: number
  cost_per_1k: number
  /** 该 model 是否当前可达 (有 user key 或 env key) */
  available: boolean
}

// Phase A: 静态 model catalog, available 字段由 load 时根据 user hasKey 状态填
const TEXT_MODEL_CATALOG: Omit<TextModel, 'available'>[] = [
  { id: 'ollama:qwen2.5:7b', name: 'Qwen2.5-7B (本地)', provider: 'Ollama', context_window: 32_768, cost_per_1k: 0 },
  { id: 'ollama:qwen2.5:3b', name: 'Qwen2.5-3B (本地)', provider: 'Ollama', context_window: 32_768, cost_per_1k: 0 },
  { id: 'deepseek:deepseek-chat', name: 'DeepSeek-V3', provider: 'DeepSeek', context_window: 65_536, cost_per_1k: 0.0014 },
  { id: 'siliconflow:Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B (SiliconFlow)', provider: 'SiliconFlow', context_window: 131_072, cost_per_1k: 0.004 },
  { id: 'openai:gpt-4o-mini', name: 'GPT-4o-mini', provider: 'OpenAI', context_window: 128_000, cost_per_1k: 0.00015 },
  { id: 'anthropic:claude-sonnet-4', name: 'Claude-Sonnet-4', provider: 'Anthropic', context_window: 200_000, cost_per_1k: 0.003 },
]

// provider id 从 model id 解析 (前缀: deepseek: / siliconflow: / ollama: / openai: / anthropic:)
function providerFromModelId(modelId: string): string {
  return modelId.split(':')[0] ?? 'unknown'
}

export const Route = createFileRoute('/_workspace/settings/models/text')({
  component: TextModelsPage,
})

function TextModelsPage() {
  const [models, setModels] = useState<TextModel[]>([])
  const [chain, setChain] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Phase A: 拉 server 端 settings (chain + provider hasKey 状态)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await http.get<{
        providers: Record<string, { hasKey: boolean }>
        text: { chain?: string[] }
      }>('/api/v1/settings')
      const providerHasKey = data.providers ?? {}
      // 拼出 catalog + available (按 user 是否有 key)
      const enriched: TextModel[] = TEXT_MODEL_CATALOG.map((m) => {
        const p = providerFromModelId(m.id)
        const hasKey = providerHasKey[p]?.hasKey ?? false
        // Ollama 是本地 (没 key 概念),只要 catalog 在就 available
        const isLocal = p === 'ollama'
        return { ...m, available: isLocal || hasKey }
      })
      setModels(enriched)
      setChain(data.text?.chain ?? [enriched[0]?.id, enriched[2]?.id].filter(Boolean) as string[])
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function moveUp(idx: number) {
    if (idx === 0) return
    setChain((c) => {
      const next = [...c]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }
  function moveDown(idx: number) {
    if (idx === chain.length - 1) return
    setChain((c) => {
      const next = [...c]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }
  function remove(idx: number) {
    setChain((c) => c.filter((_, i) => i !== idx))
  }
  function add(modelId: string) {
    if (!chain.includes(modelId)) {
      setChain((c) => [...c, modelId])
    }
  }

  // Phase A: 真 PUT chain 到 backend
  async function save() {
    if (chain.length === 0) return
    setSaving(true)
    setSaved(null)
    setError(null)
    try {
      await http.put('/api/v1/settings/models/text', { chain })
      setSaved('已保存')
      setTimeout(() => setSaved(null), 2000)
    } catch (e) {
      setError(`保存失败: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="text-models-page">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300" data-testid="text-models-error">
          {error}
        </div>
      )}
      <Card className="bg-neutral-900/50 border-neutral-800">
        <CardHeader>
          <CardTitle className="text-base text-neutral-100">降级链 (主 → 备选)</CardTitle>
          <p className="text-xs text-neutral-400 mt-1">
            拖动排序, 主模型失败时自动降级到下一个。当前顺序: {chain.length} 步
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-neutral-500" data-testid="text-models-loading">
              <Loader2 size={12} className="animate-spin" /> 加载中...
            </div>
          ) : (
            <>
              {chain.map((id, idx) => {
                const m = models.find((x) => x.id === id)
                if (!m) return null
                return (
                  <div
                    key={id}
                    data-testid={`chain-row-${idx}`}
                    className="flex items-center gap-2 p-2.5 rounded border border-neutral-800 bg-neutral-900/30"
                  >
                    <GripVertical size={12} className="text-neutral-600" />
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/20 text-brand text-xs font-bold flex items-center justify-center">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-neutral-100 truncate">{m.name}</div>
                      <div className="text-[10px] text-neutral-500">
                        {m.provider} · {(m.context_window / 1000).toFixed(0)}K ctx · ${m.cost_per_1k}/1k
                      </div>
                    </div>
                    {!m.available && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-semantic-warning/20 text-semantic-warning">
                        凭证缺失
                      </span>
                    )}
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="sm" onClick={() => moveUp(idx)} disabled={idx === 0}>
                        ↑
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => moveDown(idx)} disabled={idx === chain.length - 1}>
                        ↓
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => remove(idx)} disabled={chain.length === 1}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                )
              })}

              {/* 添加新模型 */}
              <div className="pt-2 border-t border-neutral-800">
                <Label className="text-xs text-neutral-400">添加模型到降级链:</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {models.filter((m) => !chain.includes(m.id)).map((m) => (
                    <Button
                      key={m.id}
                      variant="outline"
                      size="sm"
                      onClick={() => add(m.id)}
                      leftIcon={<Plus size={12} />}
                      data-testid={`add-model-${m.id}`}
                    >
                      {m.name}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Button onClick={save} disabled={saving || chain.length === 0} data-testid="save-text-models">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  保存降级链
                </Button>
                {saved && <span className="text-xs text-emerald-400">{saved}</span>}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
