// apps/web/src/routes/_workspace.settings.models.multimodal.tsx · Track C.3 (2026-06-15)
// 多模态模型路由 (图像 / 视频 / 音频 / TTS)
// 5 类能力分组, 每模型: provider + endpoint + 凭证 + 健康状态

import { createFileRoute } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Image as ImageIcon, Video, Volume2, Mic, Music2, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react'
import { useState } from 'react'

type Modality = 'image' | 'video' | 'audio' | 'tts' | 'music'

interface MultimodalModel {
  id: string
  name: string
  provider: string
  endpoint: string
  cost: string
  capability: Modality
  healthy: boolean | null  // null = 未测
}

const ICONS: Record<Modality, typeof ImageIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Mic,
  tts: Volume2,
  music: Music2,
}

const MOCK_MODELS: MultimodalModel[] = [
  // 图像
  { id: 'sd-xl', name: 'Stable Diffusion XL', provider: '自部署 ComfyUI', endpoint: 'http://comfyui:8188', cost: '$0.002/张', capability: 'image', healthy: true },
  { id: 'flux-dev', name: 'FLUX.1-dev', provider: 'Replicate', endpoint: 'https://api.replicate.com', cost: '$0.025/张', capability: 'image', healthy: null },
  { id: 'dall-e-3', name: 'DALL-E 3', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', cost: '$0.04/张', capability: 'image', healthy: false },
  // 视频
  { id: 'pixelle', name: 'Pixelle 视频引擎', provider: '自部署 (Track B 9108)', endpoint: 'http://127.0.0.1:9108', cost: '免费 (本地)', capability: 'video', healthy: true },
  { id: 'sora', name: 'Sora', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', cost: '$0.10/秒', capability: 'video', healthy: false },
  // 音频
  { id: 'whisper', name: 'Whisper Large-v3', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', cost: '$0.006/分', capability: 'audio', healthy: false },
  // TTS
  { id: 'tts-1', name: 'OpenAI TTS-1', provider: 'OpenAI', endpoint: 'https://api.openai.com/v1', cost: '$15/1M 字符', capability: 'tts', healthy: false },
  { id: 'elevenlabs', name: 'ElevenLabs', provider: 'ElevenLabs', endpoint: 'https://api.elevenlabs.io', cost: '$0.30/1K 字符', capability: 'tts', healthy: null },
  // 音乐
  { id: 'suno', name: 'Suno v4', provider: 'Suno', endpoint: 'https://api.suno.ai', cost: '$10/月', capability: 'music', healthy: false },
]

const MODALITY_LABEL: Record<Modality, string> = {
  image: '🖼️ 图像',
  video: '🎬 视频',
  audio: '🎙️ 音频',
  tts: '🔊 TTS',
  music: '🎵 音乐',
}

export const Route = createFileRoute('/_workspace/settings/models/multimodal')({
  component: MultimodalModelsPage,
})

function MultimodalModelsPage() {
  const [models, setModels] = useState(MOCK_MODELS)
  const [testing, setTesting] = useState<string | null>(null)

  const byModality: Record<Modality, MultimodalModel[]> = {
    image: [], video: [], audio: [], tts: [], music: [],
  }
  for (const m of models) {
    byModality[m.capability].push(m)
  }

  async function testHealth(id: string) {
    setTesting(id)
    // 真实路径: POST /api/v1/models/:id/embed 或 health (Track C.3+)
    await new Promise((r) => setTimeout(r, 600))
    setModels((prev) => prev.map((m) => (m.id === id ? { ...m, healthy: Math.random() > 0.3 } : m)))
    setTesting(null)
  }

  return (
    <div className="space-y-4" data-testid="multimodal-models-page">
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
                    {m.healthy === true && <CheckCircle2 size={14} className="text-emerald-400" />}
                    {m.healthy === false && <XCircle size={14} className="text-red-400" />}
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
