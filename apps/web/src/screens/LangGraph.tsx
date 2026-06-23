// apps/web/src/screens/LangGraph.tsx
import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GitGraph, Loader2, Play, CheckCircle } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

export function LangGraph() {
  const [status, setStatus] = useState<any>(null)
  const [tools, setTools] = useState<any[]>([])
  const [task, setTask] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const token = useAuthStore(s => s.accessToken)
  const base = import.meta.env.VITE_API_URL || ''

  useEffect(() => {
    fetch(`${base}/api/v1/langgraph/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setStatus).catch(() => {})
    fetch(`${base}/api/v1/langgraph/tools`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setTools(d.tools || [])).catch(() => {})
  }, [])

  const execute = async () => {
    setLoading(true)
    const res = await fetch(`${base}/api/v1/langgraph/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool: 'langgraph_agent_loop', args: { task, tools: '["web_search","write_file"]', max_steps: 5 } })
    })
    const d = await res.json()
    setResult(d.success ? d.data : `❌ ${d.error}`)
    setLoading(false)
  }

  return (
    <div className="h-full overflow-auto bg-neutral-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
            <GitGraph size={22} className="text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-100">LangGraph</h1>
            <p className="text-xs text-neutral-400">LangChain · 有状态多角色 Agent 图编排</p>
          </div>
        </div>

        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${status?.installed ? 'bg-green-400' : 'bg-neutral-600'}`} />
            <span className="text-sm text-neutral-200">{status?.installed ? '已安装' : '未安装'} · {tools.length} 工具</span>
          </div>
        </Card>

        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">Agent 循环测试</h2>
          <div className="flex gap-2">
            <Input value={task} onChange={e => setTask(e.target.value)} placeholder="输入任务..." className="flex-1 bg-neutral-950 border-neutral-800" />
            <Button onClick={execute} disabled={loading}><Play size={14} /></Button>
          </div>
          {result && <pre className="mt-3 p-3 rounded bg-neutral-950 text-xs text-neutral-300 font-mono whitespace-pre-wrap">{result}</pre>}
        </Card>

        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">工具集</h2>
          {tools.map((t, i) => (
            <div key={i} className="flex items-center gap-2 p-2 rounded bg-neutral-950/50 border border-neutral-800">
              <CheckCircle size={14} className="text-green-400" />
              <span className="text-xs font-mono text-neutral-200">{t.name}</span>
              <span className="text-[10px] text-neutral-500">{t.description}</span>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
