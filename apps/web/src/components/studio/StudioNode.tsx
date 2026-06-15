// apps/web/src/components/studio/StudioNode.tsx · Track C.2 (2026-06-15)
// 自定义 React Flow 节点 (左侧 input handle, 右侧 output handle, 节点色配色)

import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Video,
  BookOpen,
  Newspaper,
  Sparkles,
  FileSearch,
  Bot,
  TrendingUp,
} from 'lucide-react'
import { memo } from 'react'
import { STUDIO_NODES, type StudioNodeKind } from './nodes'

const ICONS: Record<StudioNodeKind, typeof Video> = {
  douyin: Video,
  xiaohongshu: BookOpen,
  wechat: Newspaper,
  video_gen: Sparkles,
  video_parse: FileSearch,
  content: Bot,
  data_crawl: TrendingUp,
}

export interface StudioNodeData extends Record<string, unknown> {
  kind: StudioNodeKind
  params: Record<string, unknown>
}

function StudioNodeImpl(props: NodeProps) {
  const data = props.data as StudioNodeData
  const spec = STUDIO_NODES.find((n) => n.kind === data.kind)
  if (!spec) return null
  const Icon = ICONS[data.kind]
  const status = (props.data as any).__status ?? 'idle'  // idle | running | success | failed
  const statusColor: Record<string, string> = {
    idle: 'border-neutral-700',
    running: 'border-blue-500 animate-pulse',
    success: 'border-emerald-500',
    failed: 'border-red-500',
  }
  return (
    <div
      className={`bg-neutral-900 border-2 rounded-lg shadow-lg min-w-[200px] ${statusColor[status] ?? 'border-neutral-700'}`}
      style={{ borderTopColor: spec.color, borderTopWidth: 4 }}
      data-testid={`studio-node-${data.kind}`}
      data-status={status}
    >
      {/* 输入 handle (左侧, 1 个) */}
      {spec.inputs.length > 0 && (
        <Handle
          type="target"
          position={Position.Left}
          id={spec.inputs[0].id}
          className="!bg-brand !w-3 !h-3"
        />
      )}
      <div className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={14} style={{ color: spec.color }} />
          <div className="text-xs font-semibold text-neutral-100">{spec.label}</div>
        </div>
        <div className="text-[10px] text-neutral-500 line-clamp-2">{spec.description}</div>
        {Object.keys(data.params ?? {}).length > 0 && (
          <div className="mt-2 text-[10px] text-neutral-400 font-mono">
            {Object.entries(data.params)
              .slice(0, 2)
              .map(([k, v]) => `${k}=${String(v).slice(0, 12)}`)
              .join(' · ')}
          </div>
        )}
      </div>
      {/* 输出 handle (右侧, 1 个) */}
      {spec.outputs.length > 0 && (
        <Handle
          type="source"
          position={Position.Right}
          id={spec.outputs[0].id}
          className="!bg-emerald-500 !w-3 !h-3"
        />
      )}
    </div>
  )
}

export const StudioNode = memo(StudioNodeImpl)
export const NODE_TYPES = { studio: StudioNode }
