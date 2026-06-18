// apps/web/src/components/workspace/TraceTimeline.tsx · v0.3 spec §33.6
import { cn } from '@/lib/utils'
import { Cpu, Wrench, Shield, FileText, Play, CheckCircle2, XCircle } from 'lucide-react'

export type TraceStepType = 'llm_call' | 'tool_call' | 'sandbox_exec' | 'sub_agent' | 'file_io'

export interface TraceStep {
  id: string
  type: TraceStepType
  name: string
  status: 'pending' | 'running' | 'success' | 'error'
  startTime: number
  endTime?: number
  durationMs?: number
  riskLevel?: 'low' | 'medium' | 'high' | 'critical'
}

const TYPE_ICON: Record<TraceStepType, typeof Cpu> = {
  llm_call: Cpu,
  tool_call: Wrench,
  sandbox_exec: Shield,
  sub_agent: Play,
  file_io: FileText,
}

const STATUS_STYLE: Record<TraceStep['status'], string> = {
  pending: 'border-neutral-700 bg-neutral-900 text-neutral-400',
  running: 'border-semantic-info/50 bg-semantic-info/5 text-semantic-info',
  success: 'border-semantic-success/50 bg-semantic-success/5 text-semantic-success',
  error: 'border-semantic-danger/50 bg-semantic-danger/5 text-semantic-danger',
}

const RISK_STYLE: Record<NonNullable<TraceStep['riskLevel']>, string> = {
  low: '',
  medium: 'border-semantic-warning/50',
  high: 'border-semantic-danger/50',
  critical: 'border-semantic-danger border-2',
}

export interface TraceTimelineProps {
  steps: TraceStep[]
  onStepClick?: (step: TraceStep) => void
}

export function TraceTimeline({ steps, onStepClick }: TraceTimelineProps) {
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const Icon = TYPE_ICON[s.type]
        const isLast = i === steps.length - 1
        return (
          <div key={s.id} className="flex gap-3">
            {/* 时间线 + 节点 */}
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center border-2',
                  STATUS_STYLE[s.status],
                  RISK_STYLE[s.riskLevel ?? 'low'],
                )}
              >
                {s.status === 'success' ? <CheckCircle2 size={12} /> :
                 s.status === 'error' ? <XCircle size={12} /> :
                 <Icon size={12} />}
              </div>
              {!isLast && <div className="w-px flex-1 bg-neutral-800 my-1" />}
            </div>
            {/* 内容 */}
            <button
              onClick={() => onStepClick?.(s)}
              className={cn(
                'flex-1 text-left pb-3 rounded text-sm',
                'hover:bg-neutral-900/50 -mt-1 px-2 py-1',
              )}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-neutral-200">{s.name}</span>
                {s.durationMs !== undefined && (
                  <span className="text-xs text-neutral-400">{s.durationMs}ms</span>
                )}
              </div>
              <div className="text-xs text-neutral-400">{s.type}</div>
            </button>
          </div>
        )
      })}
    </div>
  )
}
