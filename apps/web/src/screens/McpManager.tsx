// apps/web/src/screens/McpManager.tsx · v0.3 Phase 5+ (real backend)
// v6.2: 修复 API 路径 + 自动轮询状态 + 心跳可视化 + 错误恢复
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Download, Settings, Power, FileText, RefreshCw, Trash2, Loader2, Activity, Wifi, WifiOff } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { http } from '@/lib/api'

interface McpServer {
  id: string
  name: string
  status: 'running' | 'restarting' | 'offline' | 'degraded'
  tools: number
  started_at: number | null
  command?: string
  last_health_check?: number
  tools_count?: number
}

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  running: { color: 'bg-semantic-success/20 text-semantic-success', label: '🟢 运行' },
  starting: { color: 'bg-semantic-info/20 text-blue-400', label: '🔵 启动中' },
  restarting: { color: 'bg-semantic-warning/20 text-semantic-warning', label: '🟡 重启中' },
  offline: { color: 'bg-semantic-danger/20 text-semantic-danger', label: '🔴 离线' },
  degraded: { color: 'bg-semantic-warning/20 text-semantic-warning', label: '🟠 降级' },
}

function relTime(ts: number | null): string {
  if (!ts) return '-'
  const d = Date.now() - ts
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m 前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h 前`
  return `${Math.floor(d / 86_400_000)}d 前`
}

export function McpManager() {
  const { t } = useTranslation()
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      // v6.2: 先用 /status 获取摘要（无需认证），再用 /servers 获取详情
      const statusRes = await http.get<{ servers: any[]; running: number; offline: number }>('/api/v1/mcp/status')
      if (statusRes.servers && statusRes.servers.length > 0) {
        const mapped: McpServer[] = statusRes.servers.map((s: any) => ({
          id: s.id,
          name: s.name,
          status: s.status || 'offline',
          tools: s.tools_count || s.tools || 0,
          started_at: s.last_health_check || null,
          command: s.command,
          last_health_check: s.last_health_check,
        }))
        setServers(mapped)
      } else {
        // Fallback: try /servers endpoint
        try {
          const serversRes = await http.get<{ servers: any[] }>('/api/v1/mcp/servers')
          const mapped: McpServer[] = (serversRes.servers || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            status: s.status || 'offline',
            tools: s.tools_count || 0,
            started_at: s.last_health_check || null,
            command: s.command,
          }))
          setServers(mapped)
        } catch {
          setServers([])
        }
      }
    } catch (e: any) {
      console.warn('[McpManager] Load failed:', e?.message || e)
      setServers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // v6.2: 自动轮询 — 每 15 秒刷新状态
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [])

  async function doAction(id: string, action: 'start' | 'stop') {
    setBusy(id + action)
    try {
      await http.post(`/api/v1/mcp/servers/${id}/${action}`)
      await load()
    } catch (e: any) {
      setError(`操作失败: ${e?.message || e}`)
    } finally {
      setBusy(null)
    }
  }

  // v6.2: 加载工具列表
  async function loadTools(serverId: string) {
    try {
      const res = await http.get<{ tools: Array<{ name: string; description: string }> }>(`/api/v1/mcp/servers/${serverId}/tools`)
      const toolNames = (res.tools || []).map((t: any) => t.name).join(', ')
      alert(`工具列表 (${(res.tools || []).length}): ${toolNames || '无'}`)
    } catch (e: any) {
      setError(`获取工具列表失败: ${e?.message || e}`)
    }
  }

  // v6.2: 计算总体健康状态
  const onlineCount = servers.filter(s => s.status === 'running').length
  const offlineCount = servers.filter(s => s.status === 'offline').length
  const degradedCount = servers.filter(s => s.status === 'degraded').length

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-neutral-100">🔌 {t('mcp.title')}</h1>
            {/* v6.2: 心跳状态指示器 */}
            <div className="flex items-center gap-1 text-xs">
              {onlineCount > 0 && <span className="flex items-center gap-1 text-emerald-400"><Wifi size={12} />{onlineCount}在线</span>}
              {degradedCount > 0 && <span className="flex items-center gap-1 text-amber-400 ml-2"><Activity size={12} />{degradedCount}降级</span>}
              {offlineCount > 0 && <span className="flex items-center gap-1 text-red-400 ml-2"><WifiOff size={12} />{offlineCount}离线</span>}
            </div>
          </div>
          <p className="text-sm text-neutral-400 mt-1">
            {loading ? '加载中...' : `${servers.length} 个 MCP 服务器 · 自动刷新中`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={load} title="手动刷新">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </Button>
          <Button leftIcon={<Plus size={16} />} onClick={() => alert('TODO: add MCP server')}>
            {t('mcp.add')}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger flex items-center justify-between">
          <span>⚠ {error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>关闭</Button>
        </div>
      )}

      <Card className="bg-neutral-900/50 border-neutral-800">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-neutral-400 text-sm">
            <Loader2 size={16} className="animate-spin" /> 加载服务器列表...
          </div>
        ) : servers.length === 0 ? (
          <div className="p-6 text-center text-sm text-neutral-500">
            还没有 MCP 服务器, 点击「添加」创建第一个
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-neutral-800 hover:bg-transparent">
                <TableHead className="text-neutral-400">名称</TableHead>
                <TableHead className="text-neutral-400">状态</TableHead>
                <TableHead className="text-neutral-400">工具数</TableHead>
                <TableHead className="text-neutral-400">上次心跳</TableHead>
                <TableHead className="text-neutral-400 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servers.map((m) => {
                const s = STATUS_BADGE[m.status] ?? STATUS_BADGE.offline
                return (
                  <TableRow key={m.id} className="border-neutral-800 hover:bg-neutral-900/50">
                    <TableCell className="font-medium text-neutral-100">{m.name}</TableCell>
                    <TableCell>
                      <Badge className={s.color}>{s.label}</Badge>
                    </TableCell>
                    <TableCell className="text-neutral-300">{m.tools}</TableCell>
                    <TableCell className="text-neutral-400">{relTime(m.started_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {m.status === 'running' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="工具"
                            onClick={() => loadTools(m.id)}
                          >
                            <FileText size={14} />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="重启"
                          disabled={busy === m.id + 'start'}
                          onClick={() => doAction(m.id, 'start')}
                        >
                          <RefreshCw size={14} className={busy === m.id + 'start' ? 'animate-spin' : ''} />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label="配置" onClick={() => alert(`TODO: configure ${m.id}`)}>
                          <Settings size={14} />
                        </Button>
                        {m.status === 'offline' ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="删除"
                            onClick={() => alert(`TODO: delete ${m.id}`)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="停止"
                            disabled={busy === m.id + 'stop'}
                            onClick={() => doAction(m.id, 'stop')}
                          >
                            <Power size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}
