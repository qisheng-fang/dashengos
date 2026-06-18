// apps/web/src/components/SidebarStatusStrip.tsx · D1.2 (2026-06-17)
// 仿 Hermes SidebarStatusStrip: 1 色块 + active_sessions + 1 重启按钮

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { http } from '@/lib/api'
import { Loader2, RefreshCw, Cpu, Database, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Status {
  version: string
  uptime_sec: number
  backend: { running: boolean; port: number; pid?: number }
  gateway: { running: boolean; state: 'running' | 'starting' | 'stopped' | 'failed' }
  services: { fastify: any; vite: any; deerflow: any }
  providers: Record<string, { configured: boolean; model: string }>
  provider_summary: { configured: number; total: number }
  python_deps: Record<string, { installed: boolean; version?: string }>
  db: { sessions: number; messages: number; documents: number }
}

export function SidebarStatusStrip() {
  const qc = useQueryClient()
  const [restarting, setRestarting] = useState(false)

  const { data: status, isLoading } = useQuery<Status>({
    queryKey: ['status'],
    queryFn: () => http.get<Status>('/api/status'),
    refetchInterval: 10_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await http.post('/api/system/restart-gateway')
      // 等 3 秒让 daemon 起来
      await new Promise(r => setTimeout(r, 3000))
      qc.invalidateQueries({ queryKey: ['status'] })
    } catch (e) {
      console.error('Restart failed:', e)
    } finally {
      setRestarting(false)
    }
  }

  if (isLoading || !status) {
    return (
      <div className="border-t border-neutral-800 px-3 py-3 text-xs text-neutral-500">
        <Loader2 size={10} className="inline animate-spin mr-1" />
        检测后端状态...
      </div>
    )
  }

  const gatewayOk = status.gateway.running
  const fastifyOk = status.backend.running
  const providerOk = status.provider_summary.configured
  const providerTotal = status.provider_summary.total
  const missingDeps = Object.entries(status.python_deps).filter(([_, v]) => !v.installed).map(([k]) => k)

  return (
    <div className="border-t border-neutral-800 px-3 py-3 text-xs space-y-2 bg-neutral-950/50">
      {/* 1. AI 引擎主状态 */}
      <div className="flex items-center gap-2">
        <span className={cn(
          'w-2 h-2 rounded-full flex-shrink-0',
          gatewayOk && fastifyOk ? 'bg-green-500 animate-pulse' : 'bg-red-500'
        )} />
        <span className="text-neutral-300 flex-1 font-medium">
          {gatewayOk && fastifyOk ? 'AI 引擎在线' : 'AI 引擎异常'}
        </span>
        <span className="text-neutral-500 tabular-nums">{status.db.sessions} 会话</span>
      </div>

      {/* 2. 详细状态行 */}
      <div className="flex items-center gap-3 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1">
          <Cpu size={9} />
          <span className="tabular-nums">{providerOk}/{providerTotal}</span> 模型
        </span>
        <span className="flex items-center gap-1">
          <Database size={9} />
          <span className="tabular-nums">{status.db.messages}</span> 消息
        </span>
        <span className="flex items-center gap-1">
          <Zap size={9} />
          <span className="tabular-nums">{Math.floor(status.uptime_sec / 60)}m</span>
        </span>
      </div>

      {/* 3. 警告条 */}
      {(!gatewayOk || missingDeps.length > 0 || providerOk === 0) && (
        <div className="space-y-1">
          {!gatewayOk && (
            <div className="text-[10px] text-red-400 flex items-center gap-1">
              <span>🔴 DeerFlow 离线</span>
            </div>
          )}
          {providerOk === 0 && (
            <div className="text-[10px] text-red-400">
              🔴 所有 LLM Provider 未配置
            </div>
          )}
          {missingDeps.length > 0 && (
            <div className="text-[10px] text-yellow-400">
              ⚠️ 缺 {missingDeps.length} 个依赖 · <a href="/settings/diagnostics" className="underline hover:text-yellow-300">查看</a>
            </div>
          )}
        </div>
      )}

      {/* 4. 重启按钮 */}
      <button
        onClick={handleRestart}
        disabled={restarting}
        className={cn(
          'w-full text-[10px] py-1.5 border rounded flex items-center justify-center gap-1 transition',
          restarting
            ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/5'
            : 'border-neutral-800 text-neutral-400 hover:text-brand hover:border-brand/50'
        )}
      >
        {restarting ? (
          <>
            <Loader2 size={10} className="animate-spin" />
            重启中...
          </>
        ) : (
          <>
            <RefreshCw size={10} />
            重启 AI 引擎
          </>
        )}
      </button>
    </div>
  )
}
