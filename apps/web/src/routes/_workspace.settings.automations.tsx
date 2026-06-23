// apps/web/src/routes/_workspace.settings.automations.tsx · Track C.1 (2026-06-17)
// 定时任务管理 — cron/一次性/间隔 三种触发模式
// API: GET/POST/PUT/DELETE /api/v1/automations

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Plus, Play, Pause, Trash2, Clock, Repeat, Calendar, RefreshCw } from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

interface Automation {
  id: string
  name: string
  description: string
  trigger_type: 'cron' | 'once' | 'interval'
  cron_expr: string | null
  action: string
  params: Record<string, unknown>
  status: 'active' | 'paused' | 'completed' | 'failed'
  last_run_at: number | null
  next_run_at: number | null
  run_count: number
  created_at: number
}

const TEMPLATES = [
  { id:'t1', name:'每日行业早报', desc:'每天8:00自动生成行业早报', action:'report_generate' as const, cron:'0 8 * * *', icon:'📊' },
  { id:'t2', name:'每周运营周报', desc:'每周一9:00生成运营周报', action:'report_generate' as const, cron:'0 9 * * 1', icon:'📈' },
  { id:'t3', name:'社媒早间发布', desc:'每天9:00发布品牌内容', action:'social_publish' as const, cron:'0 9 * * *', icon:'💬' },
  { id:'t4', name:'热点追踪', desc:'每小时抓取行业热搜', action:'content_generate' as const, cron:'0 * * * *', icon:'⚡' },
  { id:'t5', name:'竞品数据采集', desc:'每天10:00采集竞品动态', action:'data_collect' as const, cron:'0 10 * * *', icon:'👁' },
  { id:'t6', name:'周末总结', desc:'每周日18:00总结本周数据', action:'report_generate' as const, cron:'0 18 * * 0', icon:'🕐' },
  { id:'t7', name:'库存预警检查', desc:'每天7:00检查低库存SKU并告警', action:'data_collect' as const, cron:'0 7 * * *', icon:'📦' },
  { id:'t8', name:'广告ROI日报', desc:'每天10:00汇总各渠道广告投放ROI', action:'report_generate' as const, cron:'0 10 * * *', icon:'💰' },
  { id:'t9', name:'客服工单汇总', desc:'每天18:00汇总当日客服工单与解决率', action:'report_generate' as const, cron:'0 18 * * *', icon:'🎧' },
  { id:'t10', name:'SEO关键词监控', desc:'每6小时追踪核心关键词排名变化', action:'data_collect' as const, cron:'0 */6 * * *', icon:'🔍' },
  { id:'t11', name:'社媒评论巡检', desc:'每4小时扫描各平台负面评论并预警', action:'social_publish' as const, cron:'0 */4 * * *', icon:'🛡' },
  { id:'t12', name:'客户生日关怀', desc:'每天9:00筛选当日生日客户并推送优惠', action:'social_publish' as const, cron:'0 9 * * *', icon:'🎂' },
]

const ACTION_LABELS: Record<string, string> = {
  social_publish: '社媒发布',
  content_generate: '内容生成',
  data_collect: '数据采集',
  report_generate: '报告生成',
  custom: '自定义',
}

const TRIGGER_ICONS: Record<string, typeof Clock> = {
  cron: Repeat,
  once: Calendar,
  interval: Clock,
}

export { AutomationsPage as AutomationPage }

