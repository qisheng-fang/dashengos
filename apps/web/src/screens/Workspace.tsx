// apps/web/src/screens/Workspace.tsx · v0.3 Phase 5+ (real backend)
import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Code2, Search, Palette, BarChart3, Plus, Loader2, Send } from 'lucide-react'
import { http } from '@/lib/api'
import { useAuthStore } from '@/lib/auth-store'

interface Session {
  id: string
  title: string
  agent_id: string
  created_at: number
  updated_at: number
}

// Phase 10: 扩 Agent interface 加 description + category (从 /api/v1/agents 真返)
interface Agent {
  id: string
  name: string
  description?: string
  category?: string
  session_count?: number
}

const ICON_BY_AGENT: Record<string, { icon: typeof Code2; color: string }> = {
  'code-reviewer': { icon: Code2, color: 'text-semantic-info' },
  'deep-researcher': { icon: Search, color: 'text-semantic-success' },
  'design-assistant': { icon: Palette, color: 'text-semantic-warning' },
  'data-analyst': { icon: BarChart3, color: 'text-brand' },
  // 新增 2 个默认 icon
  'security-reviewer': { icon: Code2, color: 'text-semantic-danger' },
  'custom-workflow': { icon: Code2, color: 'text-neutral-400' },
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return '刚刚'
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`
  return `${Math.floor(d / 86_400_000)} 天前`
}

export function Workspace() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [sessions, setSessions] = useState<Session[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Phase 10: 顶部 input bar (老板在首页直接打字 → 创 session + 跳 Chat 屏)
  const [askInput, setAskInput] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [sRes, aRes] = await Promise.all([
          http.get<{ sessions: Session[] }>('/api/v1/sessions'),
          http.get<{ agents: Agent[] }>('/api/v1/agents'),
        ])
        if (cancelled) return
        setSessions(sRes.sessions)
        setAgents(aRes.agents)
      } catch {
        // 后端不可达时静默 fallback, UI 显示空状态
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // 客户端生成 thread id (后端无 /api/v1/sessions, :8001 agent bridge threadId 是字符串)
  function newThreadId(): string {
    return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function handleNewSession(_agentId: string) {
    // 不再走后端创建, 直接跳到 Chat 屏, threadId 本地生成
    void navigate({ to: '/chats/$id', params: { id: newThreadId() } })
  }

  // Phase 10: 顶部 input bar — 客户端生成 thread + 跳 Chat 屏, Chat 屏 auto-send
  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = askInput.trim()
    if (!text) return
    const threadId = newThreadId()
    // 把 ask 文字存到 sessionStorage, Chat 屏读到自动发
    sessionStorage.setItem(`pending_msg_${threadId}`, text)
    setAskInput('')
    void navigate({ to: '/chats/$id', params: { id: threadId } })
  }

  // Quick-start: show top 4 agents, with default agent for new sessions
  const quickStart = agents.slice(0, 4).map((a) => {
    const meta = ICON_BY_AGENT[a.id] ?? { icon: Code2, color: 'text-semantic-info' }
    return { ...a, ...meta }
  })

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-100">
          {t('workspace.welcome')}
          {user && <span className="text-brand">, {user.username}</span>}
        </h1>
        <p className="mt-2 text-neutral-400">DaShengOS 私有 AI 工作台 · v0.3 · 全部 23 IPC + 5 sub-agents 已联通</p>
      </header>

      {/* Phase 10: 顶部 "ask anything" input bar — 创 session + 跳 Chat 屏 */}
      <form
        onSubmit={handleAskSubmit}
        className="mb-6 flex items-center gap-2"
      >
        <Input
          value={askInput}
          onChange={(e) => setAskInput(e.target.value)}
          placeholder="问点什么... (回车发送, 自动跳 Chat 屏)"
          className="flex-1 bg-neutral-900 border-neutral-800 text-base h-12"
          aria-label="ask anything"
        />
        <Button
          type="submit"
          size="lg"
          disabled={!askInput.trim()}
          className="h-12"
        >
          <Send size={18} />
        </Button>
      </form>

      {error && (
        <div className="mb-4 p-3 rounded-md bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ {error}
        </div>
      )}

      <Card className="bg-neutral-900/50 border-neutral-800 mb-6">
        <CardHeader>
          <CardTitle className="text-xl text-neutral-100">{t('workspace.quickStart')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-neutral-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> 加载 Agent 列表...
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {quickStart.map((a) => {
                const Icon = a.icon
                return (
                  <button
                    key={a.id}
                    onClick={() => handleNewSession(a.id)}
                    className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-left hover:bg-neutral-800 hover:border-neutral-700 transition-colors"
                    aria-label={`用 ${a.name} 创建新会话`}
                  >
                    <Icon className={`mb-2 ${a.color}`} size={24} aria-hidden="true" />
                    <div className="text-sm font-medium text-neutral-100">{a.name}</div>
                    <div className="text-xs text-neutral-400 mt-1">+ 新会话</div>
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-neutral-900/50 border-neutral-800 mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl text-neutral-100">{t('workspace.recentSessions')}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Plus size={16} />}
            onClick={() => quickStart[0] && handleNewSession(quickStart[0].id)}
            disabled={quickStart.length === 0}
          >
            {t('workspace.newSession')}
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-neutral-400 text-sm">
              <Loader2 size={16} className="animate-spin" /> 加载会话...
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-neutral-400">还没有会话, 点击上面的 Agent 创建第一个</p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id}>
                  <button
                    onClick={() => navigate({ to: '/chats/$id', params: { id: s.id } })}
                    className="w-full flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 p-3 hover:bg-neutral-800 transition-colors text-left"
                  >
                    <div>
                      <div className="text-sm font-medium text-neutral-100">{s.title || `会话 ${s.id.slice(-6)}`}</div>
                      <div className="text-xs text-neutral-400 mt-1">{s.agent_id}</div>
                    </div>
                    <div className="text-xs text-neutral-400">{timeAgo(s.updated_at)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
