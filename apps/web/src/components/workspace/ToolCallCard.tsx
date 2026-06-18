// apps/web/src/components/workspace/ToolCallCard.tsx · v0.3 spec §33.6
import { cn } from '@/lib/utils'
import { Wrench, Loader2, CheckCircle2, XCircle, X, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type ToolStatus = 'pending' | 'running' | 'success' | 'error'

export interface ToolCallCardProps {
  tool: string
  args?: Record<string, unknown>
  result?: unknown
  status: ToolStatus
  durationMs?: number
  sandbox?: 'local' | 'docker' | 'firecracker'
  onCancel?: () => void
  onRerun?: () => void
}

const STATUS_STYLES: Record<ToolStatus, { color: string; Icon: typeof Wrench }> = {
  pending: { color: 'border-semantic-warning/50 bg-semantic-warning/5 text-semantic-warning', Icon: Loader2 },
  running: { color: 'border-semantic-info/50 bg-semantic-info/5 text-semantic-info', Icon: Loader2 },
  success: { color: 'border-semantic-success/50 bg-semantic-success/5 text-semantic-success', Icon: CheckCircle2 },
  error: { color: 'border-semantic-danger/50 bg-semantic-danger/5 text-semantic-danger', Icon: XCircle },
}

export function ToolCallCard({
  tool,
  args,
  result,
  status,
  durationMs,
  sandbox,
  onCancel,
  onRerun,
}: ToolCallCardProps) {
  const style = STATUS_STYLES[status]
  const Icon = style.Icon

  return (
    <div className={cn('rounded-md border p-3 text-xs', style.color)}>
      <div className="flex items-center gap-2">
        <Icon size={14} className={status === 'running' || status === 'pending' ? 'animate-spin' : ''} />
        <span className="font-mono font-medium">{tool}</span>
        {sandbox && (
          <span className="text-[10px] text-neutral-400 px-1.5 py-0.5 rounded bg-neutral-800">
            {sandbox}
          </span>
        )}
        {durationMs !== undefined && (
          <span className="ml-auto text-neutral-400">{durationMs}ms</span>
        )}
      </div>
      {args && Object.keys(args).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-100">参数</summary>
          <pre className="mt-1 p-2 rounded bg-neutral-950/50 text-[11px] overflow-x-auto font-mono">
            {JSON.stringify(args, null, 2)}
          </pre>
        </details>
      )}
      {result !== undefined && (
        <details className="mt-2" open>
          <summary className="cursor-pointer text-neutral-400 hover:text-neutral-100">结果</summary>
          <pre className="mt-1 p-2 rounded bg-neutral-950/50 text-[11px] overflow-x-auto font-mono max-h-40">
            {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
      {(status === 'pending' || status === 'running') && onCancel && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            <X size={12} className="mr-1" /> 取消
          </Button>
        </div>
      )}
      {status === 'success' && onRerun && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onRerun}>
            <RotateCw size={12} className="mr-1" /> 重跑
          </Button>
        </div>
      )}
    </div>
  )
}
