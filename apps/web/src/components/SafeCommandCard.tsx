// SafeCommandCard.tsx — 命令安全卡片
// 显示命令、风险评估、允许/拒绝按钮
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Terminal, Shield, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react'

interface SafeCommandCardProps {
  command: string
  cwd?: string
  risk: 'low' | 'medium' | 'high'
  reason?: string
  impacts?: string[]
  onApprove?: (command: string) => void
  onDeny?: (command: string) => void
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const BORDER_COLORS: Record<string, string> = {
  low: 'border-emerald-500/20',
  medium: 'border-yellow-500/20',
  high: 'border-red-500/20',
}

export default function SafeCommandCard({
  command, cwd, risk, reason, impacts, onApprove, onDeny,
}: SafeCommandCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className={`p-3 ${BORDER_COLORS[risk]} bg-neutral-900/50 mb-2`}>
      <div className="flex items-start gap-2">
        <Terminal className="w-4 h-4 text-neutral-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge className={`text-[10px] ${RISK_COLORS[risk]} border`}>
              {risk === 'high' ? '高风险' : risk === 'medium' ? '中风险' : '低风险'}
            </Badge>
            {cwd && <span className="text-[10px] text-neutral-500">{cwd}</span>}
            <button
              onClick={() => setExpanded(!expanded)}
              className="ml-auto text-neutral-500 hover:text-neutral-300"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          <code className="text-sm text-neutral-100 bg-neutral-950 rounded px-2 py-1 block mt-1 break-all font-mono">
            $ {command}
          </code>

          {expanded && (
            <div className="mt-2 space-y-1">
              {reason && (
                <p className="text-xs text-neutral-400">
                  <Shield className="w-3 h-3 inline mr-1" />
                  {reason}
                </p>
              )}
              {impacts && impacts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {impacts.map((imp, i) => (
                    <span key={i} className="text-[10px] bg-neutral-800 text-neutral-400 rounded px-1.5 py-0.5">
                      {imp}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {risk !== 'low' && (
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => onApprove?.(command)}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                <CheckCircle2 className="w-3 h-3" />
                允许
              </button>
              <button
                onClick={() => onDeny?.(command)}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <XCircle className="w-3 h-3" />
                拒绝
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
