// apps/web/src/routes/_workspace.settings.admin.tsx · Admin 审计日志 + Secret 管理
// 接入 /api/v1/audit/* 和 /api/v1/secrets/*
// 仅 admin 角色可见

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Shield,
  Key,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { http, ApiError } from '@/lib/api'

// ─── 审计日志 ─────────────────────────────────────────────────

interface AuditLog {
  id: string
  type: string
  severity: string
  action: string
  user_id: string
  target?: string
  args_json?: string
  result_summary?: string
  duration_ms?: number
  timestamp: string
}

// ─── Secret ─────────────────────────────────────────────────

interface SecretEntry {
  name: string
  backend: string
  last_used_at?: string
}

export function AdminPage() {
  const [activeSection, setActiveSection] = useState<'audit' | 'secrets'>('audit')

  // Audit state
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)

  // Secrets state
  const [secrets, setSecrets] = useState<SecretEntry[]>([])
  const [secretsLoading, setSecretsLoading] = useState(true)
  const [secretsError, setSecretsError] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null)

  // Load audit logs
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLogsLoading(true)
      setLogsError(null)
      try {
        const res = await http.get<{ logs: AuditLog[] }>('/api/v1/audit/logs')
        if (!cancelled) setLogs(res.logs ?? [])
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setLogsError('需要 Admin 权限才能查看审计日志')
          } else {
            setLogsError((e as Error).message)
          }
        }
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    }
    if (activeSection === 'audit') load()
    return () => { cancelled = true }
  }, [activeSection])

  // Load secrets
  useEffect(() => {
    let cancelled = false
    async function load() {
      setSecretsLoading(true)
      setSecretsError(null)
      try {
        const res = await http.get<{ secrets: SecretEntry[] }>('/api/v1/secrets')
        if (!cancelled) setSecrets(res.secrets ?? [])
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
            setSecretsError('需要 Admin 权限才能查看 Secret')
          } else {
            setSecretsError((e as Error).message)
          }
        }
      } finally {
        if (!cancelled) setSecretsLoading(false)
      }
    }
    if (activeSection === 'secrets') load()
    return () => { cancelled = true }
  }, [activeSection])

  async function handleDeleteSecret(name: string) {
    if (!window.confirm(`确认删除 Secret "${name}"？此操作不可撤销。`)) return
    setDeleteBusy(name)
    try {
      await http.delete(`/api/v1/secrets/${encodeURIComponent(name)}`)
      setSecrets((s) => s.filter((x) => x.name !== name))
    } catch (e) {
      alert(`删除失败: ${(e as Error).message}`)
    } finally {
      setDeleteBusy(null)
    }
  }

  const SEVERITY_COLORS: Record<string, string> = {
    INFO: 'text-semantic-info bg-semantic-info/10',
    WARN: 'text-semantic-warning bg-semantic-warning/10',
    ERROR: 'text-semantic-danger bg-semantic-danger/10',
  }

  return (
    <div className="space-y-4" data-testid="admin-page">
      {/* Section tabs */}
      <div className="flex gap-2">
        <Button
          variant={activeSection === 'audit' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('audit')}
          className="gap-1.5"
        >
          <Shield size={13} />
          审计日志
        </Button>
        <Button
          variant={activeSection === 'secrets' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => setActiveSection('secrets')}
          className="gap-1.5"
        >
          <Key size={13} />
          Secret 管理
        </Button>
      </div>

      {/* Audit Logs */}
      {activeSection === 'audit' && (
        <Card className="bg-neutral-900/50 border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-neutral-200 flex items-center gap-2">
              <Shield size={14} className="text-brand" />
              审计日志 ({logs.length})
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setActiveSection('audit')}>
              <RefreshCw size={12} />
            </Button>
          </div>

          {logsLoading && (
            <div className="flex items-center gap-2 text-neutral-400 text-xs py-4">
              <Loader2 size={14} className="animate-spin" /> 加载审计日志...
            </div>
          )}

          {logsError && (
            <div className="p-3 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-xs text-semantic-danger">
              ⚠ {logsError}
            </div>
          )}

          {!logsLoading && !logsError && logs.length === 0 && (
            <div className="text-xs text-neutral-500 py-4">暂无审计日志</div>
          )}

          <div className="space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="bg-neutral-800/50 rounded p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SEVERITY_COLORS[log.severity] || 'text-neutral-400 bg-neutral-700'}`}>
                      {log.severity}
                    </span>
                    <span className="font-mono text-neutral-300">{log.action}</span>
                  </div>
                  <span className="text-neutral-500">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                </div>
                <div className="text-neutral-400">
                  <span className="text-neutral-500">用户:</span> {log.user_id}
                  {log.target && (
                    <>
                      <span className="text-neutral-600"> → </span>
                      <span className="font-mono">{log.target}</span>
                    </>
                  )}
                </div>
                {log.result_summary && (
                  <div className="text-neutral-500">结果: {log.result_summary}</div>
                )}
                {log.duration_ms !== undefined && (
                  <div className="text-neutral-600">耗时: {log.duration_ms}ms</div>
                )}
                {log.args_json && (
                  <details>
                    <summary className="cursor-pointer text-neutral-500 hover:text-neutral-300">查看参数</summary>
                    <pre className="mt-1 text-[10px] text-neutral-500 overflow-auto max-h-24 bg-neutral-900 p-2 rounded">
                      {(() => { try { return JSON.stringify(JSON.parse(log.args_json), null, 2) } catch { return log.args_json } })()}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Secrets Management */}
      {activeSection === 'secrets' && (
        <Card className="bg-neutral-900/50 border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-neutral-200 flex items-center gap-2">
              <Key size={14} className="text-brand" />
              Secret 管理 ({secrets.length})
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setActiveSection('secrets')}>
              <RefreshCw size={12} />
            </Button>
          </div>

          {secretsLoading && (
            <div className="flex items-center gap-2 text-neutral-400 text-xs py-4">
              <Loader2 size={14} className="animate-spin" /> 加载 Secrets...
            </div>
          )}

          {secretsError && (
            <div className="p-3 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-xs text-semantic-danger">
              ⚠ {secretsError}
            </div>
          )}

          {!secretsLoading && !secretsError && secrets.length === 0 && (
            <div className="text-xs text-neutral-500 py-4">暂无已注册的 Secret</div>
          )}

          <div className="space-y-2">
            {secrets.map((s) => (
              <div key={s.name} className="flex items-center justify-between bg-neutral-800/50 rounded p-3 text-xs">
                <div className="flex items-center gap-3">
                  <Key size={12} className="text-amber-400/60" />
                  <div>
                    <div className="font-mono text-neutral-200">{s.name}</div>
                    <div className="text-neutral-500">
                      后端: {s.backend}
                      {s.last_used_at && ` · 最后使用: ${new Date(s.last_used_at).toLocaleString()}`}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-semantic-danger hover:bg-semantic-danger/10"
                  disabled={deleteBusy === s.name}
                  onClick={() => handleDeleteSecret(s.name)}
                >
                  {deleteBusy === s.name ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Trash2 size={12} />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
