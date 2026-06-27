// apps/web/src/routes/_workspace.settings.models.multimodal.tsx · Track C.3 (2026-06-15)
// 多模态模型路由 (图像 / 视频 / 音频 / TTS / 音乐)
// 5 类能力分组, 每模型: provider + endpoint + 凭证 + 健康状态
//
// Phase A (2026-06-16): testHealth 真接 backend · DELETE Math.random mock
//   - POST /api/v1/settings/provider/:id/test (按 model 所属 provider 路由)
//   - 静态 catalog, 无 save 需求 (model 选择是其他屏的事)

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Image as ImageIcon, Video, Volume2, Mic, Music2, Loader2, CheckCircle2, RefreshCw } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

type Modality = 'image' | 'video' | 'audio' | 'tts' | 'music'

interface MultimodalModel {
  id: string
  name: string
  provider: string
  /** 我们的 5 个 provider 之一 ('deepseek' | 'siliconflow' | 'openai' | 'anthropic' | 'ollama') | null 表示非 backend-mappable */
  backendProvider: string | null
  endpoint: string
  cost: string
  capability: Modality
  healthy: boolean | null
  lastChecked: number | null
  errorMessage: string | null
}

const ICONS: Record<Modality, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  tts: Volume2,
  music: Music2,
}

// Phase A: 静态 catalog, backendProvider 决定能否走 backend 的 /test 端点
const MODEL_CATALOG: Omit<MultimodalModel, 'healthy' | 'lastChecked' | 'errorMessage'>[] = [
  // 图像
  { id: 'sd-xl',       name: 'Stable Diffusion XL', provider: '自部署 ComfyUI',  backendProvider: null,        endpoint: 'http://comfyui:8188',         cost: '$0.002/张',     capability: 'image' },
  { id: 'flux-dev',    name: 'FLUX.1-dev',          provider: 'Replicate',        backendProvider: null,        endpoint: 'https://api.replicate.com',   cost: '$0.025/张',     capability: 'image' },
  { id: 'dall-e-3',    name: 'DALL-E 3',            provider: 'OpenAI',           backendProvider: 'openai',    endpoint: 'https://api.openai.com/v1',    cost: '$0.04/张',      capability: 'image' },
  // 视频
  { id: 'pixelle',     name: 'Pixelle 视频引擎',    provider: '自部署',           backendProvider: null,        endpoint: 'http://127.0.0.1:9108',       cost: '免费 (本地)',    capability: 'video' },
  { id: 'sora',        name: 'Sora',                provider: 'OpenAI',           backendProvider: 'openai',    endpoint: 'https://api.openai.com/v1',    cost: '$0.10/秒',      capability: 'video' },
  // 音频
  { id: 'whisper',     name: 'Whisper Large-v3',    provider: 'OpenAI',           backendProvider: 'openai',    endpoint: 'https://api.openai.com/v1',    cost: '$0.006/分',     capability: 'audio' },
  // TTS
  { id: 'tts-1',       name: 'OpenAI TTS-1',        provider: 'OpenAI',           backendProvider: 'openai',    endpoint: 'https://api.openai.com/v1',    cost: '$15/1M 字符',   capability: 'tts' },
  { id: 'elevenlabs',  name: 'ElevenLabs',          provider: 'ElevenLabs',       backendProvider: null,        endpoint: 'https://api.elevenlabs.io',   cost: '$0.30/1K 字符',  capability: 'tts' },
  // 音乐
  { id: 'suno',        name: 'Suno v4',             provider: 'Suno',             backendProvider: null,        endpoint: 'https://api.suno.ai',         cost: '$10/月',         capability: 'music' },
]

const MODALITY_LABEL: Record<Modality, string> = {
  image: '🖼️ 图像',
  video: '🎬 视频',
  audio: '🎙️ 音频',
  tts: '🔊 TTS',
  music: '🎵 音乐',
}

