// apps/web/src/components/SidebarDashboard.tsx · 2026-06-20
// 左侧栏底部仪表盘：快捷入口 + 后端状态 + 最近 AI 回复

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { useAuthStore } from '@/lib/auth-store'
import { Image, Globe, FileText, Activity, Cpu, ArrowRight } from 'lucide-react'

const QUICK_INTENTS = [
  { intent: 'generate_model' as const, label: '数字人', desc: 'AI 写实照/商品图', icon: Image, color: 'from-brand/20 to-brand/5' },
  { intent: 'deploy_s2b2c' as const, label: 'S2B2C', desc: '独立站/跨境部署', icon: Globe, color: 'from-emerald-500/20 to-emerald-500/5' },
  { intent: 'marketing_sop' as const, label: '私域SOP', desc: '公众号/社群运营', icon: FileText, color: 'from-blue-500/20 to-blue-500/5' },
]

export function SidebarDashboard() {
  const { setActiveIntent, activeIntent, chatHistory } = useAppStore()
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    const headers: Record<string, string> = { 'Accept': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    fetch('/api/v1/dashboard', { headers })
      .then((r) => setBackendStatus(r.ok ? 'online' : 'offline'))
      .catch(() => setBackendStatus('offline'))
  }, [])

  const recentMsgs = chatHistory.filter((m) => m.role === 'assistant').slice(-2)

  return (
    <div className="mt-auto pt-3 border-t border-neutral-800 space-y-2">
      {/* 标题 */}
      <div className="text-[10px] text-neutral-500 uppercase tracking-wider px-1">
        快捷工作台
      </div>

      {/* 快捷入口 */}
      {QUICK_INTENTS.map((item) => (
        <button
          key={item.intent}
          onClick={() => setActiveIntent(activeIntent === item.intent ? undefined as any : item.intent)}
          className={`group w-full text-left p-2 rounded-lg border transition-all duration-150 ${
            activeIntent === item.intent
              ? 'border-brand/40 bg-brand/10'
              : 'border-neutral-800 bg-neutral-900/40 hover:border-neutral-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <div className={`p-1 rounded ${activeIntent === item.intent ? 'bg-brand/20' : 'bg-neutral-800'} group-hover:bg-brand/10 transition-colors`}>
              <item.icon className="w-3.5 h-3.5 text-brand" />
            </div>
            <span className="text-xs font-medium text-neutral-200">{item.label}</span>
            <ArrowRight className="w-3 h-3 ml-auto text-neutral-700 group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
          </div>
        </button>
      ))}

      {/* 后端状态 */}
      <div className="flex items-center gap-2 px-1 py-1">
        <Activity className="w-3 h-3 text-neutral-600" />
        <span className={`w-1.5 h-1.5 rounded-full ${
          backendStatus === 'online' ? 'bg-green-400' : backendStatus === 'checking' ? 'bg-yellow-400 animate-pulse' : 'bg-red-400'
        }`} />
        <span className="text-[10px] text-neutral-500">
          {backendStatus === 'online' ? '后端在线' : backendStatus === 'checking' ? '检测中' : '离线'}
        </span>
      </div>

      {/* 最近 AI 回复 */}
      {recentMsgs.length > 0 && (
        <div className="p-2 rounded-lg bg-neutral-900/60 border border-neutral-800/50">
          <div className="flex items-center gap-1 mb-1">
            <Cpu className="w-3 h-3 text-neutral-600" />
            <span className="text-[10px] text-neutral-600">最近回复</span>
          </div>
          <p className="text-[10px] text-neutral-500 line-clamp-2 leading-relaxed">
            {recentMsgs[recentMsgs.length - 1]?.content.slice(0, 100)}...
          </p>
        </div>
      )}
    </div>
  )
}
