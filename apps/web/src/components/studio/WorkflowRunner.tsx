// apps/web/src/components/studio/WorkflowRunner.tsx · Track C.2 (2026-06-15)
// 跑工作流的 SSE 进度 UI 组件 (右下面板, 显示节点状态 + 错误重试)
//
// 当前实现: 简化版, 显示节点 status 列表 + 整体进度
// 完整版会调 POST /api/v1/social/.../execute 走 SSE 流

import { CheckCircle2, XCircle, Loader2, Circle } from 'lucide-react'
import { STUDIO_NODES } from './nodes'
import { type Node } from '@xyflow/react'
import { type StudioNodeData } from './StudioNode'

export interface WorkflowRunState {
  nodes: Node[]
  isRunning: boolean
  startedAt: number | null
  finishedAt: number | null
}

export function WorkflowRunner({ state }: { state: WorkflowRunState }) {
  const { nodes, isRunning, startedAt, finishedAt } = state
  const total = nodes.length
  const done = nodes.filter((n) => (n.data as any).__status === 'success').length
  const failed = nodes.filter((n) => (n.data as any).__status === 'failed').length
  const running = nodes.filter((n) => (n.data as any).__status === 'running').length
  const progress = total > 0 ? (done + failed) / total : 0

  return (
    <aside
      className="w-72 bg-neutral-950 border-l border-neutral-800 p-3 overflow-y-auto flex-shrink-0"
      data-testid="studio-workflow-runner"
    >
      <h2 className="text-xs font-semibold text-neutral-300 mb-3 uppercase tracking-wider">
        运行状态
      </h2>
      <div className="mb-4 p-2.5 rounded bg-neutral-900/50 border border-neutral-800">
        <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
          <span>进度</span>
          <span>
            {done + failed}/{total}
          </span>
        </div>
        <div className="h-1.5 bg-neutral-800 rounded overflow-hidden">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${progress * 100}%` }}
            data-testid="studio-progress"
          />
        </div>
        {startedAt && (
          <div className="text-[10px] text-neutral-500 mt-1.5">
            {finishedAt
              ? `耗时 ${((finishedAt - startedAt) / 1000).toFixed(1)}s`
              : isRunning
                ? `运行中... ${((Date.now() - startedAt) / 1000).toFixed(1)}s`
                : '准备就绪'}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {nodes.length === 0 ? (
          <p className="text-[10px] text-neutral-600 leading-relaxed">
            拖节点到画布, 然后点"运行工作流"开始执行
          </p>
        ) : (
          nodes.map((n) => {
            const data = n.data as StudioNodeData
            const spec = STUDIO_NODES.find((s) => s.kind === data.kind)
            const status: 'idle' | 'running' | 'success' | 'failed' = (n.data as any).__status ?? 'idle'
            return (
              <div
                key={n.id}
                className="flex items-center gap-2 p-1.5 rounded border border-neutral-800 bg-neutral-900/30"
                data-testid={`runner-node-${data.kind}`}
                data-status={status}
              >
                {status === 'success' ? (
                  <CheckCircle2 size={12} className="text-emerald-400 flex-shrink-0" />
                ) : status === 'failed' ? (
                  <XCircle size={12} className="text-red-400 flex-shrink-0" />
                ) : status === 'running' ? (
                  <Loader2 size={12} className="text-blue-400 animate-spin flex-shrink-0" />
                ) : (
                  <Circle size={12} className="text-neutral-600 flex-shrink-0" />
                )}
                <span className="text-xs text-neutral-200 truncate">{spec?.label ?? data.kind}</span>
                {failed > 0 && status === 'failed' && (
                  <button
                    className="text-[10px] text-blue-400 hover:text-blue-300 ml-auto flex-shrink-0"
                    onClick={() => {
                      // 重试逻辑: 把 status 改回 idle, 让 StudioCanvas 再触发
                      ;(n.data as any).__status = 'idle'
                      // 简单通知父组件刷新 (React Flow 需要 setNodes 触发)
                      window.dispatchEvent(new CustomEvent('studio-retry-node', { detail: n.id }))
                    }}
                    data-testid={`runner-retry-${data.kind}`}
                  >
                    重试
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>

      {(running > 0 || isRunning) && (
        <div className="mt-4 p-2.5 rounded bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
          ⚡ 正在执行 {running} 节点, 完成后状态会更新
        </div>
      )}
      {done === total && total > 0 && !isRunning && (
        <div className="mt-4 p-2.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
          ✅ 全部 {total} 节点执行完成 ({failed > 0 ? `${failed} 失败` : '全部成功'})
        </div>
      )}
    </aside>
  )
}
