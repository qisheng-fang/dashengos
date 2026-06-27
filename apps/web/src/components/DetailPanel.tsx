// DaShengOS v8.8 — 右侧详情面板
// 记忆状态 · 工具调用 · Agent 输出 · 会话信息

import { useEffect, useState, useCallback } from 'react'
import { X, Brain, Wrench, Activity, FileText, RefreshCw, Loader2, Database, Clock, Star } from 'lucide-react'
import { http } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'

interface MemoryEntry {
  id: number
  category: string
  summary: string
  created_at: number
  access_count: number
}

interface ToolTrace {
  id: string
  tool_name: string
  status: string
  duration_ms: number
  created_at: number
}

interface PanelProps {
  open: boolean
  onClose: () => void
  sessionId?: string
}

const CAT_LABELS: Record<string, string> = {
  preference: '偏好', decision: '决策', fact: '事实',
  insight: '洞察', task_pattern: '模式', skill_candidate: '技能候选',
}

const CAT_COLORS: Record<string, string> = {
  preference: 'text-purple-400 bg-purple-500/10',
  decision: 'text-amber-400 bg-amber-500/10',
  fact: 'text-blue-400 bg-blue-500/10',
  insight: 'text-emerald-400 bg-emerald-500/10',
  task_pattern: 'text-cyan-400 bg-cyan-500/10',
  skill_candidate: 'text-pink-400 bg-pink-500/10',
}

export function DetailPanel({ open, onClose, sessionId }: PanelProps) {
  const token = useAuthStore(s => s.accessToken)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [toolTraces, setToolTraces] = useState<ToolTrace[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'memory' | 'tools' | 'info'>('memory')

  const fetchData = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const [memRes, toolRes] = await Promise.all([
        http.get<{ memories?: MemoryEntry[]; items?: MemoryEntry[] }>('/api/v1/memory'),
        http.get<{ traces?: ToolTrace[]; items?: ToolTrace[] }>('/api/v1/tool-traces?limit=10'),
      ])
      setMemories(memRes.memories || memRes.items || [])
      setToolTraces(toolRes.traces || toolRes.items || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (open) fetchData()
  }, [open, fetchData])

  if (!open) return null

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const formatAge = (ts: number) => {
    const sec = Math.floor((Date.now() - ts) / 1000)
    if (sec < 60) return `${sec}s`
    if (sec < 3600) return `${Math.floor(sec / 60)}m`
    return `${Math.floor(sec / 3600)}h`
  }

  return (
    <div className={cn(
      "w-[320px] bg-[var(--bg-secondary)] border-l border-[var(--border)] flex flex-col flex-shrink-0 transition-all duration-200",
      open ? 'translate-x-0' : 'translate-x-full'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">详情面板</span>
        <div className="flex items-center gap-1">
          <button onClick={fetchData} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]" title="刷新">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {([
          { id: 'memory' as const, icon: Brain, label: '记忆' },
          { id: 'tools' as const, icon: Wrench, label: '工具' },
          { id: 'info' as const, icon: Activity, label: '会话' },
        ]).map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs transition-colors",
              activeTab === t.id
                ? 'text-[var(--brand)] border-b-2 border-[var(--brand)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-soft)]'
            )}>
            <t.icon size={12} />{t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={20} className="animate-spin text-[var(--text-muted)]" />
          </div>
        ) : activeTab === 'memory' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2">
              <Database size={12} />
              <span>{memories.length} 条记忆</span>
            </div>
            {memories.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-8 text-center">暂无记忆数据</p>
            ) : (
              memories.slice(0, 20).map(m => (
                <div key={m.id} className="p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={cn("px-1.5 py-0.5 rounded text-[10px]", CAT_COLORS[m.category] || 'text-neutral-400 bg-neutral-500/10')}>
                      {CAT_LABELS[m.category] || m.category}
                    </span>
                    <span className="text-[var(--text-muted)] flex items-center gap-1">
                      <Clock size={10} />{formatAge(m.created_at)}
                    </span>
                  </div>
                  <p className="text-[var(--text-soft)] leading-relaxed line-clamp-2">{m.summary}</p>
                </div>
              ))
            )}
          </div>
        ) : activeTab === 'tools' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2">
              <Wrench size={12} />
              <span>{toolTraces.length} 次工具调用</span>
            </div>
            {toolTraces.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-8 text-center">暂无工具调用记录</p>
            ) : (
              toolTraces.slice(0, 20).map(t => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      t.status === 'success' ? 'bg-emerald-400' : t.status === 'error' ? 'bg-red-400' : 'bg-amber-400'
                    )} />
                    <span className="text-[var(--text-soft)] font-mono text-[11px]">{t.tool_name}</span>
                  </div>
                  <span className="text-[var(--text-muted)]">{t.duration_ms}ms</span>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <div className="text-[var(--text-muted)] mb-1">会话 ID</div>
              <code className="text-[var(--text-soft)] text-[11px]">{sessionId || '未选择'}</code>
            </div>
            <div className="p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <div className="text-[var(--text-muted)] mb-1">后端状态</div>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> 在线
              </span>
            </div>
            <div className="p-2 rounded bg-[var(--bg-tertiary)] border border-[var(--border)]">
              <div className="text-[var(--text-muted)] mb-1">记忆统计</div>
              <span className="text-[var(--text-soft)]">{memories.length} 条记忆</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
