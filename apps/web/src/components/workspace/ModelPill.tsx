// apps/web/src/components/workspace/ModelPill.tsx · v0.3 spec §33.6
import { ChevronDown, Cloud, Cpu, AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ModelRef } from '@/lib/schemas'

export interface ModelPillProps {
  current: ModelRef
  available: ModelRef[]
  showLatency?: boolean
  onChange: (m: ModelRef) => void
}

function modelVariant(m: ModelRef): 'local' | 'cloud' | 'danger' {
  if (m.provider === 'ollama' || m.provider === 'vllm' || m.provider === 'llamacpp') return 'local'
  if (m.provider === 'openai' || m.provider === 'anthropic') return 'cloud'
  return 'danger'
}

const VARIANT_STYLES: Record<string, string> = {
  local: 'bg-semantic-success/10 text-semantic-success border-semantic-success/30',
  cloud: 'bg-semantic-info/10 text-semantic-info border-semantic-info/30',
  danger: 'bg-semantic-danger/10 text-semantic-danger border-semantic-danger/30',
}

const VARIANT_ICON = {
  local: Cpu,
  cloud: Cloud,
  danger: AlertTriangle,
}

export function ModelPill({ current, available, showLatency, onChange }: ModelPillProps) {
  const [open, setOpen] = useState(false)
  const variant = modelVariant(current)
  const Icon = VARIANT_ICON[variant]

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium',
          VARIANT_STYLES[variant],
        )}
      >
        <Icon size={12} />
        {current.provider}:{current.name}
        {showLatency && <span className="ml-1 opacity-70">· 234ms</span>}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-neutral-900 border border-neutral-800 rounded-md shadow-lg z-popover py-1">
          {available.map((m) => {
            const v = modelVariant(m)
            const I = VARIANT_ICON[v]
            return (
              <button
                key={`${m.provider}:${m.name}`}
                onClick={() => {
                  onChange(m)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-neutral-800',
                  current.provider === m.provider && current.name === m.name && 'bg-neutral-800',
                )}
              >
                <I size={12} className={cn(variant === 'local' && 'text-semantic-success', variant === 'cloud' && 'text-semantic-info', variant === 'danger' && 'text-semantic-danger')} />
                <span className="font-mono">{m.provider}:{m.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
