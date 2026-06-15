// apps/web/src/components/studio/NodePalette.tsx · Track C.2 (2026-06-15)
// 7 类节点拖拽面板 (从 nodes.ts 渲染, 按 category 分组)
// 拖到 StudioCanvas 即创建新节点 (用 @dnd-kit 或 onDragStart + dataTransfer)

import { Video, BookOpen, Newspaper, Sparkles, FileSearch, Bot, TrendingUp, GripVertical } from 'lucide-react'
import { STUDIO_NODES, nodesByCategory, type StudioNodeKind } from './nodes'
import { cn } from '@/lib/cn'

const ICONS: Record<StudioNodeKind, typeof Video> = {
  douyin: Video,
  xiaohongshu: BookOpen,
  wechat: Newspaper,
  video_gen: Sparkles,
  video_parse: FileSearch,
  content: Bot,
  data_crawl: TrendingUp,
}

const CATEGORY_LABELS: Record<string, string> = {
  social: '🛒 社媒',
  media: '🎬 媒体',
  ai: '🤖 AI',
  data: '📊 数据',
}

export function NodePalette() {
  const grouped = nodesByCategory()

  function handleDragStart(e: React.DragEvent, kind: StudioNodeKind) {
    e.dataTransfer.setData('application/studio-node', kind)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <aside
      className="w-56 bg-neutral-950 border-r border-neutral-800 p-3 overflow-y-auto flex-shrink-0"
      data-testid="studio-node-palette"
    >
      <h2 className="text-xs font-semibold text-neutral-300 mb-3 uppercase tracking-wider">
        节点库
      </h2>
      {Object.entries(grouped).map(([category, nodes]) => (
        <div key={category} className="mb-4">
          <div className="text-[10px] text-neutral-500 mb-1.5 font-medium">
            {CATEGORY_LABELS[category]}
          </div>
          <div className="space-y-1.5">
            {nodes.map((n) => {
              const Icon = ICONS[n.kind]
              return (
                <button
                  key={n.kind}
                  draggable
                  onDragStart={(e) => handleDragStart(e, n.kind)}
                  data-testid={`palette-${n.kind}`}
                  className="w-full flex items-center gap-2 p-2 rounded border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-800 hover:border-neutral-600 cursor-grab active:cursor-grabbing text-left transition-colors"
                  title={n.description}
                >
                  <GripVertical size={11} className="text-neutral-600 flex-shrink-0" aria-hidden="true" />
                  <Icon size={13} style={{ color: n.color }} className="flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-neutral-100 truncate">{n.label}</div>
                    <div className="text-[10px] text-neutral-500 truncate">{n.description}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-neutral-600 mt-3 leading-relaxed">
        拖节点到画布, 节点之间拖线连边, 点击运行启动工作流
      </p>
    </aside>
  )
}

// 兼容老 import (snake_case) 兼容
export { NodePalette as default }
export { STUDIO_NODES }
export { cn }
