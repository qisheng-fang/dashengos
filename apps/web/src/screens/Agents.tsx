// DaShengOS v8.8 — Agent 注册表面板
// 部门视图 · Agent 列表 · 意图路由表

import { useEffect, useState } from 'react'
import { http } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bot, Box, GitBranch, Loader2, Search, Users, Cpu, Zap } from 'lucide-react'

interface AgentItem {
  name: string
  division: string
  description: string
  tools?: string[]
}

interface Division {
  slug: string
  label: string
  icon: string
  color: string
  agents: AgentItem[]
  count: number
}

interface Route {
  intent: string
  department: string
  agent: string
  mode: string
  chain: string[]
}

export function Agents() {
  const [divisions, setDivisions] = useState<Division[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedDiv, setExpandedDiv] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      http.get<{ divisions: any[] }>('/api/v1/agents'),
      http.get<{ routes: Route[] }>('/api/v1/langgraph/orchestrator/routes'),
    ]).then(([divRes, routeRes]) => {
      setDivisions(divRes.divisions || [])
      setRoutes(routeRes.routes || [])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const filtered = divisions.filter(d =>
    !search || d.label.includes(search) || d.agents.some(a => a.name.includes(search))
  )

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 size={24} className="animate-spin text-neutral-500" />
    </div>
  )

  return (
    <div className="h-full overflow-auto p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
            <Users size={22} /> Agent 注册表
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            {divisions.length} 个部门 · {divisions.reduce((s, d) => s + d.count, 0)} 个 Agent · {routes.length} 条路由
          </p>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            placeholder="搜索 Agent..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-3 py-1.5 text-sm bg-neutral-900 border border-neutral-800 rounded-md text-neutral-200 w-48 focus:outline-none focus:border-neutral-600"
          />
        </div>
      </div>

      {/* 路由表 */}
      {routes.length > 0 && (
        <Card className="mb-6 p-4 bg-neutral-900/50 border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-300 mb-3 flex items-center gap-2">
            <GitBranch size={14} /> 意图路由表
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {routes.map(r => (
              <div key={r.intent} className="p-2 rounded bg-neutral-800/50 text-xs">
                <div className="text-neutral-200 font-medium">{r.intent}</div>
                <div className="text-neutral-500">{r.department} → {r.agent}</div>
                <Badge variant="outline" className="mt-1 text-[10px]">{r.mode}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 部门列表 */}
      <div className="space-y-3">
        {filtered.map(div => (
          <Card key={div.slug} className="bg-neutral-900/50 border-neutral-800 overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 hover:bg-neutral-800/30 transition-colors text-left"
              onClick={() => setExpandedDiv(expandedDiv === div.slug ? null : div.slug)}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: div.color + '20' }}>
                  <Box size={16} style={{ color: div.color }} />
                </div>
                <div>
                  <div className="text-sm font-medium text-neutral-200">{div.label}</div>
                  <div className="text-xs text-neutral-500">{div.count} 个 Agent</div>
                </div>
              </div>
              <Badge variant="outline" className="text-[10px]">{div.slug}</Badge>
            </button>
            {expandedDiv === div.slug && (
              <div className="border-t border-neutral-800 px-4 pb-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-3">
                  {div.agents.map(agent => (
                    <div key={agent.name} className="flex items-start gap-2 p-2 rounded bg-neutral-800/30 text-xs">
                      <Cpu size={12} className="text-neutral-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-neutral-200 font-medium truncate">{agent.name}</div>
                        <div className="text-neutral-500 truncate">{agent.description}</div>
                        {agent.tools && agent.tools.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {agent.tools.slice(0, 4).map(t => (
                              <span key={t} className="px-1 py-0.5 rounded bg-neutral-700/50 text-[10px] text-neutral-400">{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-neutral-500 text-sm">暂无 Agent 数据</div>
        )}
      </div>
    </div>
  )
}
