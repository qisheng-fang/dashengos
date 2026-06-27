// apps/web/src/screens/LangGraph.tsx · DaShengOS v8.6
// 流图编辑器 — 节点 + 连线 + 执行

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { http } from '@/lib/api'
import { Play, Plus, GitBranch, Activity, Loader2, CheckCircle, XCircle, Circle } from 'lucide-react'

interface GraphNode { id: string; type: string; label: string; x: number; y: number }
interface GraphEdge { from: string; to: string; condition?: string }
interface GraphDef { nodes: GraphNode[]; edges: GraphEdge[] }
interface ExecResult { status: string; steps: Array<{ nodeId: string; output: string; durationMs: number }>; finalOutput?: string }

export function LangGraph() {
  const [graph, setGraph] = useState<GraphDef>({ nodes: [], edges: [] })
  const [tools, setTools] = useState<string[]>([])
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)
  const [showAddNode, setShowAddNode] = useState(false)
  const [newNode, setNewNode] = useState({ type: 'agent', label: '' })

  // Load available tools
  useEffect(() => {
    http.get('/api/v1/langgraph/tools').then(({ data }) => setTools(data?.tools || [])).catch(() => {})
    http.get('/api/v1/langgraph/status').then(({ data }) => {
      if (data?.graph) setGraph(data.graph)
    }).catch(() => {})
  }, [])

  const addNode = () => {
    if (!newNode.label) return
    setGraph(prev => ({
      ...prev,
      nodes: [...prev.nodes, { id: 'n' + Date.now(), type: newNode.type, label: newNode.label, x: prev.nodes.length * 180 + 50, y: 100 }],
    }))
    setNewNode({ type: 'agent', label: '' })
    setShowAddNode(false)
  }

  const addEdge = (from: string, to: string) => {
    if (from === to) return
    if (graph.edges.some(e => e.from === from && e.to === to)) return
    setGraph(prev => ({ ...prev, edges: [...prev.edges, { from, to }] }))
  }

  const removeNode = (id: string) => {
    setGraph(prev => ({
      nodes: prev.nodes.filter(n => n.id !== id),
      edges: prev.edges.filter(e => e.from !== id && e.to !== id),
    }))
  }

  const removeEdge = (idx: number) => {
    setGraph(prev => ({ ...prev, edges: prev.edges.filter((_, i) => i !== idx) }))
  }

  const execute = async () => {
    setExecuting(true); setResult(null)
    try {
      const { data } = await http.post('/api/v1/langgraph/orchestrator/execute', { graph, task: 'Execute graph pipeline' })
      setResult(data)
    } catch (e: any) { setResult({ status: 'error', steps: [], finalOutput: e.message }) }
    setExecuting(false)
  }

  // Build graph via API
  const buildGraph = async () => {
    try {
      await http.post('/api/v1/langgraph/orchestrator/graph', graph)
    } catch { /* ok */ }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">LangGraph 流图编辑器</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={buildGraph} disabled={graph.nodes.length === 0}>
            <GitBranch className="w-4 h-4 mr-2" />构建图
          </Button>
          <Button onClick={execute} disabled={executing || graph.nodes.length === 0}>
            {executing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            执行
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Node list */}
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              节点 ({graph.nodes.length})
              <Button size="sm" variant="ghost" onClick={() => setShowAddNode(!showAddNode)}><Plus className="w-4 h-4" /></Button>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {showAddNode && (
              <div className="flex gap-2 mb-3">
                <Input placeholder="节点名称" value={newNode.label} onChange={e => setNewNode({...newNode, label: e.target.value})} className="flex-1" />
                <select value={newNode.type} onChange={e => setNewNode({...newNode, type: e.target.value})} className="border rounded px-2">
                  <option value="agent">Agent</option><option value="tool">Tool</option><option value="condition">Condition</option><option value="output">Output</option>
                </select>
                <Button size="sm" onClick={addNode}>添加</Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {graph.nodes.map(node => (
                <Badge key={node.id} variant="outline" className="cursor-pointer flex items-center gap-1 px-3 py-1.5" onClick={() => removeNode(node.id)}>
                  <Circle className="w-2 h-2 fill-current" />{node.label}
                  <XCircle className="w-3 h-3 ml-1 opacity-50 hover:opacity-100" />
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tools */}
        <Card>
          <CardHeader><CardTitle>可用工具 ({tools.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {tools.map(t => <div key={t} className="text-sm text-muted-foreground">{t}</div>)}
              {tools.length === 0 && <div className="text-sm text-muted-foreground">加载中...</div>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edges */}
      {graph.edges.length > 0 && (
        <Card>
          <CardHeader><CardTitle>连线 ({graph.edges.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {graph.edges.map((edge, i) => {
                const fromNode = graph.nodes.find(n => n.id === edge.from)
                const toNode = graph.nodes.find(n => n.id === edge.to)
                return (
                  <Badge key={i} variant="secondary" className="cursor-pointer" onClick={() => removeEdge(i)}>
                    {fromNode?.label || edge.from} → {toNode?.label || edge.to}
                    <XCircle className="w-3 h-3 ml-1" />
                  </Badge>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {graph.nodes.map(from => graph.nodes.filter(to => to.id !== from.id).map(to => (
                <Button key={from.id + to.id} size="sm" variant="ghost" className="text-xs" onClick={() => addEdge(from.id, to.id)}>
                  {from.label} → {to.label}
                </Button>
              )))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Execution Result */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              执行结果
              {result.status === 'completed' ? <CheckCircle className="w-4 h-4 text-green-500" /> :
               result.status === 'error' ? <XCircle className="w-4 h-4 text-red-500" /> : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.steps?.map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-sm py-1">
                <Badge variant="outline">{s.nodeId}</Badge>
                <span className="text-muted-foreground">{s.output?.slice(0, 100)}</span>
                <span className="text-xs text-muted-foreground ml-auto">{s.durationMs}ms</span>
              </div>
            ))}
            {result.finalOutput && (
              <div className="mt-3 p-3 bg-muted rounded text-sm">{result.finalOutput.slice(0, 500)}</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
