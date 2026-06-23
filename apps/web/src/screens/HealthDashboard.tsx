// DaShengOS v6.0 — 全局健康监控拓扑图
// 实时显示所有组件状态，节点+连线可视化

import { useEffect, useState, useCallback } from 'react'
import { Activity, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle, RefreshCw, Cpu, Database, Server, Globe, HardDrive } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/lib/auth-store'

interface HealthNode {
  id: string
  label: string
  category: string
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  latencyMs: number
  detail: string
}

interface HealthEdge {
  from: string
  to: string
  label: string
}

interface HealthMap {
  timestamp: number
  overall: string
  score: number
  nodes: HealthNode[]
  edges: HealthEdge[]
  failures: Array<{ name: string; status: string; suggestion?: string }>
}

const categoryIcon: Record<string, React.ReactNode> = {
  core: <Server size={14} />,
  database: <Database size={14} />,
  llm: <Cpu size={14} />,
  mcp: <Activity size={14} />,
  network: <Globe size={14} />,
  system: <HardDrive size={14} />,
}

const categoryColor: Record<string, string> = {
  core: '#6366f1',
  database: '#f59e0b',
  llm: '#ec4899',
  mcp: '#8b5cf6',
  network: '#06b6d4',
  system: '#10b981',
}

const statusColor: Record<string, string> = {
  healthy: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
  unknown: '#6b7280',
}

const statusIcon: Record<string, React.ReactNode> = {
  healthy: <CheckCircle size={16} className="text-emerald-400" />,
  degraded: <AlertTriangle size={16} className="text-amber-400" />,
  down: <XCircle size={16} className="text-red-400" />,
  unknown: <Activity size={16} className="text-neutral-500" />,
}

export function HealthDashboard() {
  const [map, setMap] = useState<HealthMap | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState(0)
  const token = useAuthStore(s => s.accessToken)

  const fetchHealth = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/health/map', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMap(data)
      setLastRefresh(Date.now())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, 15000)
    return () => clearInterval(interval)
  }, [fetchHealth])

  // 自动布局：行×列网格
  const arrangeNodes = (nodes: HealthNode[], cols = 4) => {
    const rows: HealthNode[][] = []
    // 按类别分组
    const byCategory: Record<string, HealthNode[]> = {}
    for (const n of nodes) {
      (byCategory[n.category] ||= []).push(n)
    }
    // 展开
    const ordered: HealthNode[] = []
    for (const cat of ['core','database','llm','mcp','network','system']) {
      if (byCategory[cat]) ordered.push(...byCategory[cat])
    }
    for (let i = 0; i < ordered.length; i += cols) {
      rows.push(ordered.slice(i, i + cols))
    }
    return rows
  }

  return (
    <div className="flex flex-col h-full bg-neutral-950">
      {/* 顶部状态栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-brand" />
          <span className="font-semibold text-neutral-100">全局健康监控</span>
          {map && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              map.overall === 'healthy' ? 'bg-emerald-500/10 text-emerald-400' :
              map.overall === 'degraded' ? 'bg-amber-500/10 text-amber-400' :
              'bg-red-500/10 text-red-400'
            }`}>
              {map.overall === 'healthy' ? '✅ 健康' : map.overall === 'degraded' ? '⚠️ 降级' : '❌ 故障'}
            </span>
          )}
          {map && (
            <span className="text-xs text-neutral-500">
              评分: <span className="font-mono text-neutral-300">{map.score}/100</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh > 0 && (
            <span className="text-xs text-neutral-600">
              上次刷新: {new Date(lastRefresh).toLocaleTimeString()}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={fetchHealth} disabled={loading} className="gap-1">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? '刷新中' : '刷新'}
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <Card className="bg-red-500/5 border-red-500/20 p-4 mb-4">
            <div className="flex items-center gap-2 text-red-400">
              <XCircle size={16} />
              <span className="text-sm">获取健康数据失败: {error}</span>
            </div>
          </Card>
        )}

        {loading && !map && (
          <div className="flex items-center justify-center h-64">
            <RefreshCw size={24} className="animate-spin text-neutral-600" />
          </div>
        )}

        {map && (
          <>
            {/* 故障列表 (始终可见) */}
            {map.failures.length > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                <div className="text-xs font-medium text-red-400 mb-2">
                  ⚠️ 发现 {map.failures.length} 个异常
                </div>
                {map.failures.map((f, i) => (
                  <div key={i} className="text-xs text-neutral-400 flex items-start gap-2 py-0.5">
                    <XCircle size={12} className="text-red-400 mt-0.5 shrink-0" />
                    <span>
                      <span className="text-neutral-300">{f.name}</span>
                      {f.suggestion && <span className="text-amber-400 ml-2">→ {f.suggestion}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 拓扑图: 类别区块 */}
            {arrangeNodes(map.nodes).map((row, ri) => (
              <div key={ri} className="flex flex-wrap gap-3 mb-3">
                {row.map(node => (
                  <Card
                    key={node.id}
                    className="flex-1 min-w-[180px] p-3 border-neutral-800 hover:border-neutral-700 transition-colors cursor-default"
                    style={{ borderLeft: `3px solid ${statusColor[node.status]}` }}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span style={{ color: categoryColor[node.category] }}>
                        {categoryIcon[node.category]}
                      </span>
                      <span className="text-xs font-medium text-neutral-300 truncate flex-1">{node.label}</span>
                      {statusIcon[node.status]}
                    </div>
                    <div className="text-[11px] text-neutral-500 space-y-0.5">
                      <div className="flex justify-between">
                        <span>{node.detail}</span>
                        {node.latencyMs > 0 && (
                          <span className="font-mono text-neutral-600">{node.latencyMs}ms</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-neutral-700">{node.category}</span>
                        <span className="w-16 h-1 rounded-full" style={{ background: statusColor[node.status] }} />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            ))}

            {/* 连线图例 */}
            <div className="mt-4 p-3 rounded-lg bg-neutral-900/50 border border-neutral-800/50">
              <div className="text-[10px] text-neutral-600 mb-2 uppercase tracking-wider">连接拓扑</div>
              <div className="flex flex-wrap gap-2">
                {map.edges.map((e, i) => (
                  <div key={i} className="text-[10px] text-neutral-500 flex items-center gap-1.5">
                    <span className="text-neutral-600">{e.from.replace(/_/g, ' ').slice(0, 12)}</span>
                    <span className="text-neutral-800">→</span>
                    <span className="text-neutral-600">{e.to.replace(/_/g, ' ').slice(0, 12)}</span>
                    <span className="text-neutral-700">({e.label})</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 统计摘要 */}
            <div className="mt-4 grid grid-cols-4 gap-3">
              {(['healthy','degraded','down','unknown'] as const).map(status => {
                const count = map.nodes.filter(n => n.status === status).length
                return (
                  <Card key={status} className="p-3 border-neutral-800 text-center">
                    <div className="text-2xl font-mono font-bold" style={{ color: statusColor[status] }}>
                      {count}
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-1">
                      {status === 'healthy' ? '健康' : status === 'degraded' ? '降级' : status === 'down' ? '故障' : '未知'}
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
