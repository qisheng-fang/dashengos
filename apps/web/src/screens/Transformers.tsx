// apps/web/src/screens/Transformers.tsx · DaShengOS v6.0
// Hugging Face Transformers — 本地 ML 推理引擎
import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Brain, Loader2, CheckCircle, XCircle, Play, Cpu } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

interface ToolDef {
  name: string
  description: string
  category: string
  riskLevel: string
  parameters: Record<string, any>
}

export function Transformers() {
  const [tools, setTools] = useState<ToolDef[]>([])
  const [status, setStatus] = useState<{ jsAvailable: boolean; pyAvailable: boolean; tools: number; message: string } | null>(null)
  const [selectedTool, setSelectedTool] = useState<string>('')
  const [input, setInput] = useState('')
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const token = useAuthStore((s) => s.accessToken)
  const baseUrl = import.meta.env.VITE_API_URL || ''

  useEffect(() => {
    loadStatus()
    loadTools()
  }, [])

  const loadStatus = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/transformers/status`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) setStatus(await res.json())
    } catch { /* */ }
  }

  const loadTools = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/transformers/tools`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setTools(data.tools || [])
      }
    } catch { /* */ }
  }

  const execute = async () => {
    if (!selectedTool || !input.trim()) return
    setLoading(true)
    setResult('')
    try {
      const res = await fetch(`${baseUrl}/api/v1/transformers/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ tool: selectedTool, args: { text: input, image_path: input, audio_path: input } })
      })
      const data = await res.json()
      setResult(data.success ? data.data || '(空结果)' : `❌ ${data.error}`)
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const categoryIcons: Record<string, string> = {
    nlp: '📝', vision: '👁️', audio: '🎤', multimodal: '🧩'
  }

  return (
    <div className="h-full overflow-auto bg-neutral-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center">
            <Brain size={22} className="text-orange-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-100">Transformers</h1>
            <p className="text-xs text-neutral-400">Hugging Face · 本地 ML 推理引擎</p>
          </div>
        </div>

        {/* Status */}
        {status && (
          <Card className="bg-neutral-900 border-neutral-800 p-4">
            <div className="flex items-center gap-3">
              <Cpu size={18} className={status.pyAvailable ? 'text-green-400' : status.jsAvailable ? 'text-amber-400' : 'text-red-400'} />
              <div>
                <span className="text-sm text-neutral-200">{status.message}</span>
                <span className="text-xs text-neutral-500 ml-2">
                  ({status.tools} 个工具 · JS:{status.jsAvailable ? '✓' : '✗'} Python:{status.pyAvailable ? '✓' : '✗'})
                </span>
              </div>
            </div>
          </Card>
        )}

        {/* Tool Grid */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">ML 工具集</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {tools.map((tool) => (
              <button
                key={tool.name}
                onClick={() => { setSelectedTool(tool.name); setInput(''); setResult('') }}
                className={`text-left p-3 rounded-lg border transition-all ${
                  selectedTool === tool.name
                    ? 'border-orange-400/50 bg-orange-500/10 ring-1 ring-orange-400/30'
                    : 'border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{categoryIcons[tool.category] || '🧠'}</span>
                  <span className="text-xs font-mono text-neutral-200">{tool.name.replace('transformers_', '')}</span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-1">{tool.description}</p>
              </button>
            ))}
          </div>
        </Card>

        {/* Execute */}
        {selectedTool && (
          <Card className="bg-neutral-900 border-neutral-800 p-5">
            <h2 className="text-sm font-semibold text-neutral-200 mb-3">
              执行: <code className="text-orange-400">{selectedTool}</code>
            </h2>
            <div className="flex items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selectedTool.includes('image') ? '图片路径...' : selectedTool.includes('audio') ? '音频路径...' : '输入文本...'}
                className="flex-1 bg-neutral-950 border-neutral-800 text-sm"
                onKeyDown={(e) => e.key === 'Enter' && execute()}
              />
              <Button onClick={execute} disabled={loading || !input.trim()} size="sm">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              </Button>
            </div>
            {result && (
              <div className="mt-3 p-3 rounded bg-neutral-950 border border-neutral-800">
                <pre className="text-xs text-neutral-300 whitespace-pre-wrap font-mono">{result}</pre>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
