// apps/web/src/screens/SkillsMarket.tsx · Phase B.1 Skill Marketplace
// 技能市场: 浏览/搜索/安装/卸载, "已安装" / "市场" 双 Tab
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Download, Trash2, RefreshCw, Loader2, Star,
  Puzzle, ExternalLink, Check, AlertCircle,
} from 'lucide-react'
import { http } from '@/lib/api'

interface SkillEntry {
  id: string
  name: string
  description: string
  category: string
  version: string
  author: string
  installs: number
  rating: number
  manifest: {
    version: string
    author: string
    category: string
    tags: string[]
    capabilities: string[]
    required_config: Record<string, { type: string; label: string; default?: string }>
  }
  installed: boolean
  installed_version: string | null
}

interface CategoryItem {
  value: string
  label: string
}

const CATEGORY_LABELS: Record<string, string> = {
  all: '全部',
  office: '办公协作',
  development: '开发工具',
  social: '社媒运营',
  design: '视觉设计',
  data: '数据分析',
  automation: '自动化',
  content: '内容创作',
  marketing: '营销推广',
  integration: '系统集成',
  strategy: '商业策略',
  custom: '通用工具',
}

export function SkillsMarket() {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [categories, setCategories] = useState<CategoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeCat, setActiveCat] = useState('all')
  const [activeTab, setActiveTab] = useState<'market' | 'installed'>('market')
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (activeCat !== 'all') params.set('category', activeCat)
      const qs = params.toString()
      const res = await http.get<{ skills: SkillEntry[]; categories: CategoryItem[] }>(
        `/api/v1/skills/marketplace${qs ? `?${qs}` : ''}`,
      )
      setSkills(res.skills || [])
      setCategories(res.categories || [])
    } catch (e) {
      setError((e as Error).message || '加载市场失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [search, activeCat]) // eslint-disable-line react-hooks/exhaustive-deps

  // 首次挂载时也加载（确保不依赖 search/activeCat 初始值）
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstall = async (skillId: string, version?: string) => {
    setActionBusy(skillId)
    setError(null)
    try {
      // 乐观更新：先标记为已安装，失败时回滚
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: true, installed_version: version || s.version } : s)),
      )
      await http.post('/api/v1/skills/install', { skill_id: skillId, version })
      // 服务端确认成功，重新加载确保状态一致
      await load()
    } catch (e) {
      // 回滚：恢复为未安装
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: false, installed_version: null } : s)),
      )
      const msg = (e as Error).message || '安装失败'
      setError(`⚠️ ${msg} — 请检查是否已登录或网络连接`)
      console.error('[SkillsMarket] 安装失败:', skillId, e)
    } finally {
      setActionBusy(null)
    }
  }

  const handleUninstall = async (skillId: string) => {
    if (!window.confirm('确定要卸载该技能吗？')) return
    setActionBusy(skillId)
    setError(null)
    try {
      // 乐观更新：先标记为未安装
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: false, installed_version: null } : s)),
      )
      await http.post(`/api/v1/skills/${encodeURIComponent(skillId)}/uninstall`)
      await load()
    } catch (e) {
      // 回滚
      setSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: true, installed_version: s.version } : s)),
      )
      setError(`⚠️ 卸载失败: ${(e as Error).message}`)
      console.error('[SkillsMarket] 卸载失败:', skillId, e)
    } finally {
      setActionBusy(null)
    }
  }

  const filtered = activeTab === 'installed'
    ? skills.filter((s) => s.installed)
    : skills

  const catLabels = categories.length > 0
    ? categories
    : Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-6 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100 flex items-center gap-2">
            <Puzzle size={22} /> Skill 市场
          </h1>
          <p className="mt-1 text-sm text-neutral-400">
            {loading ? '加载中...' : `${skills.length} 个技能可用 · ${skills.filter((s) => s.installed).length} 个已安装`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="搜索技能..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 bg-neutral-900 border-neutral-800"
          />
          <Button variant="outline" size="sm" onClick={load} leftIcon={<RefreshCw size={14} />}>
            刷新
          </Button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-md bg-red-500/10 border border-red-500/30 text-sm text-red-400 flex items-center gap-2">
          <AlertCircle size={14} /> {error}
          <Button variant="ghost" size="sm" className="ml-auto text-xs" onClick={() => setError(null)}>
            关闭
          </Button>
        </div>
      )}

      {/* Tab: 市场 / 已安装 */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setActiveTab('market')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            activeTab === 'market'
              ? 'bg-brand/10 text-brand font-medium'
              : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800'
          }`}
        >
          市场
        </button>
        <button
          onClick={() => setActiveTab('installed')}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
            activeTab === 'installed'
              ? 'bg-brand/10 text-brand font-medium'
              : 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800'
          }`}
        >
          已安装
        </button>
      </div>

      {/* Category filter (only in market tab) */}
      {activeTab === 'market' && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          {catLabels.map((c) => (
            <button
              key={c.value}
              onClick={() => setActiveCat(c.value)}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                activeCat === c.value
                  ? 'bg-brand/15 border-brand/40 text-brand'
                  : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-neutral-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-neutral-500">
          {activeTab === 'installed' ? '尚未安装任何技能' : '未找到匹配的技能'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((skill) => (
            <Card
              key={skill.id}
              className={`bg-neutral-900/50 border-neutral-800 hover:border-neutral-700 transition-colors cursor-pointer ${
                selectedSkill?.id === skill.id ? 'border-brand/50 ring-1 ring-brand/20' : ''
              }`}
              onClick={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm text-neutral-100">{skill.name}</CardTitle>
                  <div className="flex items-center gap-1 text-xs text-neutral-400 shrink-0">
                    <Star size={12} className="text-yellow-500" />
                    {skill.rating}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <span>{skill.author}</span>
                  <span>·</span>
                  <span>v{skill.version}</span>
                  <span>·</span>
                  <span>{skill.installs.toLocaleString()} 安装</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-xs text-neutral-400 mb-2 line-clamp-2">{skill.description}</p>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                  <Badge variant="outline" className="text-[10px]">
                    {CATEGORY_LABELS[skill.category] || skill.category}
                  </Badge>
                  {skill.manifest.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[10px]">
                      {tag}
                    </Badge>
                  ))}
                </div>

                {/* Action buttons */}
                <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                  {skill.installed ? (
                    <>
                      <Badge variant="default" className="text-[10px] bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
                        <Check size={10} className="mr-1" />已安装
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-neutral-500 hover:text-red-400 ml-auto"
                        onClick={() => handleUninstall(skill.id)}
                        disabled={actionBusy === skill.id}
                        leftIcon={
                          actionBusy === skill.id
                            ? <Loader2 size={10} className="animate-spin" />
                            : <Trash2 size={10} />
                        }
                      >
                        卸载
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={() => handleInstall(skill.id)}
                      disabled={actionBusy === skill.id}
                      leftIcon={
                        actionBusy === skill.id
                          ? <Loader2 size={10} className="animate-spin" />
                          : <Download size={12} />
                      }
                    >
                      安装
                    </Button>
                  )}
                </div>

                {/* Expanded detail */}
                {selectedSkill?.id === skill.id && (
                  <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2" onClick={(e) => e.stopPropagation()}>
                    {skill.manifest.capabilities.length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">能力</div>
                        <div className="flex flex-wrap gap-1">
                          {skill.manifest.capabilities.map((cap) => (
                            <Badge key={cap} variant="secondary" className="text-[10px]">
                              {cap}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {Object.keys(skill.manifest.required_config).length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-500 uppercase tracking-wider mb-1">需要配置</div>
                        <div className="space-y-0.5">
                          {Object.entries(skill.manifest.required_config).map(([key, cfg]) => (
                            <div key={key} className="flex items-center gap-2 text-[10px]">
                              <code className="text-brand/80 font-mono">{key}</code>
                              <span className="text-neutral-500">{cfg.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-1.5 pt-1">
                      <Link
                        to="/skills/$id"
                        params={{ id: skill.id }}
                        className="text-[10px] text-brand hover:underline inline-flex items-center gap-1"
                      >
                        查看详情 <ExternalLink size={9} />
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
