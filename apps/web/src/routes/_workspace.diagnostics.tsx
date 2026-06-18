// apps/web/src/routes/_workspace.diagnostics.tsx · D2.2 (2026-06-17)
// 仿 Hermes doctor UI: 14 章节 + 色块 + 修法 + --fix 一键修

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { http } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, Wrench, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

type Status = 'ok' | 'warn' | 'fail' | 'info'
interface Check { status: Status; text: string; detail?: string; fix?: string }
interface Section { name: string; checks: Check[] }

const iconMap: Record<Status, { icon: any; color: string; bg: string; border: string }> = {
  ok:   { icon: CheckCircle2,    color: 'text-green-400',  bg: 'bg-green-500/5',  border: 'border-green-500/20' },
  warn: { icon: AlertTriangle,   color: 'text-yellow-400', bg: 'bg-yellow-500/5', border: 'border-yellow-500/20' },
  fail: { icon: AlertCircle,      color: 'text-red-400',    bg: 'bg-red-500/5',    border: 'border-red-500/20' },
  info: { icon: Info,             color: 'text-blue-400',   bg: 'bg-blue-500/5',   border: 'border-blue-500/20' },
}

export function DiagnosticsPage() {
  const [fixing, setFixing] = useState(false)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['doctor'],
    queryFn: () => http.get<{ summary: any; sections: Section[]; ts: number }>('/api/doctor'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  })

  const handleFix = async () => {
    setFixing(true)
    try {
      const result: any = await http.post('/api/doctor/fix')
      alert(`✅ 已应用 ${result.fixes?.length || 0} 项修复\n${result.fixes?.map((f: any) => `${f.ok ? '✅' : '❌'} ${f.name}`).join('\n')}`)
      refetch()
    } catch (e: any) {
      alert(`❌ 修复失败: ${e.message}`)
    } finally {
      setFixing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 text-neutral-500">
        <Loader2 className="inline animate-spin mr-2" /> 正在扫描所有服务和依赖...
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">🔍 系统诊断</h1>
          <p className="text-sm text-neutral-400 mt-1">
            <span className="text-green-400">{data.summary.pass} 通过</span> ·
            <span className="text-yellow-400 ml-1">{data.summary.warn} 警告</span> ·
            <span className="text-red-400 ml-1">{data.summary.fail} 失败</span>
            <span className="text-neutral-500 ml-2">/ {data.summary.total} 总计</span>
            <span className="text-neutral-500 ml-3">健康度 {data.summary.score}%</span>
          </p>
        </div>
        <div className="flex gap-2">
          {data.summary.fail > 0 && (
            <Button onClick={handleFix} disabled={fixing} className="bg-yellow-600 hover:bg-yellow-700 text-white">
              {fixing ? <Loader2 size={14} className="animate-spin mr-1" /> : <Wrench size={14} className="mr-1" />}
              一键修复
            </Button>
          )}
          <Button onClick={() => refetch()} disabled={isFetching} variant="outline">
            <RefreshCw size={14} className={cn('mr-1', isFetching && 'animate-spin')} />
            重新扫描
          </Button>
        </div>
      </div>

      {!data.summary.healthy && (
        <Card className="p-4 border-red-500/50 bg-red-500/5">
          <div className="flex items-center gap-2 text-red-300">
            <AlertCircle size={16} />
            <span className="font-semibold">发现 {data.summary.fail} 项阻断</span>
          </div>
          <p className="text-xs text-neutral-400 mt-1">修复后才能让所有功能正常工作</p>
        </Card>
      )}

      {data.sections.map(sec => (
        <Card key={sec.name} className="p-4">
          <h2 className="text-sm font-semibold text-neutral-300 mb-3">{sec.name}</h2>
          <div className="space-y-1.5">
            {sec.checks.map((c, i) => {
              const meta = iconMap[c.status]
              const Icon = meta.icon
              return (
                <div key={i} className={cn('flex items-start gap-2 p-2 rounded border text-sm', meta.bg, meta.border)}>
                  <Icon size={14} className={cn('mt-0.5 flex-shrink-0', meta.color)} />
                  <div className="flex-1 min-w-0">
                    <div className={cn('font-medium', meta.color)}>{c.text}</div>
                    {c.detail && <div className="text-xs text-neutral-500 mt-0.5">{c.detail}</div>}
                    {c.fix && (
                      <div className="text-xs text-neutral-300 mt-1.5 font-mono bg-neutral-900/70 px-2 py-1.5 rounded border border-neutral-800 break-all">
                        <span className="text-yellow-500">$ </span>{c.fix}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ))}

      <Card className="p-3 border-neutral-800 text-[10px] text-neutral-500">
        <div className="flex items-center justify-between">
          <span>扫描时间: {new Date(data.ts).toLocaleString('zh-CN')}</span>
          <span>仿 hermes doctor · 14 章节 · 8 章节已实现</span>
        </div>
      </Card>
    </div>
  )
}
