// apps/web/src/screens/Studio.tsx · Track C.2 (2026-06-15)
// ComfyUI 式工作流编辑器 (3 栏布局: NodePalette | StudioCanvas | WorkflowRunner)
// 用 @xyflow/react 12.x 实现, 7 类节点 (3 社媒 + 4 AI/媒体/数据)
// 3 内置模板: 抖音爆款 / 小红书种草 / 公众号日报

import { useState } from 'react'
import { StudioCanvas } from '@/components/studio/StudioCanvas'
import { NodePalette } from '@/components/studio/NodePalette'
import { WorkflowRunner, type WorkflowRunState } from '@/components/studio/WorkflowRunner'

export function Studio() {
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
    <div className="flex h-[calc(100vh-3.5rem)] bg-neutral-950" data-testid="studio-page">
      <NodePalette />
      <StudioCanvas
        onChange={handleCanvasChange}
        onRun={handleRunFinished}
      />
      <WorkflowRunner state={state} />
    </div>
  )
}
