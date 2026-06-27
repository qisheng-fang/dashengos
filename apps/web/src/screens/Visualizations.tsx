// DaShengOS v8.8 — 数据可视化面板
// 系统仪表板 · 健康拓扑 · 指标趋势

import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { BarChart3, Activity, Server, Cpu, HardDrive, Wifi, RefreshCw, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface HealthNode {
  id: string
  label: string
  category: string
  status: string
  latencyMs: number
  detail: string
}

interface HealthMap {
  overall: string
  score: number
  nodes: HealthNode[]
  edges: Array<{ from: string; to: string; label: string }>
  failures: Array<{ name: string; status: string; suggestion?: string }>
}

interface SysStats {
  cpu: number
  memory: { used: number; total: number; percent: number }
  disk: { used: number; total: number; percent: number }
  uptime: number
}

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  down: XCircle,
  degraded: AlertTriangle,
  warning: AlertTriangle,
}

const STATUS_COLORS: Record<string, string> = {
  healthy: 'text-emerald-400',
  down: 'text-red-400',
  degraded: 'text-amber-400',
  warning: 'text-amber-400',
}

export function Visualizations() {
  const [health, setHealth] = useState<HealthMap | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await http.get<HealthMap>('/api/v1/health/map')
      setHealth(res)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={24} className="animate-spin text-neutral-500" />
    </div>
  )

  if (!health) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <BarChart3 size={48} className="text-neutral-600" />
      <p className="text-neutral-500 text-sm">无法加载仪表板数据</p>
      <button onClick={fetchData} className="text-xs text-brand hover:underline">重试</button>
    </div>
  )

  const catGroups = new Map<string, HealthNode[]>()
  health.nodes.forEach(n => {
    const list = catGroups.get(n.category) || []
    list.push(n)
    catGroups.set(n.category, list)
  })

  const CAT_LABELS: Record<string, string> = {
    core: '核心服务', database: '数据库', llm: 'LLM 链路',
    mcp: 'MCP 服务器', network: '网络', system: '系统资源',
  }

  return (
    <div className="h-full overflow-auto p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
            <BarChart3 size={22} /> 系统仪表板
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            健康评分 {health.score}/100 · {health.nodes.length} 节点 · 自动刷新
          </p>
        </div>
        <button onClick={fetchData} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300">
          <RefreshCw size={13} /> 刷新
        </button>
      </div>

      {/* 评分大卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4 bg-neutral-900/50 border-neutral-800 text-center">
          <div className={cn("text-3xl font-bold", health.score >= 90 ? 'text-emerald-400' : health.score >= 70 ? 'text-amber-400' : 'text-red-400')}>
            {health.score}
          </div>
          <div className="text-xs text-neutral-500 mt-1">健康评分</div>
        </Card>
        <Card className="p-4 bg-neutral-900/50 border-neutral-800 text-center">
          <div className="text-3xl font-bold text-neutral-200">{health.nodes.length}</div>
          <div className="text-xs text-neutral-500 mt-1">监控节点</div>
        </Card>
        <Card className="p-4 bg-neutral-900/50 border-neutral-800 text-center">
          <div className="text-3xl font-bold text-emerald-400">
            {health.nodes.filter(n => n.status === 'healthy').length}
          </div>
          <div className="text-xs text-neutral-500 mt-1">健康</div>
        </Card>
        <Card className="p-4 bg-neutral-900/50 border-neutral-800 text-center">
          <div className="text-3xl font-bold text-red-400">{health.failures.length}</div>
          <div className="text-xs text-neutral-500 mt-1">故障</div>
        </Card>
      </div>

      {/* 分类节点 */}
      <div className="space-y-4">
        {Array.from(catGroups.entries()).map(([cat, nodes]) => {
          const StatusIcon = STATUS_ICONS[nodes.every(n => n.status === 'healthy') ? 'healthy' : 'degraded'] || Activity
          return (
            <Card key={cat} className="bg-neutral-900/50 border-neutral-800 p-4">
              <h3 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
                <StatusIcon size={14} className={STATUS_COLORS[nodes.every(n => n.status === 'healthy') ? 'healthy' : 'degraded']} />
                {CAT_LABELS[cat] || cat}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {nodes.map(n => (
                  <div key={n.id} className={cn(
                    "flex items-center justify-between p-2 rounded text-xs",
                    n.status === 'healthy' ? 'bg-emerald-500/5 border border-emerald-500/10' :
                    n.status === 'down' ? 'bg-red-500/5 border border-red-500/10' :
                    'bg-amber-500/5 border border-amber-500/10'
                  )}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                        n.status === 'healthy' ? 'bg-emerald-400' : n.status === 'down' ? 'bg-red-400' : 'bg-amber-400'
                      )} />
                      <span className="text-neutral-300 truncate">{n.label}</span>
                    </div>
                    <span className="text-neutral-600 shrink-0">{n.latencyMs}ms</span>
                  </div>
                ))}
              </div>
            </Card>
          )
        })}
      </div>

      {/* 故障详情 */}
      {health.failures.length > 0 && (
        <Card className="mt-4 p-4 bg-red-500/5 border-red-500/10">
          <h3 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2">
            <AlertTriangle size={14} /> 故障详情
          </h3>
          {health.failures.map(f => (
            <div key={f.name} className="text-xs text-red-300/80 py-1 border-b border-red-500/10 last:border-0">
              <span className="font-medium">{f.name}</span> — {f.status}
              {f.suggestion && <span className="text-neutral-500 ml-2">💡 {f.suggestion}</span>}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
