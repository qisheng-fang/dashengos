// apps/web/src/screens/OpenDesign.tsx
// Open Design v0.11 — iframe 嵌入 + daemon 自动启停

import { ExternalLink, RotateCw, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState, useEffect } from 'react'
import { useProjectContext } from '@/store/project-context'

const DESIGN_URL = 'http://localhost:3001'
const DESIGN_PATH = '/Users/apple/Documents/Codex/open-design'

export function OpenDesign() {
  const [key, setKey] = useState(0)
  const [daemonStatus, setDaemonStatus] = useState<'checking' | 'starting' | 'ready' | 'error'>('checking')
  const setProject = useProjectContext((s) => s.setProject)

  useEffect(() => {
    setProject({
      id: 'open-design',
      name: 'Open Design',
      path: DESIGN_PATH,
      entryUrl: DESIGN_URL,
    })

    // 自动启动 daemon（如果未运行）
    async function ensureDaemon() {
      try {
        // 检查状态
        const statusRes = await fetch('/api/v1/daemon/status')
        const status = await statusRes.json()
        if (status.running) {
          setDaemonStatus('ready')
          return
        }
        // 启动
        setDaemonStatus('starting')
        const startRes = await fetch('/api/v1/daemon/start', { method: 'POST' })
        const result = await startRes.json()
        if (result.ok) {
          setDaemonStatus('ready')
        } else {
          setDaemonStatus('error')
          console.warn('Daemon start failed:', result.message)
        }
      } catch {
        setDaemonStatus('error')
      }
    }
    ensureDaemon()
  }, [setProject])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-900 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Open Design</span>
          <span className="text-xs text-neutral-500">v0.11</span>
          {daemonStatus === 'checking' && <Loader2 size={12} className="animate-spin text-amber-400" />}
          {daemonStatus === 'starting' && <span className="text-xs text-amber-400">daemon 启动中...</span>}
          {daemonStatus === 'ready' && <span className="text-xs text-emerald-400">● 457 插件</span>}
          {daemonStatus === 'error' && <span className="text-xs text-red-400">⚠ daemon 离线</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setKey(k => k + 1)} title="刷新">
            <RotateCw size={14} />
          </Button>
          <a href={DESIGN_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" title="新窗口打开">
              <ExternalLink size={14} />
            </Button>
          </a>
        </div>
      </div>
      {daemonStatus === 'error' ? (
        <div className="flex-1 flex items-center justify-center text-neutral-500">
          <div className="text-center">
            <p className="text-lg mb-2">⚠️ Open Design daemon 未启动</p>
            <p className="text-sm mb-4">请确认后端服务正常运行后重试</p>
            <Button variant="outline" size="sm" onClick={() => { setDaemonStatus('checking'); setKey(k => k + 1); }}>
              重试
            </Button>
          </div>
        </div>
      ) : (
        <iframe
          key={key}
          src={DESIGN_URL}
          className="flex-1 w-full border-0"
          title="Open Design"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      )}
    </div>
  )
}
