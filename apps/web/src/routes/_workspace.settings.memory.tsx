// apps/web/src/routes/_workspace.settings.memory.tsx · v0.3 Phase A.2
// 三层记忆系统 — 记忆管理页面 (列表 / 搜索 / 上下文)
// API: GET /api/v1/memory, GET /api/v1/memory/search?q=, DELETE /api/v1/memory/:id

import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Loader2,
  Search,
  Trash2,
  RefreshCw,
  Brain,
  Tag,
  Clock,
  Star,
  MessageSquare,
} from 'lucide-react'
import { useEffect, useState, useCallback } from 'react'
import { http } from '@/lib/api'

interface MemoryItem {
  id: string
  user_id: string
  session_id: string | null
  summary: string
  keywords: string
  embedding: string | null
  importance: number
  source: 'auto' | 'manual'
  created_at: number
}

export { MemoryPage }

function MemoryPage() {
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  const load = useCallback(async (query?: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = query ? `/api/v1/memory/search?q=${encodeURIComponent(query)}` : '/api/v1/memory'
      const data = await http.get<{ memories: MemoryItem[] }>(url)
      setMemories(data.memories ?? [])
    } catch (e) {
      setError((e as Error).message ?? '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSearch() {
    if (!searchQuery.trim()) {
      await load()
      return
    }
    setIsSearching(true)
    try {
      await load(searchQuery.trim())
    } finally {
      setIsSearching(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('确定删除此记忆?')) return
    try {
      await http.delete(`/api/v1/memory/${id}`)
      setMemories((prev) => prev.filter((m) => m.id !== id))
    } catch (e) {
      setError(`删除失败: ${(e as Error).message}`)
    }
  }

  const formatTime = (ts: number) => {
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatImportance = (val: number) => {
    if (val >= 0.8) return '高'
    if (val >= 0.5) return '中'
    return '低'
  }

  const importanceColor = (val: number) => {
    if (val >= 0.8) return 'text-amber-400'
    if (val >= 0.5) return 'text-neutral-300'
    return 'text-neutral-500'
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-neutral-100 flex items-center gap-2">
          <Brain size={18} />
          记忆管理
        </h3>
        <Button size="sm" onClick={() => load()} variant="ghost" title="刷新">
          <RefreshCw size={14} />
        </Button>
      </div>

      {/* 搜索栏 */}
      <div className="flex gap-2">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="搜索记忆关键词..."
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded h-9 px-2 text-xs text-neutral-100 placeholder:text-neutral-500"
        />
        <Button size="sm" onClick={handleSearch} disabled={isSearching}>
          {isSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          搜索
        </Button>
      </div>

      {/* 记忆列表 */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 size={12} className="animate-spin" /> 加载中...
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-8">
          <Brain size={32} className="mx-auto text-neutral-700 mb-2" />
          <p className="text-xs text-neutral-500">
            {searchQuery ? '没有匹配的记忆' : '暂无记忆摘要'}
          </p>
          <p className="text-[10px] text-neutral-600 mt-1">
            归档会话或手动创建记忆后，这里会显示自动生成的对话摘要
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <Card key={m.id} className="bg-neutral-900/50 border-neutral-800">
              <CardContent className="p-3 space-y-2">
                {/* 摘要 */}
                <p className="text-sm text-neutral-200 leading-relaxed">{m.summary}</p>

                {/* 关键词 */}
                {m.keywords && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Tag size={10} className="text-neutral-600" />
                    {m.keywords.split(',').map((kw) => (
                      <span
                        key={kw}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400"
                      >
                        {kw.trim()}
                      </span>
                    ))}
                  </div>
                )}

                {/* 元信息 */}
                <div className="flex items-center gap-3 text-[10px] text-neutral-600">
                  <span className="flex items-center gap-1">
                    <Clock size={10} />
                    {formatTime(m.created_at)}
                  </span>
                  <span className={`flex items-center gap-1 ${importanceColor(m.importance)}`}>
                    <Star size={10} />
                    {formatImportance(m.importance)}重要性
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageSquare size={10} />
                    {m.source === 'auto' ? '自动' : '手动'}
                  </span>
                  {m.session_id && (
                    <span className="text-neutral-700">
                      SID: {m.session_id.slice(0, 8)}...
                    </span>
                  )}
                </div>

                {/* 操作 */}
                <div className="flex items-center gap-1 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(m.id)}
                    title="删除"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 说明 */}
      <p className="text-[10px] text-neutral-600 leading-relaxed">
        记忆系统会自动在会话归档时生成摘要，包含对话核心主题和关键词。
        搜索时使用关键词匹配，匹配摘要或关键词字段。
        这些记忆可在新会话中注入为上下文，帮助 AI 更好理解你的需求。
      </p>
    </div>
  )
}
