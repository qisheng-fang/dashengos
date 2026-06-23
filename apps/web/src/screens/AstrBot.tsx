// apps/web/src/screens/AstrBot.tsx · DaShengOS v6.0
import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bot, Loader2, Play, ExternalLink, CheckCircle, Monitor, Download } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

export function AstrBot() {
  const [status, setStatus] = useState<any>(null)
  const [tools, setTools] = useState<any[]>([])
  const [desktopInstalled, setDesktopInstalled] = useState(false)
  const [loading, setLoading] = useState(false)
  const token = useAuthStore(s => s.accessToken)
  const base = import.meta.env.VITE_API_URL || ''

  const refresh = async () => {
    try {
      const r = await fetch(`${base}/api/v1/astrbot/status`)
      const d = await r.json()
      setStatus(d)
      if (d.desktopInstalled !== undefined) setDesktopInstalled(d.desktopInstalled)
    } catch {}
    try {
      const r = await fetch(`${base}/api/v1/astrbot/tools`)
      setTools((await r.json()).tools || [])
    } catch {}
  }

  useEffect(() => { refresh() }, [])

  const launch = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${base}/api/v1/astrbot/launch`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      setStatus((s: any) => ({ ...s, ...d }))
    } catch {}
    setLoading(false)
  }

  const launchDesktop = async () => {
    setLoading(true)
    try {
      const r = await fetch(`${base}/api/v1/astrbot/launch-desktop`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      const d = await r.json()
      if (d.success) alert('AstrBot Desktop 已启动')
      else alert(d.error || '启动失败')
    } catch (e: any) { alert(e.message) }
    setLoading(false)
  }

  return (
    <div className="h-full overflow-auto bg-neutral-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Bot size={22} className="text-emerald-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-100">AstrBot</h1>
            <p className="text-xs text-neutral-400">35K⭐ · 管理面板 :6185 · 桌面端</p>
          </div>
        </div>

        {/* 双卡片：Web 面板 + 桌面端 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Web 管理面板 */}
          <Card className="bg-neutral-900 border-emerald-500/20 border p-5">
            <div className="flex items-center gap-3 mb-3">
              <Monitor size={18} className="text-emerald-400" />
              <h3 className="text-sm font-medium text-neutral-100">Web 管理面板</h3>
            </div>
            <p className="text-xs text-neutral-400 mb-4">端口 6185 · 配置平台/插件/LLM</p>
            <a href="http://localhost:6185" target="_blank" rel="noopener">
              <Button size="sm" className="w-full bg-emerald-600 hover:bg-emerald-700">
                <ExternalLink size={12} className="mr-1" /> 打开面板
              </Button>
            </a>
          </Card>

          {/* 桌面端 */}
          <Card className="bg-neutral-900 border-violet-500/20 border p-5">
            <div className="flex items-center gap-3 mb-3">
              <Download size={18} className="text-violet-400" />
              <h3 className="text-sm font-medium text-neutral-100">AstrBot Desktop</h3>
            </div>
            <p className="text-xs text-neutral-400 mb-4">
              {desktopInstalled ? 'v4.26.0 · Tauri 原生应用' : '123MB · 需要下载'}
            </p>
            <Button 
              size="sm" className="w-full bg-violet-600 hover:bg-violet-700"
              onClick={launchDesktop} disabled={loading || !desktopInstalled}
            >
              <Play size={12} className="mr-1" />
              {desktopInstalled ? '启动桌面端' : '下载中...'}
            </Button>
          </Card>
        </div>

        {/* 后端状态 */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${status?.running ? 'bg-green-400 animate-pulse' : status?.installed ? 'bg-amber-400' : 'bg-neutral-600'}`} />
              <span className="text-sm text-neutral-200">
                {status?.running ? '后端运行中' : status?.installed ? `v${status?.version || '4.x'} 就绪` : '未安装'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={refresh} className="text-xs">刷新</Button>
              <Button size="sm" onClick={launch} disabled={loading || status?.running}>
                {loading ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                <span className="ml-1">启动后端</span>
              </Button>
            </div>
          </div>
        </Card>

        {/* 工具 */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">可用工具 ({tools.length})</h2>
          <div className="space-y-2">
            {tools.map((t, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-neutral-950/50 border border-neutral-800">
                <CheckCircle size={14} className="text-green-400" />
                <span className="text-xs font-mono text-neutral-200">{t.name}</span>
                <span className="text-[10px] text-neutral-500">{t.description}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
