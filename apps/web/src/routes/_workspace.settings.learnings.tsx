// apps/web/src/routes/_workspace.settings.learnings.tsx · v0.3 Phase C.1
// 自我改进系统 — 学习记录页面 (统计 / 列表 / 过滤 / 展开)
// API: GET /api/v1/learnings, GET /api/v1/learnings/stats, DELETE /api/v1/learnings/:id

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  Lightbulb,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  Star,
  Clock,
  Hash,
  Filter,
} from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'
import { cn } from '@/lib/utils'

interface LearningEntry {
  id: string
  user_id: string
  session_id?: string
  agent_id: string
  task_type: string
  reflection: string
  lessons: string[]
  pattern?: string
  success_rating: number
  tokens_saved: number
  created_at: number
}

interface LearningStats {
  total_reflections: number
  avg_rating: number
  top_lessons: Array<{ lesson: string; count: number }>
  learnings_by_type: Record<string, number>
  total_tokens_saved: number
}

const TASK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  research: { label: '研究', color: 'text-blue-400 bg-blue-400/10' },
  content: { label: '内容', color: 'text-green-400 bg-green-400/10' },
  code: { label: '代码', color: 'text-purple-400 bg-purple-400/10' },
  social: { label: '社交', color: 'text-pink-400 bg-pink-400/10' },
  general: { label: '通用', color: 'text-neutral-400 bg-neutral-400/10' },
}

const ALL_TYPES = ['', 'research', 'content', 'code', 'social', 'general']

export { LearningsPage }

