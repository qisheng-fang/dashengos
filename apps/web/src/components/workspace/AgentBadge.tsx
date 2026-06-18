// apps/web/src/components/workspace/AgentBadge.tsx · v0.3 spec §33.6
import { cn } from '@/lib/utils'
import { Bot } from 'lucide-react'

export interface AgentBadgeProps {
  name: string
  description?: string
  category?: 'code' | 'research' | 'design' | 'data' | 'security' | 'custom'
  onClick?: () => void
}

const CATEGORY_COLORS: Record<NonNullable<AgentBadgeProps['category']>, string> = {
  code: 'bg-semantic-info/10 text-semantic-info',
  research: 'bg-semantic-success/10 text-semantic-success',
  design: 'bg-semantic-warning/10 text-semantic-warning',
  data: 'bg-brand/10 text-brand',
  security: 'bg-semantic-danger/10 text-semantic-danger',
  custom: 'bg-neutral-800 text-neutral-300',
}

export function AgentBadge({ name, description, category = 'custom', onClick }: AgentBadgeProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium',
        CATEGORY_COLORS[category],
      )}
    >
      <Bot size={11} />
      {name}
      {description && <span className="text-neutral-400 ml-1">· {description}</span>}
    </button>
  )
}