function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<Automation> | null>(null)
  const [saving, setSaving] = useState(false)
  const [installedTemplates, setInstalledTemplates] = useState<Set<string>>(new Set)
  const [showTemplates, setShowTemplates] = useState(false)

  async function installTemplate(t: typeof TEMPLATES[0]) {
    try {
      await http.post('/api/v1/automations', {
        name: t.name,
        description: t.desc,
        trigger_type: 'cron',
        cron_expr: t.cron,
        action: t.action,
        params: {},
      })
      setInstalledTemplates(prev => new Set([...prev, t.id]))
      await load()
    } catch (e) {
      setError(`安装模板失败: ${(e as Error).message}`)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await http.get<{ automations: Automation[] }>('/api/v1/automations')
      setAutomations(data.automations ?? [])
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function toggleStatus(a: Automation) {
    const newStatus = a.status === 'active' ? 'paused' : 'active'
    try {
      await http.put(`/api/v1/automations/${a.id}`, { status: newStatus })
      await load()
    } catch (e) {
      setError(`操作失败: ${(e as Error).message}`)
    }
  }

  async function deleteAuto(id: string) {
    if (!confirm('确定删除此定时任务?')) return
    try {
      await http.delete(`/api/v1/automations/${id}`)
      await load()
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`)
    }
  }

  async function triggerNow(id: string) {
    try {
      await http.post(`/api/v1/automations/${id}/trigger`)
      await load()
    } catch (e) {
      setError(`触发失败: ${(e as Error).message}`)
    }
  }

  async function createAutomation() {
    if (!editing?.name || !editing?.action) return
    setSaving(true)
    setError(null)
    try {
      await http.post('/api/v1/automations', {
        name: editing.name,
        description: editing.description ?? '',
        trigger_type: editing.trigger_type ?? 'cron',
        cron_expr: editing.cron_expr ?? null,
        action: editing.action,
        params: editing.params ?? {},
      })
      setEditing(null)
      await load()
    } catch (e) {
      setError(`创建失败: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  const formatTime = (ts: number | null) => {
    if (!ts) return '—'
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatTrigger = (a: Automation) => {
    if (a.trigger_type === 'once') return `一次性: ${a.cron_expr ? new Date(a.cron_expr).toLocaleString('zh-CN') : '—'}`
    if (a.trigger_type === 'interval') return `间隔: ${a.cron_expr ?? '—'}`
    return `Cron: ${a.cron_expr ?? '—'}`
  }

  return (
    <div className="space-y-4 px-4" data-testid="automations-page">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-neutral-100">定时任务</h3>
        <Button size="sm" onClick={() => load()} variant="ghost">
          <RefreshCw size={14} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 size={12} className="animate-spin" /> 加载中...
        </div>
      ) : automations.length === 0 ? (
        <p className="text-xs text-neutral-500">暂无定时任务，点击下方创建</p>
      ) : (
        automations.map((a) => {
          const Icon = TRIGGER_ICONS[a.trigger_type] ?? Clock
          const isActive = a.status === 'active'
          return (
            <Card key={a.id} className="bg-neutral-900/50 border-neutral-800">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Icon size={14} className={isActive ? 'text-emerald-400' : 'text-neutral-500'} />
                  <span className="flex-1 font-medium text-sm text-neutral-100">{a.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                    {ACTION_LABELS[a.action] ?? a.action}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-emerald-900/30 text-emerald-400' : 'bg-yellow-900/30 text-yellow-400'}`}>
                    {isActive ? '运行中' : a.status === 'paused' ? '已暂停' : a.status}
                  </span>
                </div>
                {a.description && <p className="text-[11px] text-neutral-500">{a.description}</p>}
                <div className="text-[10px] text-neutral-600 flex items-center gap-3">
                  <span>{formatTrigger(a)}</span>
                  <span>· 运行 {a.run_count} 次</span>
                  {a.last_run_at && <span>· 上次: {formatTime(a.last_run_at)}</span>}
                </div>
                <div className="flex items-center gap-1 pt-1">
                  <Button size="sm" variant="ghost" onClick={() => toggleStatus(a)} title={isActive ? '暂停' : '启动'}>
                    {isActive ? <Pause size={12} /> : <Play size={12} />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => triggerNow(a.id)} title="手动触发">
                    <Play size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => deleteAuto(a.id)} title="删除">
                    <Trash2 size={12} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}

      {/* 模板区 */}
      <div>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-200 mb-2"
        >
          📋 模板 ({TEMPLATES.length}) {showTemplates ? '▲' : '▼'}
        </button>
        {showTemplates && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {TEMPLATES.map(t => {
              const installed = installedTemplates.has(t.id)
              return (
                <div key={t.id} className="flex items-center gap-4 bg-neutral-900/50 border border-neutral-800 rounded-lg p-3">
                  <span className="text-xl">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-neutral-200 font-medium truncate">{t.name}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{t.desc} · Cron: {t.cron}</div>
                  </div>
                  <button
                    onClick={() => installTemplate(t)}
                    disabled={installed}
                    className={`shrink-0 text-[10px] px-2 py-1 rounded ${
                      installed
                        ? 'text-green-400 bg-transparent cursor-default'
                        : 'text-black bg-[#0df0ff] hover:bg-[#0bc8d8]'
                    }`}
                  >
                    {installed ? '已安装' : '一键安装'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新建表单 */}
      <Card className="bg-neutral-900/50 border-neutral-800">
        <CardHeader>
          <CardTitle className="text-sm text-neutral-100">
            {editing ? '新建定时任务' : '创建新任务'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <>
              <div>
                <Label className="text-xs text-neutral-400">名称</Label>
                <input
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="如: 每日早报发布"
                  className="w-full bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100"
                />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Label className="text-xs text-neutral-400">触发类型</Label>
                  <select
                    value={editing.trigger_type ?? 'cron'}
                    onChange={(e) => setEditing({ ...editing, trigger_type: e.target.value as any })}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100"
                  >
                    <option value="cron">Cron 表达式</option>
                    <option value="interval">间隔</option>
                    <option value="once">一次性</option>
                  </select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs text-neutral-400">
                    {editing.trigger_type === 'cron' ? 'Cron (如: 0 8 * * *)' : editing.trigger_type === 'interval' ? '间隔 (如: 15m / 2h / 1d)' : '时间 (ISO 8601)'}
                  </Label>
                  <input
                    value={editing.cron_expr ?? ''}
                    onChange={(e) => setEditing({ ...editing, cron_expr: e.target.value })}
                    placeholder={editing.trigger_type === 'cron' ? '0 8 * * *' : editing.trigger_type === 'interval' ? '1d' : '2026-06-18T08:00'}
                    className="w-full bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs text-neutral-400">动作</Label>
                <select
                  value={editing.action ?? 'custom'}
                  onChange={(e) => setEditing({ ...editing, action: e.target.value })}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100"
                >
                  <option value="social_publish">社媒发布</option>
                  <option value="content_generate">内容生成</option>
                  <option value="data_collect">数据采集</option>
                  <option value="report_generate">报告生成</option>
                  <option value="custom">自定义</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={createAutomation} disabled={saving || !editing.name}>
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  创建
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(null)}>取消</Button>
              </div>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing({ name: '', trigger_type: 'cron', action: 'social_publish', cron_expr: '0 8 * * *' })}>
              <Plus size={12} /> 新建定时任务
            </Button>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-neutral-400 leading-relaxed">
        💡 Cron 示例: 每天 8:00 = <code>0 8 * * *</code>，每小时 = <code>0 * * * *</code>，每周一 9:00 = <code>0 9 * * 1</code>。
        间隔用如 <code>15m</code> / <code>2h</code> / <code>1d</code>。一次性任务过期自动标记完成。
      </p>
    </div>
  )
}
