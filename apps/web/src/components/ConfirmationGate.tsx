// components/ConfirmationGate.tsx · P3 写操作确认门 UI
// ----------------------------------------------------------------------
// 轮询 /api/v1/heal/pending 获取待确认操作 → 弹窗展示 → 批准/拒绝
// 集成到 CommandCenter 全局状态
// ----------------------------------------------------------------------
import { useEffect, useState, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { http } from '@/lib/api'
import { ShieldAlert, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react'

interface PendingAction {
  id: string
  userId: string
  sessionId?: string
  action: string
  params: Record<string, any>
  description: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  createdAt: string
}

const RISK_COLORS: Record<string, string> = {
  low: 'bg-emerald-500/20 text-emerald-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
}

const RISK_ICONS: Record<string, React.ReactNode> = {
  low: <ShieldCheck className="w-4 h-4 text-emerald-400" />,
  medium: <ShieldAlert className="w-4 h-4 text-yellow-400" />,
  high: <ShieldAlert className="w-4 h-4 text-orange-400" />,
  critical: <ShieldAlert className="w-4 h-4 text-red-400" />,
}

export default function ConfirmationGate() {
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  const [currentAction, setCurrentAction] = useState<PendingAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [polling, setPolling] = useState(true)

  // 轮询 pending actions
  const pollPending = useCallback(async () => {
    if (!polling) return
    try {
      const res = await http.get<{ success: boolean; pending: PendingAction[]; count: number }>(
        '/api/v1/heal/pending'
      )
      if (res.success && res.count > 0) {
        setPendingActions(res.pending)
        // 如果没有正在展示的操作，展示第一个
        if (!currentAction) {
          setCurrentAction(res.pending[0])
        }
      } else {
        setPendingActions([])
        setCurrentAction(null)
      }
    } catch {
      // 静默处理（可能未认证）
    }
  }, [polling, currentAction])

  useEffect(() => {
    const interval = setInterval(pollPending, 3000) // 每 3 秒轮询
    pollPending() // 首次立即轮询
    return () => clearInterval(interval)
  }, [pollPending])

  // 批准操作
  const handleApprove = async () => {
    if (!currentAction) return
    setLoading(true)
    try {
      await http.post('/api/v1/heal/approve', { pendingId: currentAction.id })
      setPendingActions((prev) => prev.filter((a) => a.id !== currentAction.id))
      // 展示下一个
      const remaining = pendingActions.filter((a) => a.id !== currentAction.id)
      setCurrentAction(remaining[0] || null)
    } catch {
      // 错误时静默
    } finally {
      setLoading(false)
    }
  }

  // 拒绝操作
  const handleReject = async () => {
    if (!currentAction) return
    setLoading(true)
    try {
      await http.post('/api/v1/heal/reject', { pendingId: currentAction.id, reason: '用户拒绝' })
      setPendingActions((prev) => prev.filter((a) => a.id !== currentAction.id))
      const remaining = pendingActions.filter((a) => a.id !== currentAction.id)
      setCurrentAction(remaining[0] || null)
    } catch {
      // 错误时静默
    } finally {
      setLoading(false)
    }
  }

  // 没有待确认操作时不渲染
  if (!currentAction) return null

  return (
    <Dialog open={!!currentAction} onOpenChange={(open) => { if (!open) setPolling(true) }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {RISK_ICONS[currentAction.riskLevel]}
            <span>操作确认</span>
            <Badge className={RISK_COLORS[currentAction.riskLevel]}>
              {currentAction.riskLevel === 'critical' ? '⚠️ 危险' :
               currentAction.riskLevel === 'high' ? '高风险' :
               currentAction.riskLevel === 'medium' ? '中等风险' : '低风险'}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Agent 请求执行以下操作，需要您的确认才能继续。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {/* 操作名称 */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-400">操作:</span>
            <span className="text-sm font-bold text-neutral-100">{currentAction.action}</span>
          </div>

          {/* 参数 */}
          <div className="rounded-md bg-neutral-900/50 border border-neutral-800 p-3">
            <span className="text-xs text-neutral-400 mb-1 block">参数:</span>
            <pre className="text-xs text-neutral-200 overflow-auto max-h-[120px] whitespace-pre-wrap break-all">
              {JSON.stringify(currentAction.params, null, 2)}
            </pre>
          </div>

          {/* 描述 */}
          <div className="text-sm text-neutral-300">
            {currentAction.description}
          </div>

          {/* 时间 */}
          <div className="text-xs text-neutral-500">
            请求时间: {new Date(currentAction.createdAt).toLocaleString('zh-CN')}
          </div>
        </div>

        {/* 待确认队列信息 */}
        {pendingActions.length > 1 && (
          <div className="text-xs text-neutral-500 border-t border-neutral-800 pt-2">
            还有 {pendingActions.length - 1} 个操作等待确认
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            className="border-red-500/50 text-red-400 hover:bg-red-500/10"
            onClick={handleReject}
            disabled={loading}
          >
            <XCircle className="w-4 h-4 mr-1" />
            拒绝
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-500 text-white"
            onClick={handleApprove}
            disabled={loading}
          >
            <CheckCircle2 className="w-4 h-4 mr-1" />
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
