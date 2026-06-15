// apps/web/src/screens/AgentMarket.tsx · v0.3 Phase 4 (sandbox-integrated)
//
// Real agent.list via sandbox-client. Replaces MOCK_AGENTS with
// live data from the Go sandbox daemon (6 default agents).
// Track B.3 (2026-06-15): 合并 3 社媒 Agent (DouyinAgent / XiaohongshuAgent / WechatAgent)
//   从 packages/backend :8000 /api/v1/agents 拉, 跟 sandbox agent.list 合并显示

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Download, RefreshCw, Video, BookOpen, Newspaper } from 'lucide-react'
import { sandboxClient } from '@/lib/sandbox-client'
import type { AgentInfo } from '@/lib/sandbox-types'
import { listSocialAgents, type SocialAgent } from '@/lib/social-media-client'

const CATEGORIES = [
  { value: 'all', label: '全部' },
  { value: 'code', label: '代码' },
  { value: 'research', label: '研究' },
  { value: 'design', label: '设计' },
  { value: 'data', label: '数据' },
  { value: 'security', label: '安全' },
  { value: 'social', label: '社媒' },
  { value: 'custom', label: '自定义' },
] as const

// Track B.3 · 社媒 agent 视觉映射 (跟 packages/backend 3 social agent 对齐)
const SOCIAL_ICONS: Record<string, { icon: typeof Video; color: string }> = {
  DouyinAgent: { icon: Video, color: 'text-pink-400' },
  XiaohongshuAgent: { icon: BookOpen, color: 'text-rose-400' },
  WechatAgent: { icon: Newspaper, color: 'text-emerald-400' },
}

export function AgentMarket() {
  const navigate = useNavigate()
  const [sandboxAgents, setSandboxAgents] = useState<AgentInfo[]>([])
  const [socialAgents, setSocialAgents] = useState<SocialAgent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState<string>('all')

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      // 并行拉 sandbox 6 + social 3
      const tasks: [Promise<any>, Promise<any>] = [
        sandboxClient
          ? sandboxClient.agentList().catch(() => ({ agents: [] }))
          : Promise.resolve({ agents: [] }),
        listSocialAgents().catch(() => []),
      ]
      const [sandboxRes, socialRes] = await Promise.all(tasks)
      setSandboxAgents(sandboxRes.agents || [])
      setSocialAgents(socialRes || [])
    } catch (e: any) {
      setError(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  // 合并 sandbox + social
  type Merged = {
    id: string
    name: string
    description: string
    category: string
    author?: string
    capabilities: string[]
    installed: boolean
    isSocial: boolean
  }
  const merged: Merged[] = [
    ...sandboxAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: ((): string => {
        const catById: Record<string, string> = {
          'code-reviewer': 'code',
          'deep-researcher': 'research',
          'design-assistant': 'design',
          'data-analyst': 'data',
          'security-reviewer': 'security',
          'custom-workflow': 'custom',
        }
        return catById[a.id] || 'custom'
      })(),
      author: a.author,
      capabilities: a.capabilities,
      installed: a.installed,
      isSocial: false,
    })),
    ...socialAgents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      capabilities: a.capabilities,
      installed: true,
      isSocial: true,
    })),
  ]

  const filtered = merged.filter((a) => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase())) return false
    if (activeCat !== 'all' && a.category !== activeCat) return false
    return true
  })

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">🤖 Agent 市场</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {loading ? '加载中...' : `${merged.length} 个 Agent 可用 (${sandboxAgents.length} sandbox + ${socialAgents.length} 社媒)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索 Agent..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 bg-neutral-900 border-neutral-800"
          />
          <Button variant="outline" size="sm" onClick={refresh} leftIcon={<RefreshCw size={14} />}>
            刷新
          </Button>
          <Button variant="outline" size="sm">分类 ▾</Button>
          <Button variant="outline" size="sm">排序 ▾</Button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ 加载失败: {error}
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {CATEGORIES.map((c) => (
          <Button
            key={c.value}
            variant={activeCat === c.value ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveCat(c.value)}
          >
            {c.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((a) => {
          const socialMeta = a.isSocial ? SOCIAL_ICONS[a.id] : null
          const Icon = socialMeta?.icon ?? undefined
          return (
            <Card key={a.id} className="bg-neutral-900/50 border-neutral-800">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base text-neutral-100 flex items-center gap-2">
                    {Icon && <Icon size={16} className={socialMeta?.color} />}
                    {a.name}
                  </CardTitle>
                  {a.isSocial && (
                    <Badge variant="default" className="text-xs bg-brand/20 text-brand">
                      真接入
                    </Badge>
                  )}
                </div>
                {!a.isSocial && a.author && (
                  <p className="text-xs text-neutral-400">@{a.author.replace('@', '')}</p>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-xs text-neutral-300 mb-3 line-clamp-2">{a.description}</p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {a.capabilities.slice(0, 3).map((c) => (
                    <Badge key={c} variant="outline" className="text-xs">
                      {c}
                    </Badge>
                  ))}
                  {a.capabilities.length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{a.capabilities.length - 3}
                    </Badge>
                  )}
                </div>
                {a.isSocial ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full"
                    onClick={() => navigate({ to: '/chats/$id', params: { id: `t_${Date.now()}_${a.id}` } })}
                    data-testid={`use-agent-${a.id}`}
                  >
                    立即使用
                  </Button>
                ) : (
                  <Button
                    variant={a.installed ? 'outline' : 'default'}
                    size="sm"
                    className="w-full"
                    leftIcon={a.installed ? undefined : <Download size={14} />}
                  >
                    {a.installed ? '已安装' : '安装'}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
