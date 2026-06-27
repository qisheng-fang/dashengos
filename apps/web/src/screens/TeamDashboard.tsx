// DaShengOS v6.0 — Team Dashboard · 团队审计面板
// 审计日志 + Cloud 会话 + 策略决策 + PR 工作流

import { useEffect, useState, useCallback } from 'react'
import { Activity, Shield, Cloud, GitPullRequest, AlertTriangle, CheckCircle, XCircle, RefreshCw, FileText } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/lib/auth-store'

interface DashboardOverview {
  audit: { total: number; last24h: number; bySeverity: Array<{ severity: string; count: number }> }
  cloud: { active: number; total: number; sessions: Array<{ id: string; status: string; commands: number; patches: number; age: number }> }
  policy: { rejected: number; cloudRouted: number; toolInvocations: number }
  secrets: { stored: number }
  permissions: { active: number }
}

interface AuditLog {
  id: string; timestamp: number; user_id: string; type: string; severity: string
  action: string; target: string; result_summary: string; duration_ms: number
}

function formatAge(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
  return `${Math.floor(ms / 3600000)}h`
}

export function TeamDashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [prSession, setPrSession] = useState<string>('')
  const [prResult, setPrResult] = useState<string | null>(null)
  const token = useAuthStore(s => s.accessToken)

  const fetchData = useCallback(async () => {
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const [ov, lg] = await Promise.all([
        fetch('/api/v1/dashboard/overview', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
        fetch('/api/v1/dashboard/audit-log?limit=20', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ])
      setOverview(ov)
      setLogs(lg.logs || [])
    } catch (e) {
      console.error('Dashboard fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleCreatePR = async (sessionId: string) => {
    setPrSession(sessionId)
    try {
      const res = await fetch('/api/v1/dashboard/pr/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId, title: `Cloud Runner: ${sessionId.slice(-8)}` }),
      })
      const data = await res.json()
      setPrResult(data.url || `Branch: ${data.branch}, Files: ${data.files?.length || 0}`)
    } catch (e: any) {
      setPrResult(`Failed: ${e.message}`)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><RefreshCw className="animate-spin text-neutral-400" size={32} /></div>
  }

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <Shield size={48} className="text-neutral-600" />
        <p className="text-neutral-400 text-sm">请先登录以查看团队面板</p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">团队面板</h1>
        <Button variant="outline" size="sm" onClick={fetchData}><RefreshCw size={14} className="mr-2" />刷新</Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <div className="flex items-center gap-2 text-blue-400 mb-2"><Activity size={16} /><span className="text-xs text-neutral-400">工具调用 (24h)</span></div>
          <div className="text-2xl font-bold text-white">{overview?.policy.toolInvocations || 0}</div>
        </Card>
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <div className="flex items-center gap-2 text-purple-400 mb-2"><Cloud size={16} /><span className="text-xs text-neutral-400">云端路由</span></div>
          <div className="text-2xl font-bold text-white">{overview?.policy.cloudRouted || 0}</div>
        </Card>
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <div className="flex items-center gap-2 text-red-400 mb-2"><Shield size={16} /><span className="text-xs text-neutral-400">策略拒绝</span></div>
          <div className="text-2xl font-bold text-white">{overview?.policy.rejected || 0}</div>
        </Card>
        <Card className="p-4 bg-neutral-900 border-neutral-800">
          <div className="flex items-center gap-2 text-emerald-400 mb-2"><FileText size={16} /><span className="text-xs text-neutral-400">审计日志</span></div>
          <div className="text-2xl font-bold text-white">{overview?.audit.last24h || 0}</div>
        </Card>
      </div>

      {/* Cloud Sessions */}
      <Card className="p-4 bg-neutral-900 border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2"><Cloud size={18} /> Cloud Runner 会话</h2>
        {overview?.cloud.sessions.length === 0 ? (
          <p className="text-neutral-500 text-sm">暂无活跃会话</p>
        ) : (
          <div className="space-y-2">
            {overview?.cloud.sessions.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-neutral-800 last:border-0">
                <div>
                  <code className="text-xs text-neutral-400">{s.id.slice(-16)}</code>
                  <div className="text-xs text-neutral-500">{s.commands} 命令 · {s.patches} 补丁 · {formatAge(s.age)} 前</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded ${s.status === 'completed' ? 'bg-emerald-900/50 text-emerald-400' : 'bg-blue-900/50 text-blue-400'}`}>
                    {s.status}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => handleCreatePR(s.id)} disabled={prSession === s.id}>
                    <GitPullRequest size={12} className="mr-1" />
                    PR
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {prResult && <div className="mt-2 p-2 bg-neutral-800 rounded text-xs text-neutral-300">{prResult}</div>}
      </Card>

      {/* Audit Log */}
      <Card className="p-4 bg-neutral-900 border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2"><FileText size={18} /> 审计日志</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-neutral-500 text-left border-b border-neutral-800">
                <th className="py-2 pr-4">时间</th>
                <th className="py-2 pr-4">操作</th>
                <th className="py-2 pr-4">目标</th>
                <th className="py-2 pr-4">级别</th>
                <th className="py-2">摘要</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <tr key={log.id} className="border-b border-neutral-800/50 hover:bg-neutral-800/30">
                  <td className="py-2 pr-4 text-neutral-400 text-xs">{new Date(log.timestamp).toLocaleTimeString()}</td>
                  <td className="py-2 pr-4 text-neutral-300 font-mono text-xs">{log.action}</td>
                  <td className="py-2 pr-4 text-neutral-500 text-xs max-w-[120px] truncate">{log.target || '-'}</td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${log.severity === 'ERROR' || log.severity === 'CRITICAL' ? 'bg-red-900/50 text-red-400' : log.severity === 'WARN' ? 'bg-amber-900/50 text-amber-400' : 'bg-neutral-700 text-neutral-400'}`}>
                      {log.severity}
                    </span>
                  </td>
                  <td className="py-2 text-neutral-500 text-xs max-w-[200px] truncate">{log.result_summary || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
