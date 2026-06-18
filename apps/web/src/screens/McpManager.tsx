// apps/web/src/screens/McpManager.tsx · v0.3 Phase 5+ (real backend)
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, Download, Settings, Power, FileText, RefreshCw, Trash2, Loader2 } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { http } from '@/lib/api'

interface McpServer {
  id: string
  name: string
  status: 'running' | 'restarting' | 'offline'
  tools: number
  started_at: number | null
}

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  running: { color: 'bg-semantic-success/20 text-semantic-success', label: '🟢 运行' },
  restarting: { color: 'bg-semantic-warning/20 text-semantic-warning', label: '🟡 重启中' },
  offline: { color: 'bg-semantic-danger/20 text-semantic-danger', label: '🔴 离线' },
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
      const res = await http.get<{ servers: McpServer[] }>('/api/v1/mcp/servers')
      setServers(res.servers)
    } catch {
      // 后端不可达时静默 fallback, UI 显示空列表
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function doAction(id: string, action: 'start' | 'stop') {
    setBusy(id + action)
    try {
      await http.post(`/api/v1/mcp/servers/${id}/${action}`)
      await load()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">🔌 {t('mcp.title')}</h1>
          <p className="text-sm text-neutral-400 mt-1">
            {loading ? '加载中...' : `${servers.length} 个 MCP 服务器`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button leftIcon={<Plus size={16} />} onClick={() => alert('TODO: add MCP server')}>
            {t('mcp.add')}
          </Button>
          <Button variant="outline" leftIcon={<Download size={16} />} onClick={() => alert('TODO: from market')}>
            {t('mcp.fromMarket')}
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ {error}
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
                <TableHead className="text-neutral-400">启动时间</TableHead>
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
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="工具"
                          onClick={() => alert(`TODO: list tools for ${m.id}`)}
                        >
                          <FileText size={14} />
                        </Button>
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
