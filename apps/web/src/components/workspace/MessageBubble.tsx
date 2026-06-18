// apps/web/src/components/workspace/MessageBubble.tsx · v0.3 spec §33.6
import { cn } from '@/lib/utils'
import { Bot, User, Wrench } from 'lucide-react'

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface MessageBubbleProps {
  role: MessageRole
  content: string
  streaming?: boolean
  model?: string
  timestamp?: number
  latencyMs?: number
  onEdit?: () => void
  onRegenerate?: () => void
  onCopy?: () => void
}

const ROLE_STYLES: Record<MessageRole, { bg: string; iconColor: string; Icon: typeof User }> = {
  user: { bg: 'bg-neutral-900', iconColor: 'text-brand', Icon: User },
  assistant: { bg: 'bg-neutral-900/50', iconColor: 'text-semantic-info', Icon: Bot },
  system: { bg: 'bg-semantic-warning/5', iconColor: 'text-semantic-warning', Icon: Wrench },
  tool: { bg: 'bg-semantic-success/5', iconColor: 'text-semantic-success', Icon: Wrench },
}

export function MessageBubble({
  role,
  content,
  streaming,
  model,
  timestamp,
  latencyMs,
  onEdit,
  onRegenerate,
  onCopy,
}: MessageBubbleProps) {
  const style = ROLE_STYLES[role]
  const Icon = style.Icon

  return (
    <div className="flex gap-3 max-w-3xl">
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          role === 'user' ? 'bg-brand/20' : 'bg-semantic-info/20',
        )}
      >
        <Icon size={16} className={style.iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
          <span className="font-medium text-neutral-300">
            {role === 'user' ? '老板' : role === 'assistant' ? model ?? 'Assistant' : 'Tool'}
          </span>
          {latencyMs && <span>· {latencyMs}ms</span>}
          {timestamp && <span>· {new Date(timestamp).toLocaleTimeString()}</span>}
        </div>
        <div
          className={cn(
            'rounded-md p-3 text-sm text-neutral-200',
            style.bg,
            streaming && 'after:content-["▋"] after:animate-pulse after:text-brand',
          )}
        >
          {content}
        </div>
        {!streaming && (onEdit || onRegenerate || onCopy) && (
          <div className="mt-1 flex gap-2 text-xs">
            {onCopy && (
              <button onClick={onCopy} className="text-neutral-400 hover:text-neutral-100">
                复制
              </button>
            )}
            {onEdit && (
              <button onClick={onEdit} className="text-neutral-400 hover:text-neutral-100">
                编辑
              </button>
            )}
            {onRegenerate && (
              <button onClick={onRegenerate} className="text-neutral-400 hover:text-neutral-100">
                重新生成
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
