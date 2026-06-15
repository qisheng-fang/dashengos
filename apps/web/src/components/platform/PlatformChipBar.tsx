// apps/web/src/components/platform/PlatformChipBar.tsx · Track C.1 (2026-06-15)
// 7 平台 chip 横滑组件 (跟旧 DaShengOS 截图一致: 顶部 7 平台 chip 一排)
//
// 数据源: lib/pillars/data.ts (静态 7 平台, 真接状态: 4 真 / 3 待)
// 选中 chip → onChange 回调, 让父组件导航/跳 Chat 屏

import { useNavigate } from '@tanstack/react-router'
import { ShoppingCart, Package, Target, Music, Zap, BookOpen, MessageCircle, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PLATFORMS, type PlatformChip } from '@/lib/pillars/data'

// lucide icon 映射 (emoji 不用, 改用 lucide 描边 SVG 跟 workspace VI 一致)
const ICON_BY_PLATFORM: Record<string, typeof ShoppingCart> = {
  taobao: ShoppingCart,
  jd: Package,
  pdd: Target,
  douyin: Music,
  kuaishou: Zap,
  xiaohongshu: BookOpen,
  wechat: MessageCircle,
}

export function PlatformChipBar({
  active,
  onChange,
}: {
  active?: string
  onChange?: (id: string) => void
}) {
  const navigate = useNavigate()

  function handleClick(p: PlatformChip) {
    onChange?.(p.id)
    if (p.agentId) {
      // 真接入平台 → 跳 Chat 屏, threadId 本地生成
      const threadId = `t_${Date.now().toString(36)}_${p.id}`
      sessionStorage.setItem(`pending_msg_${threadId}`, `用 ${p.name} agent 帮我做点事`)
      sessionStorage.setItem(`pending_agent_${threadId}`, p.agentId)
      navigate({ to: '/chats/$id', params: { id: threadId } })
    } else {
      // 待 Track B 接入的平台 → 跳 AgentMarket 屏
      navigate({ to: '/agents' })
    }
  }

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin"
      data-testid="platform-chip-bar"
      role="tablist"
      aria-label="7 平台 chip"
    >
      {PLATFORMS.map((p) => {
        const Icon = ICON_BY_PLATFORM[p.id]
        const isActive = p.id === active
        const isReal = p.status === 'real'
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => handleClick(p)}
            data-testid={`chip-${p.id}`}
            data-status={p.status}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-colors flex-shrink-0',
              isActive
                ? 'bg-brand/15 border-brand text-brand ring-1 ring-brand/40'
                : isReal
                  ? 'border-neutral-700 bg-neutral-900/50 text-neutral-200 hover:bg-neutral-800 hover:border-neutral-600'
                  : 'border-neutral-800 bg-neutral-950/30 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300',
            )}
            title={`${p.name} · ${isReal ? '真接入' : p.status === 'pending' ? '待 Track B 接入' : 'mock'}`}
          >
            <Icon size={14} aria-hidden="true" />
            <span>{p.name}</span>
            {isReal && (
              <Check size={11} className="text-emerald-400" aria-hidden="true" />
            )}
            {!isReal && (
              <span className="text-[9px] uppercase tracking-wider opacity-60">
                {p.status === 'pending' ? 'Soon' : 'Mock'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
