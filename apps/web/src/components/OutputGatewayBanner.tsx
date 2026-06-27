// OutputGatewayBanner.tsx — 输出网关状态横幅
// 显示 deny / ask / rewrite 状态
import { ShieldAlert, ShieldOff, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'

export interface GatewayStatus {
  status: 'allow' | 'ask' | 'deny' | 'rewrite'
  risk: 'low' | 'medium' | 'high'
  outputType: string
  denyReason?: string
  warnings?: string[]
  approvalRequest?: {
    tool: string
    args: unknown
    reason: string
    risk: string
    impacts: string[]
  }
}

const RISK_BADGE: Record<string, string> = {
  low: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  deny: {
    icon: <ShieldOff className="w-5 h-5 text-red-400" />,
    label: '已阻止',
    className: 'border-red-500/30 bg-red-950/30',
  },
  ask: {
    icon: <AlertTriangle className="w-5 h-5 text-yellow-400" />,
    label: '需确认',
    className: 'border-yellow-500/30 bg-yellow-950/30',
  },
  rewrite: {
    icon: <ShieldAlert className="w-5 h-5 text-blue-400" />,
    label: '已修改',
    className: 'border-blue-500/30 bg-blue-950/30',
  },
  allow: {
    icon: <ShieldCheck className="w-5 h-5 text-emerald-400" />,
    label: '已通过',
    className: 'border-emerald-500/30 bg-emerald-950/30',
  },
}

interface OutputGatewayBannerProps {
  status: GatewayStatus
  onApprove?: () => void
  onDeny?: () => void
}

export default function OutputGatewayBanner({ status, onApprove, onDeny }: OutputGatewayBannerProps) {
  const config = STATUS_CONFIG[status.status] || STATUS_CONFIG.allow
  if (status.status === 'allow') return null // 允许时静默

  return (
    <Card className={`p-4 ${config.className} mb-2`}>
      <div className="flex items-start gap-3">
        {config.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-white">{config.label}</span>
            <Badge className={`text-[10px] ${RISK_BADGE[status.risk] || RISK_BADGE.low} border`}>
              {status.risk === 'high' ? '高风险' : status.risk === 'medium' ? '中风险' : '低风险'}
            </Badge>
            <span className="text-[10px] text-neutral-500">{status.outputType}</span>
          </div>

          {status.denyReason && (
            <p className="text-sm text-red-300 mt-1">{status.denyReason}</p>
          )}

          {status.approvalRequest && status.status === 'ask' && (
            <div className="mt-2 space-y-1">
              <p className="text-sm text-yellow-300">
                <span className="font-medium">工具:</span> {status.approvalRequest.tool}
              </p>
              <p className="text-sm text-yellow-300">
                <span className="font-medium">原因:</span> {status.approvalRequest.reason}
              </p>
              {status.approvalRequest.impacts.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {status.approvalRequest.impacts.map((imp, i) => (
                    <span key={i} className="text-[10px] bg-yellow-500/20 text-yellow-400 rounded px-1.5 py-0.5">
                      {imp}
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onApprove}
                  className="px-3 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  允许执行
                </button>
                <button
                  onClick={onDeny}
                  className="px-3 py-1 text-xs rounded border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors"
                >
                  拒绝
                </button>
              </div>
            </div>
          )}

          {status.warnings && status.warnings.length > 0 && (
            <div className="mt-2">
              {status.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-400/80">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

export function DenyBanner({ reason }: { reason?: string }) {
  return (
    <OutputGatewayBanner
      status={{
        status: 'deny',
        risk: 'high',
        outputType: 'blocked',
        denyReason: reason || '安全策略阻止了此操作',
      }}
    />
  )
}
