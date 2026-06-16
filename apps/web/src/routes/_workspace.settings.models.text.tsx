// apps/web/src/routes/_workspace.settings.models.text.tsx · Track C.3 (2026-06-15)
// 文本模型路由 (LLM 文本对话 / 推理)
// 降级链可视化: 1 个主模型 + N 个备选, 失败自动降级

import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { GripVertical, Plus, Trash2, Loader2 } from 'lucide-react'
import { useState } from 'react'

interface TextModel {
  id: string
  name: string
  provider: string
  context_window: number
  cost_per_1k: number
  available: boolean
}

const MOCK_TEXT_MODELS: TextModel[] = [
  { id: 'ollama:qwen2.5:7b', name: 'Qwen2.5-7B (本地)', provider: 'Ollama', context_window: 32_768, cost_per_1k: 0, available: true },
  { id: 'ollama:qwen2.5:3b', name: 'Qwen2.5-3B (本地)', provider: 'Ollama', context_window: 32_768, cost_per_1k: 0, available: true },
  { id: 'deepseek:deepseek-chat', name: 'DeepSeek-V3', provider: 'DeepSeek', context_window: 65_536, cost_per_1k: 0.0014, available: true },
  { id: 'siliconflow:Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5-72B (SiliconFlow)', provider: 'SiliconFlow', context_window: 131_072, cost_per_1k: 0.004, available: true },
  { id: 'openai:gpt-4o-mini', name: 'GPT-4o-mini', provider: 'OpenAI', context_window: 128_000, cost_per_1k: 0.00015, available: false },
  { id: 'anthropic:claude-sonnet-4', name: 'Claude-Sonnet-4', provider: 'Anthropic', context_window: 200_000, cost_per_1k: 0.003, available: false },
]

export const Route = createFileRoute('/_workspace/settings/models/text')({
  component: TextModelsPage,
})

function TextModelsPage() {
  const [chain, setChain] = useState<string[]>([
    MOCK_TEXT_MODELS[0].id,  // primary
    MOCK_TEXT_MODELS[2].id,  // fallback 1
  ])
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

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
  async function save() {
    setLoading(true)
    setSaved(null)
    // 真实路径: POST /api/v1/settings/models/text (Track C.3+)
    await new Promise((r) => setTimeout(r, 400))
    setLoading(false)
    setSaved('保存成功 (mock, 真实路径 TODO)')
  }

  return (
    <div className="space-y-4" data-testid="text-models-page">
      <Card className="bg-neutral-900/50 border-neutral-800">
        <CardHeader>
          <CardTitle className="text-base text-neutral-100">降级链 (主 → 备选)</CardTitle>
          <p className="text-xs text-neutral-400 mt-1">
            拖动排序, 主模型失败时自动降级到下一个。当前顺序: {chain.length} 步
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {chain.map((id, idx) => {
            const m = MOCK_TEXT_MODELS.find((x) => x.id === id)
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
              {MOCK_TEXT_MODELS.filter((m) => !chain.includes(m.id)).map((m) => (
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
            <Button onClick={save} disabled={loading} data-testid="save-text-models">
              {loading ? <Loader2 size={14} className="animate-spin" /> : null}
              保存降级链
            </Button>
            {saved && <span className="text-xs text-emerald-400">{saved}</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