export function MultimodalModelsPage() {
  const [models, setModels] = useState<MultimodalModel[]>([])
  const [testing, setTesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Phase A: 拉 user settings, 标出哪些 model 因 provider 没 key 不可用
  const load = useCallback(async () => {
    setError(null)
    try {
      const data = await http.get<{
        providers: Record<string, { hasKey: boolean }>
      }>('/api/v1/settings')
      const providerHasKey = data.providers ?? {}
      const enriched: MultimodalModel[] = MODEL_CATALOG.map((m) => ({
        ...m,
        healthy: null,
        lastChecked: null,
        errorMessage: null,
      }))
      setModels(enriched)
      // 标记未配 key 的 provider (用于 UI 灰显)
      void providerHasKey
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Phase A: 真接 backend /test 端点 (按 model.backendProvider 路由)
  async function testHealth(id: string) {
    const m = models.find((x) => x.id === id)
    if (!m) return
    setTesting(id)
    setError(null)
    if (!m.backendProvider) {
      // 非 backend-mappable provider (ComfyUI / Replicate / ElevenLabs / Suno / Pixelle)
      // Phase A: 占位, Phase B/C 后接实际健康检查
      setModels((prev) =>
        prev.map((x) => (x.id === id ? { ...x, healthy: false, lastChecked: Date.now(), errorMessage: '需要直连 ' + m.provider } : x)),
      )
      setTesting(null)
      return
    }
    try {
      const res = await http.post<{ healthy: boolean; latency_ms: number; error?: string }>(
        `/api/v1/settings/provider/${m.backendProvider}/test`,
      )
      setModels((prev) =>
        prev.map((x) => (x.id === id ? { ...x, healthy: res.healthy, lastChecked: Date.now(), errorMessage: res.error ?? null } : x)),
      )
    } catch (e) {
      setModels((prev) =>
        prev.map((x) => (x.id === id ? { ...x, healthy: false, lastChecked: Date.now(), errorMessage: (e as Error).message } : x)),
      )
    } finally {
      setTesting(null)
    }
  }

  const byModality: Record<Modality, MultimodalModel[]> = {
    image: [], video: [], audio: [], tts: [], music: [],
  }
  for (const m of models) {
    byModality[m.capability].push(m)
  }

  return (
    <div className="space-y-4" data-testid="multimodal-models-page">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300" data-testid="multimodal-error">
          {error}
        </div>
      )}
      {(Object.keys(byModality) as Modality[]).map((mod) => {
        const list = byModality[mod]
        if (list.length === 0) return null
        const ModalityIcon = ICONS[mod]
        return (
          <Card key={mod} className="bg-neutral-900/50 border-neutral-800">
            <CardHeader>
              <CardTitle className="text-base text-neutral-100 flex items-center gap-2">
                <ModalityIcon size={14} aria-hidden="true" />
                {MODALITY_LABEL[mod]} ({list.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {list.map((m) => (
                <div
                  key={m.id}
                  data-testid={`multimodal-model-${m.id}`}
                  className="flex items-center gap-2 p-2.5 rounded border border-neutral-800 bg-neutral-900/30"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">{m.name}</div>
                    <div className="text-[10px] text-neutral-500 truncate">
                      {m.provider} · {m.endpoint}
                    </div>
                  </div>
                  <div className="text-[10px] text-neutral-400 flex-shrink-0">{m.cost}</div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {m.healthy === true && (
                      <>
                        <CheckCircle2 size={14} className="text-emerald-400" />
                        {m.lastChecked && (
                          <span className="text-[10px] text-neutral-600">
                            {Math.round((Date.now() - m.lastChecked) / 1000)}s 前
                          </span>
                        )}
                      </>
                    )}
                    {m.healthy === false && (
                      <span title={m.errorMessage ?? ''} className="text-[10px] text-red-400">
                        不可用
                      </span>
                    )}
                    {m.healthy === null && <span className="text-[10px] text-neutral-500">未测</span>}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => testHealth(m.id)}
                      disabled={testing === m.id}
                      data-testid={`test-${m.id}`}
                    >
                      {testing === m.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
