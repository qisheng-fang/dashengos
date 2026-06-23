// apps/web/src/screens/AgentTARS.tsx · DaShengOS v6.0
// Agent TARS — ByteDance 多模态 GUI Agent 集成页面
import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bot, ExternalLink, Loader2, CheckCircle, XCircle, RefreshCw, Play } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

interface MCPTool {
  name: string
  description: string
  serverName: string
  riskLevel: string
}

export function AgentTARS() {
  const [status, setStatus] = useState<'stopped' | 'launching' | 'running' | 'error'>('stopped')
  const [tools, setTools] = useState<MCPTool[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const token = useAuthStore((s) => s.accessToken)

  const checkStatus = async () => {
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/v1/agent-tars/status`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setStatus(data.running ? 'running' : 'stopped')
        setTools(data.tools || [])
        setMessage(data.message || '')
      }
    } catch {
      // TARS not reachable
    }
  }

  useEffect(() => {
    checkStatus()
    const interval = setInterval(checkStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const launchTARS = async () => {
    setLoading(true)
    setStatus('launching')
    setMessage('正在启动 Agent TARS...')
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/v1/agent-tars/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      })
      const data = await res.json()
      if (data.success) {
        setStatus('running')
        setMessage('Agent TARS 已启动')
        setTools(data.tools || [])
      } else {
        setStatus('error')
        setMessage(data.error || '启动失败')
      }
    } catch (e) {
      setStatus('error')
      setMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const registerMCP = async () => {
    setLoading(true)
    try {
      const baseUrl = import.meta.env.VITE_API_URL || ''
      const res = await fetch(`${baseUrl}/api/v1/agent-tars/register-mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        }
      })
      const data = await res.json()
      if (data.success) {
        setMessage(`已注册 ${data.count || 0} 个 MCP 工具`)
        checkStatus()
      } else {
        setMessage(data.error || '注册失败')
      }
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full overflow-auto bg-neutral-950 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Bot size={22} className="text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-neutral-100">Agent TARS</h1>
            <p className="text-xs text-neutral-400">
              ByteDance · 多模态 GUI Agent · 视觉浏览器控制
            </p>
          </div>
        </div>

        {/* Status Card */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${
                status === 'running' ? 'bg-green-400 animate-pulse' :
                status === 'launching' ? 'bg-amber-400 animate-pulse' :
                status === 'error' ? 'bg-red-400' : 'bg-neutral-600'
              }`} />
              <span className="text-sm font-medium text-neutral-200">
                {status === 'running' ? '运行中' :
                 status === 'launching' ? '启动中...' :
                 status === 'error' ? '异常' : '未启动'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost" size="sm"
                onClick={checkStatus}
                disabled={loading}
                className="text-xs"
              >
                <RefreshCw size={12} className="mr-1" />
                刷新
              </Button>
              {status !== 'running' ? (
                <Button
                  size="sm"
                  onClick={launchTARS}
                  disabled={loading}
                  className="text-xs bg-violet-600 hover:bg-violet-700"
                >
                  {loading ? <Loader2 size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
                  启动 Agent TARS
                </Button>
              ) : (
                <Button
                  size="sm" variant="outline"
                  onClick={registerMCP}
                  disabled={loading}
                  className="text-xs"
                >
                  <ExternalLink size={12} className="mr-1" />
                  注册 MCP 工具
                </Button>
              )}
            </div>
          </div>
          {message && (
            <p className="text-xs text-neutral-400 mt-3">{message}</p>
          )}
        </Card>

        {/* MCP Tools */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-3">
            MCP 工具集 {tools.length > 0 && `(${tools.length})`}
          </h2>
          {tools.length === 0 ? (
            <p className="text-xs text-neutral-500">
              {status === 'running'
                ? 'Agent TARS 运行中，点击"注册 MCP 工具"载入工具'
                : '启动 Agent TARS 后可注册其 MCP 工具（浏览器控制、命令执行、文件系统）'}
            </p>
          ) : (
            <div className="space-y-2">
              {tools.map((tool, i) => (
                <div key={i} className="flex items-center gap-2 p-2 rounded bg-neutral-950/50 border border-neutral-800">
                  <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-mono text-neutral-200">{tool.name}</span>
                    <span className="text-[10px] text-neutral-500 ml-2">{tool.description?.slice(0, 60)}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    tool.riskLevel === 'EXEC' ? 'bg-red-500/10 text-red-400' :
                    tool.riskLevel === 'WRITE' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-blue-500/10 text-blue-400'
                  }`}>{tool.riskLevel}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Info */}
        <Card className="bg-neutral-900 border-neutral-800 p-5">
          <h2 className="text-sm font-semibold text-neutral-200 mb-2">关于 Agent TARS</h2>
          <ul className="text-xs text-neutral-400 space-y-1">
            <li>· 视觉浏览器控制 — 解析网页截图执行操作</li>
            <li>· 命令行集成 — 执行任意命令和脚本</li>
            <li>· 文件系统访问 — 读写本地文件</li>
            <li>· MCP 协议 — 标准 Model Context Protocol</li>
            <li className="text-neutral-600 mt-2">
              路径: <code className="text-neutral-500">/Users/apple/WorkBuddy/2026-06-22-08-37-30/AgentTARS</code>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
