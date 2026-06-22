// apps/web/src/screens/Studio.tsx · Track C.2 (2026-06-15)
// ComfyUI 式工作流编辑器 (3 栏布局: NodePalette | StudioCanvas | WorkflowRunner)
// P0-fix (2026-06-18): 合并 Studio + 工作流 为统一"工作流编排"页面，顶部 Tab 切换
//
// 用 @xyflow/react 12.x 实现, 7 类节点 (3 社媒 + 4 AI/媒体/数据)
// 3 内置模板: 抖音爆款 / 小红书种草 / 公众号日报

import { useState } from 'react'
import { StudioCanvas } from '@/components/studio/StudioCanvas'
import { NodePalette } from '@/components/studio/NodePalette'
import { WorkflowRunner, type WorkflowRunState } from '@/components/studio/WorkflowRunner'
import { Workflows } from '@/screens/Workflows'
import { cn } from '@/lib/utils'

type StudioTab = 'compose' | 'templates'

export function Studio() {
  const [activeTab, setActiveTab] = useState<StudioTab>('compose')

  // 共享 state: StudioCanvas 内部管 nodes/edges, 这里存同样 state 供 WorkflowRunner 读
  const [state, setState] = useState<WorkflowRunState>({
    nodes: [],
    isRunning: false,
    startedAt: null,
    finishedAt: null,
  })

  function handleCanvasChange(s: { nodes: any[]; edges: any[] }) {
    setState((prev: WorkflowRunState) => ({ ...prev, nodes: s.nodes }))
  }

  function handleRunFinished() {
    setState((prev: WorkflowRunState) => ({ ...prev, isRunning: false, finishedAt: Date.now() }))
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-neutral-950" data-testid="studio-page">
      {/* P0-fix: Tab 切换器 */}
      <div className="flex border-b border-neutral-800 px-4">
        {([
          { id: 'compose' as const, label: '编排' },
          { id: 'templates' as const, label: '模板' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium transition-colors',
              activeTab === t.id
                ? 'text-brand border-b-2 border-brand'
                : 'text-neutral-400 hover:text-neutral-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'compose' && (
        <div className="flex flex-1 overflow-hidden">
          <NodePalette />
          <StudioCanvas
            onChange={handleCanvasChange}
            onRun={handleRunFinished}
          />
          <WorkflowRunner state={state} />
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="flex-1 overflow-auto">
          <Workflows />
        </div>
      )}
    </div>
  )
}
