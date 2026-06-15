// apps/web/src/components/studio/StudioCanvas.tsx · Track C.2 (2026-06-15)
// React Flow 画布封装 (@xyflow/react 12.x)
// - 拖节点 (从 NodePalette) 到画布创建新节点
// - 节点之间拖线连边 (handle system)
// - 节点状态: idle / running / success / failed (WorkflowRunner 控制)
// - 内置 3 模板: 抖音爆款 / 小红书种草 / 公众号日报

import { useCallback, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  applyNodeChanges,
  applyEdgeChanges,
  type EdgeChange,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { NODE_TYPES, type StudioNodeData } from './StudioNode'
import { STUDIO_NODES, type StudioNodeKind } from './nodes'
import { Play, RotateCcw, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { socialExecuteAuto } from '@/lib/social-media-client'

export interface StudioCanvasProps {
  workflow?: { nodes: Node[]; edges: Edge[]; name?: string }
  onChange?: (state: { nodes: Node[]; edges: Edge[] }) => void
  onRun?: (state: { nodes: Node[]; edges: Edge[] }) => void
}

let _idCounter = 1
function nextNodeId() {
  return `n_${Date.now()}_${_idCounter++}`
}

/** 内置 3 模板: 抖音爆款 / 小红书种草 / 公众号日报 */
const TEMPLATES: Array<{ name: string; description: string; nodes: Node[]; edges: Edge[] }> = [
  {
    name: '抖音爆款流水线',
    description: 'AI 内容 → 视频生成 → 抖音上传',
    nodes: [
      {
        id: 'tpl_dy_1', type: 'studio', position: { x: 50, y: 100 },
        data: { kind: 'content', params: { prompt: '为 AI 工具写一段 30 字爆款文案' } } as StudioNodeData,
      },
      {
        id: 'tpl_dy_2', type: 'studio', position: { x: 350, y: 100 },
        data: { kind: 'video_gen', params: { topic: 'AI 工具', duration: 30 } } as StudioNodeData,
      },
      {
        id: 'tpl_dy_3', type: 'studio', position: { x: 650, y: 100 },
        data: { kind: 'douyin', params: { platform: 'douyin', title: '新视频', tags: ['#AI'] } } as StudioNodeData,
      },
    ],
    edges: [
      { id: 'e1', source: 'tpl_dy_1', target: 'tpl_dy_2', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'e2', source: 'tpl_dy_2', target: 'tpl_dy_3', sourceHandle: 'out', targetHandle: 'in' },
    ],
  },
  {
    name: '小红书种草流水线',
    description: 'Trending 抓 → LLM 文案 → 小红书笔记',
    nodes: [
      {
        id: 'tpl_xhs_1', type: 'studio', position: { x: 50, y: 100 },
        data: { kind: 'data_crawl', params: { topic: '种草', platform: 'douyin' } } as StudioNodeData,
      },
      {
        id: 'tpl_xhs_2', type: 'studio', position: { x: 350, y: 100 },
        data: { kind: 'content', params: { prompt: '基于 trending 写小红书种草笔记' } } as StudioNodeData,
      },
      {
        id: 'tpl_xhs_3', type: 'studio', position: { x: 650, y: 100 },
        data: { kind: 'xiaohongshu', params: { platform: 'xiaohongshu', title: '种草笔记' } } as StudioNodeData,
      },
    ],
    edges: [
      { id: 'e1', source: 'tpl_xhs_1', target: 'tpl_xhs_2', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'e2', source: 'tpl_xhs_2', target: 'tpl_xhs_3', sourceHandle: 'out', targetHandle: 'in' },
    ],
  },
  {
    name: '公众号日报流水线',
    description: '数据回采 → LLM 总结 → 公众号发文',
    nodes: [
      {
        id: 'tpl_mp_1', type: 'studio', position: { x: 50, y: 100 },
        data: { kind: 'data_crawl', params: { topic: '今日销售', platform: 'all' } } as StudioNodeData,
      },
      {
        id: 'tpl_mp_2', type: 'studio', position: { x: 350, y: 100 },
        data: { kind: 'content', params: { prompt: '根据数据生成日报' } } as StudioNodeData,
      },
      {
        id: 'tpl_mp_3', type: 'studio', position: { x: 650, y: 100 },
        data: { kind: 'wechat', params: { title: '今日销售日报', content: '## 摘要\n\n...' } } as StudioNodeData,
      },
    ],
    edges: [
      { id: 'e1', source: 'tpl_mp_1', target: 'tpl_mp_2', sourceHandle: 'out', targetHandle: 'in' },
      { id: 'e2', source: 'tpl_mp_2', target: 'tpl_mp_3', sourceHandle: 'out', targetHandle: 'in' },
    ],
  },
]

export function StudioCanvas({ workflow, onChange, onRun }: StudioCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(workflow?.nodes ?? [])
  const [edges, setEdges] = useState<Edge[]>(workflow?.edges ?? [])
  const [isRunning, setIsRunning] = useState(false)

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const next = applyNodeChanges(changes, nds)
        onChange?.({ nodes: next, edges })
        return next
      })
    },
    [edges, onChange],
  )

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => {
        const next = applyEdgeChanges(changes, eds)
        onChange?.({ nodes, edges: next })
        return next
      })
    },
    [nodes, onChange],
  )

  const onConnect: OnConnect = useCallback(
    (conn: Connection) => {
      setEdges((eds) => {
        const next = eds.concat({
          id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          source: conn.source!,
          target: conn.target!,
          sourceHandle: conn.sourceHandle ?? undefined,
          targetHandle: conn.targetHandle ?? undefined,
        })
        onChange?.({ nodes, edges: next })
        return next
      })
    },
    [nodes, onChange],
  )

  // 拖拽放下: 从 NodePalette 拖到画布时创建节点
  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const kind = event.dataTransfer.getData('application/studio-node') as StudioNodeKind
      if (!kind) return
      const spec = STUDIO_NODES.find((n) => n.kind === kind)
      if (!spec) return
      // React Flow 12 用 flowToScreenPosition 计算画布位置
      const position = { x: event.clientX - 320, y: event.clientY - 100 }  // 简化: 直接用 clientX/Y
      const newNode: Node = {
        id: nextNodeId(),
        type: 'studio',
        position,
        data: { kind, params: { ...spec.defaultParams } } as StudioNodeData,
      }
      setNodes((nds) => {
        const next = [...nds, newNode]
        onChange?.({ nodes: next, edges })
        return next
      })
    },
    [edges, onChange],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  // 工作流运行: 拓扑顺序触发每个 social 节点
  async function handleRun() {
    if (isRunning) return
    setIsRunning(true)
    try {
      // 简单拓扑排序 (BFS)
      const order: string[] = []
      const visited = new Set<string>()
      const incoming = new Map<string, string[]>()
      edges.forEach((e) => {
        const arr = incoming.get(e.target) ?? []
        arr.push(e.source)
        incoming.set(e.target, arr)
      })
      const queue = nodes.filter((n) => !incoming.get(n.id)?.length).map((n) => n.id)
      while (queue.length) {
        const id = queue.shift()!
        if (visited.has(id)) continue
        visited.add(id)
        order.push(id)
        edges
          .filter((e) => e.source === id)
          .forEach((e) => queue.push(e.target))
      }
      // 触发 social 节点 (Douyin/Xiaohongshu/Wechat)
      for (const id of order) {
        const node = nodes.find((n) => n.id === id)
        if (!node) continue
        const data = node.data as StudioNodeData
        // 标记 running
        setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, __status: 'running' } } : n)))
        if (data.kind === 'douyin' || data.kind === 'xiaohongshu' || data.kind === 'wechat') {
          const agentId =
            data.kind === 'douyin' ? 'DouyinAgent' : data.kind === 'xiaohongshu' ? 'XiaohongshuAgent' : 'WechatAgent'
          try {
            await socialExecuteAuto(agentId, { message: JSON.stringify(data.params) })
            setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, __status: 'success' } } : n)))
          } catch (e) {
            setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, __status: 'failed' } } : n)))
          }
        } else {
          // 其他节点 (LLM / data_crawl / video) 暂 mock success
          await new Promise((r) => setTimeout(r, 200))
          setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, __status: 'success' } } : n)))
        }
      }
      onRun?.({ nodes, edges })
    } finally {
      setIsRunning(false)
    }
  }

  function loadTemplate(idx: number) {
    const t = TEMPLATES[idx]
    if (!t) return
    setNodes(t.nodes.map((n) => ({ ...n })))
    setEdges(t.edges.map((e) => ({ ...e })))
    onChange?.({ nodes: t.nodes, edges: t.edges })
  }

  return (
    <div className="flex-1 flex flex-col bg-neutral-950 min-w-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-800 bg-neutral-900/50">
        <div className="flex items-center gap-1.5">
          {TEMPLATES.map((t, i) => (
            <Button
              key={t.name}
              variant="ghost"
              size="sm"
              onClick={() => loadTemplate(i)}
              data-testid={`tpl-${i}`}
              title={t.description}
            >
              <FolderOpen size={12} />
              {t.name}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNodes([])
              setEdges([])
              onChange?.({ nodes: [], edges: [] })
            }}
            disabled={isRunning}
            data-testid="studio-reset"
          >
            <RotateCcw size={12} />
            清空
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleRun}
            disabled={isRunning || nodes.length === 0}
            data-testid="studio-run"
          >
            <Play size={12} />
            {isRunning ? '运行中...' : '运行工作流'}
          </Button>
        </div>
      </div>
      <div className="flex-1" onDrop={onDrop} onDragOver={onDragOver}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          fitView
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#404040" gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeStrokeWidth={2} maskColor="rgba(0,0,0,0.6)" />
        </ReactFlow>
      </div>
    </div>
  )
}