function LearningsPage() {
  const [learnings, setLearnings] = useState<LearningEntry[]>([])
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterType, setFilterType] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [learningsData, statsData] = await Promise.all([
        http.get<{ learnings: LearningEntry[] }>('/api/v1/learnings'),
        http.get<LearningStats>('/api/v1/learnings/stats'),
      ])
      setLearnings(learningsData.learnings ?? [])
      setStats(statsData)
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleDelete(id: string) {
    if (!confirm('确定删除此学习记录?')) return
    try {
      await http.delete(`/api/v1/learnings/${id}`)
      setLearnings((prev) => prev.filter((l) => l.id !== id))
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`)
    }
  }

  const formatTime = (ts: number) => new Date(ts).toLocaleString('zh-CN')
  const formatRating = (r: number) => `${Math.round(r * 100)}%`

  // 过滤
  const filtered = filterType
    ? learnings.filter((l) => l.task_type === filterType)
    : learnings

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          <Lightbulb size={18} />
          学习记录
        </h3>
        <Button size="sm" onClick={load} variant="ghost" title="刷新">
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* 统计卡片 */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-4">
          <Loader2 size={12} className="animate-spin" /> 加载中...
        </div>
      ) : stats && stats.total_reflections > 0 ? (
        <Card className="bg-neutral-900/50 border-neutral-800">
          <CardContent className="p-4">
            <div className="grid grid-cols-4 gap-4 mb-3">
              <StatItem
                icon={<Lightbulb size={14} />}
                label="总反思"
                value={String(stats.total_reflections)}
              />
              <StatItem
                icon={<Star size={14} />}
                label="平均评分"
                value={formatRating(stats.avg_rating)}
              />
              <StatItem
                icon={<TrendingUp size={14} />}
                label="节省 Token"
                value={stats.total_tokens_saved.toLocaleString()}
              />
              <StatItem
                icon={<Hash size={14} />}
                label="经验条数"
                value={String(stats.top_lessons.length)}
              />
            </div>

            {/* 按类型分布 */}
            {Object.keys(stats.learnings_by_type).length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {Object.entries(stats.learnings_by_type).map(([type, count]) => {
                  const meta = TASK_TYPE_LABELS[type] || TASK_TYPE_LABELS.general
                  return (
                    <span
                      key={type}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded', meta.color)}
                    >
                      {meta.label}: {count}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Top 经验 */}
            {stats.top_lessons.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-neutral-500 font-medium mb-1">常用经验</p>
                {stats.top_lessons.slice(0, 5).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className="text-neutral-300">{item.lesson}</span>
                    <span className="text-neutral-600">x{item.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        !loading && (
          <Card className="bg-neutral-900/50 border-neutral-800">
            <CardContent className="p-4 text-center">
              <Lightbulb size={32} className="mx-auto text-neutral-700 mb-2" />
              <p className="text-xs text-neutral-500">暂无学习记录</p>
              <p className="text-[10px] text-neutral-600 mt-1">
                归档会话后，系统会自动生成反思和学习记录
              </p>
            </CardContent>
          </Card>
        )
      )}

      {/* 类型过滤 */}
      <div className="flex items-center gap-1.5">
        <Filter size={12} className="text-neutral-500" />
        {ALL_TYPES.map((type) => {
          const meta = type ? TASK_TYPE_LABELS[type] : null
          const isActive = filterType === type
          return (
            <button
              key={type || 'all'}
              onClick={() => setFilterType(type)}
              className={cn(
                'text-[10px] px-2 py-1 rounded transition-colors',
                isActive
                  ? 'bg-brand/20 text-brand'
                  : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200',
              )}
            >
              {type ? meta?.label ?? type : '全部'}
            </button>
          )
        })}
      </div>

      {/* 学习记录列表 */}
      {filtered.length === 0 && !loading ? (
        <div className="text-center py-6">
          <p className="text-xs text-neutral-500">
            {filterType ? '该类型暂无记录' : '暂无学习记录'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((l) => {
            const isExpanded = expandedId === l.id
            const meta = TASK_TYPE_LABELS[l.task_type] || TASK_TYPE_LABELS.general
            return (
              <Card key={l.id} className="bg-neutral-900/50 border-neutral-800">
                <CardContent className="p-3 space-y-2">
                  {/* 头部: 类型 + 评分 + 时间 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded', meta.color)}>
                        {meta.label}
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        {l.agent_id}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] font-medium',
                          l.success_rating >= 0.8 ? 'text-green-400' :
                          l.success_rating >= 0.5 ? 'text-amber-400' : 'text-red-400',
                        )}
                      >
                        {formatRating(l.success_rating)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-neutral-600 flex items-center gap-1">
                        <Clock size={10} />
                        {formatTime(l.created_at)}
                      </span>
                    </div>
                  </div>

                  {/* 反思摘要 */}
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {l.reflection}
                  </p>

                  {/* 经验教训 */}
                  {l.lessons.length > 0 && (
                    <div className="flex items-start gap-1.5 flex-wrap">
                      {l.lessons.map((lesson, i) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-300"
                        >
                          💡 {lesson}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 模式 (如果有) */}
                  {isExpanded && l.pattern && (
                    <div className="text-[10px] text-purple-300 bg-purple-950/30 rounded p-2">
                      <span className="font-medium">可复用模式:</span> {l.pattern}
                    </div>
                  )}

                  {/* 操作栏 */}
                  <div className="flex items-center gap-1 pt-1">
                    {l.pattern && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-[10px] h-6"
                        onClick={() => setExpandedId(isExpanded ? null : l.id)}
                      >
                        {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {isExpanded ? '收起' : '展开'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(l.id)}
                      title="删除"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* 说明 */}
      <p className="text-[10px] text-neutral-600 leading-relaxed">
        学习系统会在会话归档或工作流完成后自动分析对话内容，提取经验教训和可复用模式。
        这些记录会帮助 AI 在未来的任务中表现更好，建议定期查看和清理。
        如果你删除了某条记录，对应的经验将不再用于后续优化。
      </p>
    </div>
  )
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1 text-neutral-500 mb-0.5">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="text-sm font-semibold text-neutral-100">{value}</div>
    </div>
  )
}
