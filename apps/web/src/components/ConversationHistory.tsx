// components/ConversationHistory.tsx · 对话历史侧边栏 (ChatGPT 风格)
// ----------------------------------------------------------------------
// 可折叠的会话列表：
//   - 显示所有历史对话（标题 + 时间预览）
//   - 点击切换会话，新建按钮，删除（悬浮显示）
//   - 搜索过滤
// 嵌入到 ChatCopilot 左侧或 CommandCenter 左栏
// ----------------------------------------------------------------------

import { useState, useMemo } from 'react'
import { Plus, MessageSquare, Trash2, Search, PanelLeftClose, PanelLeft, Clock } from 'lucide-react'
import { useAppStore, type Conversation } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

interface Props {
  /** 是否展开 */
  open: boolean
  /** 切换展开/收起 */
  onToggle: () => void
}

/** 格式化相对时间 */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function ConversationHistory({ open, onToggle }: Props) {
  const {
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation,
  } = useAppStore()

  const [search, setSearch] = useState('')
  const [hoverId, setHoverId] = useState<string | null>(null)

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!search.trim()) return conversations
    const q = search.toLowerCase()
    return conversations.filter((c) => c.title.toLowerCase().includes(q))
  }, [conversations, search])

  function handleNew() {
    newConversation()
    setSearch('')
  }

  function handleSwitch(id: string) {
    switchConversation(id)
    setSearch('')
  }

  // 按日期分组：今天 / 昨天 / 更早
  const today = new Date().setHours(0, 0, 0, 0)
  const yesterday = today - 86400000

  const groups = useMemo(() => {
    return {
      today: filtered.filter((c) => c.updatedAt >= today),
      yesterday: filtered.filter((c) => c.updatedAt >= yesterday && c.updatedAt < today),
      older: filtered.filter((c) => c.updatedAt < yesterday),
    }
  }, [filtered])

  return (
    <>
      {/* 收起时只显示一个窄条 */}
      {!open && (
        <div className="w-10 h-full bg-neutral-950 border-r border-neutral-800 flex flex-col items-center py-3 gap-2 flex-shrink-0">
          <button
            onClick={onToggle}
            className="p-2 rounded-lg text-neutral-500 hover:text-brand hover:bg-neutral-800 transition-colors"
            title="展开历史记录"
          >
            <PanelLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleNew}
            className="p-2 rounded-lg text-neutral-400 hover:text-white bg-neutral-800/50 hover:bg-brand/20 transition-colors"
            title="新对话"
          >
            <Plus className="w-4 h-4" />
          </button>
          {/* 最近 3 个快速入口 */}
          {conversations.slice(0, 3).map((c) => (
            <button
              key={c.id}
              onClick={() => { onToggle(); handleSwitch(c.id) }}
              className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-xs font-medium',
                c.id === activeConversationId
                  ? 'bg-brand text-white'
                  : 'text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800',
              )}
              title={c.title}
            >
              {(c.title?.[0] || '?').toUpperCase()}
            </button>
          ))}
          <div className="mt-auto" />
          <div className="text-[9px] text-neutral-700 text-center leading-tight px-0.5">
            {conversations.length}
          </div>
        </div>
      )}

      {/* 展开时的完整侧栏 */}
      {open && (
        <div className="w-[260px] h-full bg-neutral-950 border-r border-neutral-800 flex flex-col flex-shrink-0">
          {/* 头部 */}
          <div className="px-3 py-3 flex items-center justify-between flex-shrink-0">
            <button
              onClick={handleNew}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand text-white text-sm font-medium hover:bg-brand/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              新对话
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
              title="收起"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>

          {/* 搜索 */}
          <div className="px-3 pb-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-600" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索对话..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-neutral-900 border border-neutral-800 rounded-lg text-neutral-300 placeholder:text-neutral-700 focus:outline-none focus:border-neutral-600 transition-colors"
              />
            </div>
          </div>

          {/* 会话列表 */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5 scrollbar-thin">
            {/* 今天 */}
            {groups.today.length > 0 && (
              <div className="pt-2 pb-1">
                <span className="px-2 text-[10px] font-medium text-neutral-600 uppercase tracking-wider">今天</span>
                {groups.today.map((c) => renderConversationItem(c))}
              </div>
            )}

            {/* 昨天 */}
            {groups.yesterday.length > 0 && (
              <div className="pt-2 pb-1">
                <span className="px-2 text-[10px] font-medium text-neutral-600 uppercase tracking-wider">昨天</span>
                {groups.yesterday.map((c) => renderConversationItem(c))}
              </div>
            )}

            {/* 更早 */}
            {groups.older.length > 0 && (
              <div className="pt-2 pb-1">
                <span className="px-2 text-[10px] font-medium text-neutral-600 uppercase tracking-wider">更早</span>
                {groups.older.map((c) => renderConversationItem(c))}
              </div>
            )}

            {filtered.length === 0 && (
              <div className="flex flex-col items-center pt-10 text-neutral-600">
                <MessageSquare className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-xs">{search ? '没有匹配的对话' : '暂无对话'}</p>
              </div>
            )}
          </div>

          {/* 底部统计 */}
          <div className="px-3 py-2 border-t border-neutral-800 flex items-center justify-between flex-shrink-0">
            <span className="text-[10px] text-neutral-700">
              共 {conversations.length} 个对话
            </span>
            <Clock className="w-3 h-3 text-neutral-700" />
          </div>
        </div>
      )}
    </>
  )

  /** 单条对话项 */
  function renderConversationItem(c: Conversation) {
    const isActive = c.id === activeConversationId
    const lastMsg = c.messages[c.messages.length - 1]

    return (
      <div
        key={c.id}
        onMouseEnter={() => setHoverId(c.id)}
        onMouseLeave={() => setHoverId(null)}
        className={cn(
          'group relative rounded-lg px-3 py-2 cursor-pointer transition-all duration-150',
          isActive
            ? 'bg-brand/15 border border-brand/25'
            : 'hover:bg-neutral-800/60 border border-transparent',
        )}
        onClick={() => handleSwitch(c.id)}
      >
        <div className="flex items-start justify-between gap-1">
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                'text-sm truncate',
                isActive ? 'text-brand font-medium' : 'text-neutral-300',
              )}
            >
              {c.title}
            </p>
            {lastMsg && lastMsg.role !== 'assistant' && c.messages.length > 1 && (
              <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                {lastMsg.content.slice(0, 35)}...
              </p>
            )}
          </div>
          {/* 删除按钮 */}
          {hoverId === c.id && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                deleteConversation(c.id)
              }}
              className="flex-shrink-0 p-1 rounded text-neutral-600 hover:text-red-400 hover:bg-red-400/10 transition-colors opacity-0 group-hover:opacity-100"
              title="删除对话"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <p className="text-[10px] text-neutral-700 mt-1">{timeAgo(c.updatedAt)}</p>
      </div>
    )
  }
}
