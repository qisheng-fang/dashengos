// apps/web/src/screens/Chat.tsx · 2026-06-18 (D7-fix)
// 双模式聊天:
//   default agent → :8000 /api/v1/chat (backendChat, REST, 当前主用)
//   social agents → :8000 /api/v1/social (socialExecuteAuto, 社媒)
//   :8001 DeerFlow AG-UI (agentChat) 保留但暂未启用
// 历史消息持久化到 localStorage (老板 hard reload 不丢历史)
// Track B.3 (2026-06-15) activeAgent 状态 + 3 社媒 agent 路由
// Track C.1 (2026-06-15) 8 agent tab 切换器
// D7-fix (2026-06-18): default agent 从 :8001 切换到 :8000 后端
import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Send,
  Paperclip,
  AtSign,
  Bot,
  User,
  Loader2,
  Square,
  Video,
  BookOpen,
  Newspaper,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { backendChat } from '@/lib/agent-client'
import { socialExecuteAuto } from '@/lib/social-media-client'
import { AgentTabBar, type AgentTabId } from '@/components/chat-hermes/AgentTabBar'

interface UiMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  latency_ms?: number
}

function newId(): string {
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

// localStorage 持久化 (后端无 /api/v1/sessions/:id/messages)
const HISTORY_KEY = (id: string) => `dasheng_chat_history_${id}`
const TITLE_KEY = (id: string) => `dasheng_chat_title_${id}`

function loadHistory(id: string): UiMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY(id))
    return raw ? (JSON.parse(raw) as UiMessage[]) : []
  } catch {
    return []
  }
}
function saveHistory(id: string, msgs: UiMessage[]) {
  try {
    localStorage.setItem(HISTORY_KEY(id), JSON.stringify(msgs.slice(-200)))
  } catch {
    // ignore quota
  }
}
function loadTitle(id: string): string {
  return localStorage.getItem(TITLE_KEY(id)) || '新会话'
}
function saveTitle(id: string, t: string) {
  try {
    localStorage.setItem(TITLE_KEY(id), t)
  } catch {
    // ignore
  }
}


export function Chat() {
  const { id } = useParams({ from: '/_workspace/chats/$id' })
  const user = useAuthStore((s) => s.user)
  const [title, setTitle] = useState<string>('新会话')
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track B.3 · activeAgent — 'default' 走 :8001 DeerFlow LLM; 3 social 走 :8000 /api/v1/social
  const [activeAgent, setActiveAgent] = useState<'default' | 'DouyinAgent' | 'XiaohongshuAgent' | 'WechatAgent'>('default')
  const bottomRef = useRef<HTMLDivElement>(null)

  // 3 社媒 agent 配置 (跟 packages/backend BUILTIN_AGENTS 对齐)
  const SOCIAL_AGENTS = useMemo(
    () => ({
      DouyinAgent: { name: '抖音', icon: Video, color: 'text-pink-400' },
      XiaohongshuAgent: { name: '小红书', icon: BookOpen, color: 'text-rose-400' },
      WechatAgent: { name: '公众号', icon: Newspaper, color: 'text-emerald-400' },
    }),
    [],
  )

  // 关键字自动路由 — 输入含 抖音/小红书/微信 字样, 自动切 social agent
  function autoRouteAgent(text: string): 'default' | 'DouyinAgent' | 'XiaohongshuAgent' | 'WechatAgent' {
    const t = text.toLowerCase()
    if (/(抖音|douyin|tiktok)/i.test(text) || /douyin|tiktok/.test(t)) return 'DouyinAgent'
    if (/(小红书|xhs|xiaohongshu|种草)/i.test(text) || /xhs|xiaohongshu/.test(t)) return 'XiaohongshuAgent'
    if (/(公众号|微信|wechat|推文|订阅号|服务号)/i.test(text) || /wechat|mp/.test(t)) return 'WechatAgent'
    return 'default'
  }

  // 加载历史 (localStorage)
  useEffect(() => {
    if (!id) return
    setTitle(loadTitle(id))
    setMessages(loadHistory(id))
  }, [id])

  // 自动填入 pending 消息 (从 Workspace "问点什么" 来)
  const [pendingLoaded, setPendingLoaded] = useState(false)
  useEffect(() => {
    if (!id || pendingLoaded) return
    setPendingLoaded(true)
    const pending = sessionStorage.getItem(`pending_msg_${id}`)
    if (!pending) return
    sessionStorage.removeItem(`pending_msg_${id}`)
    setDraft(pending)
    setTimeout(() => {
      document.querySelector<HTMLInputElement>('input[aria-label="消息输入"]')?.focus()
    }, 50)
  }, [id, pendingLoaded])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function send() {
    if (!id || sending) return
    const text = draft.trim()
    if (!text) return

    // Track B.3 · 输入框 关键字自动路由 (不打断用户, 仅预设)
    const targetAgent = autoRouteAgent(text)
    if (targetAgent !== 'default') {
      setActiveAgent(targetAgent)
    }

    const userMsg: UiMessage = {
      id: newId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    const next = [...messages, userMsg]
    setMessages(next)
    saveHistory(id, next)
    if (messages.length === 0) {
      const newTitle = text.slice(0, 30)
      setTitle(newTitle)
      saveTitle(id, newTitle)
    }
    setDraft('')
    setSending(true)
    setError(null)

    // Track B.3 · 按 activeAgent 路由: social 走 :8000 /api/v1/social, 其他走 :8001 DeerFlow
    if (targetAgent !== 'default') {
      try {
        const res = await socialExecuteAuto(targetAgent, { message: text })
        const replyText = res.content
          ? res.content
          : res.error_human || res.error || 'social agent 返回空结果'
        // 后端 'auto' 返 data: { steps, last_step }, 提取 details 给老板看
        const data = res.data as { steps?: Array<{ step: string; ok: boolean; data?: unknown; error?: string }>; last_step?: unknown } | undefined
        const detailParts: string[] = []
        if (data?.steps) {
          for (const s of data.steps) {
            const stepResult = (s.data as any)?.is_real !== undefined
              ? `is_real=${(s.data as any).is_real}`
              : (s.data as any)?.upload_id
                ? `upload_id=${(s.data as any).upload_id}`
                : ''
            detailParts.push(`- **${s.step}**: ${s.ok ? 'OK' : 'FAIL'}${stepResult ? ' (' + stepResult + ')' : ''}${s.error ? ' · ' + s.error : ''}`)
          }
        }
        const detail = detailParts.length > 0 ? '\n\n' + detailParts.join('\n') : ''
        const isReal = res.is_real ? '\n\n✅ **真数据接入**' : '\n\n⚠️ **Mock 数据** (worker 不可达 或 凭证缺失)'
        const assistantMsg: UiMessage = {
          id: newId(),
          role: 'assistant',
          content: `${replyText}${detail}${isReal}`,
          timestamp: Date.now(),
          latency_ms: res.duration_ms,
        }
        const updated = [...next, assistantMsg]
        setMessages(updated)
        saveHistory(id, updated)
        if (!res.ok) {
          setError(res.error_human || res.error || 'social agent 调用失败')
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setSending(false)
      }
      return
    }

    try {
      // D7-fix: default agent 走 :8000 后端 /api/v1/chat (不再走失效的 :8001)
      const token = useAuthStore.getState().accessToken
      if (!token) {
        throw new Error('未登录，请先登录后重试')
      }
      const res = await backendChat({
        message: text,
        threadId: id,
        history: next.map((m) => ({ role: m.role, content: m.content })),
        token,
      })
      if (res.report) {
        const assistantMsg: UiMessage = {
          id: newId(),
          role: 'assistant',
          content: res.report,
          timestamp: Date.now(),
          latency_ms: (res as any).latencyMs,
        }
        const updated = [...next, assistantMsg]
        setMessages(updated)
        saveHistory(id, updated)
      } else {
        setError(res.status === 'completed' ? 'AI 返回空回复' : `AI 引擎错误: ${res.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  // Track B.3 · Agent 切换器配置 (activeAgent + 3 社媒)
  const agentOptions = [
    { id: 'default' as const, name: '默认 LLM', icon: Bot, color: 'text-semantic-info' },
    ...Object.entries(SOCIAL_AGENTS).map(([id, cfg]) => ({
      id: id as 'DouyinAgent' | 'XiaohongshuAgent' | 'WechatAgent',
      ...cfg,
    })),
  ]

  // Track C.1 · 当前 activeAgent 映射到 AgentTabBar tab id
  const tabId: AgentTabId =
    activeAgent === 'default'
      ? 'default'
      : activeAgent === 'DouyinAgent'
        ? 'DouyinAgent'
        : activeAgent === 'XiaohongshuAgent'
          ? 'XiaohongshuAgent'
          : 'WechatAgent'

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="px-6 py-3 border-b border-neutral-800">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium text-neutral-100 truncate">{title}</h1>
            <div className="text-xs text-neutral-400 mt-0.5 font-mono">
              thread #{id?.slice(-12)} ·{' '}
              {activeAgent === 'default'
                ? 'backend :8000 (LLM · SiliconFlow/DeepSeek)'
                : `social :8000 → ${activeAgent}`}
            </div>
          </div>
          {/* Track B.3 · 4 Agent 切换器 (默认 + 3 社媒) */}
          <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 rounded-lg p-1 flex-shrink-0">
            {agentOptions.map((a) => {
              const Icon = a.icon
              const isActive = a.id === activeAgent
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActiveAgent(a.id)}
                  disabled={sending}
                  data-testid={`agent-tab-${a.id}`}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    isActive
                      ? `bg-brand/15 ${a.color} ring-1 ring-brand/40`
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                  } ${sending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                  title={a.name}
                >
                  <Icon size={13} aria-hidden="true" />
                  <span className="hidden sm:inline">{a.name}</span>
                </button>
              )
            })}
          </div>
          {/* Track C.1 · 10 agent tab 切换器 (8 sandbox + 3 social, 含 default) */}
          <AgentTabBar
            active={tabId}
            onChange={(id) => {
              if (id === 'default') {
                setActiveAgent('default')
              } else if (
                id === 'DouyinAgent' ||
                id === 'XiaohongshuAgent' ||
                id === 'WechatAgent'
              ) {
                setActiveAgent(id)
              }
              // sandbox tab (EcommerceAgent/CRMAgent 等) 暂未接 social, 走 default
            }}
          />
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-2 p-2 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ {error}
          <div className="text-xs mt-1 opacity-70">
            检查 :8000 后端 (<code>curl http://localhost:8000/api/v1/status</code>)
          </div>
        </div>
      )}

      <div
        className="flex-1 overflow-auto p-3 md:p-6 space-y-4"
        role="log"
        aria-live="polite"
        aria-label="对话消息"
      >
        {messages.length === 0 && !sending && (
          <div className="text-center mt-12 space-y-2">
            <p className="text-sm text-neutral-500">
              {user ? `${user.username}, 发条消息开始吧` : '发条消息开始吧'}
            </p>
            <p className="text-xs text-neutral-600">
              后端: <code className="text-brand">:8000/api/v1/chat</code> (LLM · REST)
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex gap-3 max-w-3xl">
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                m.role === 'user' ? 'bg-brand/20' : 'bg-semantic-info/20'
              }`}
            >
              {m.role === 'user' ? (
                <User size={16} className="text-brand" aria-hidden="true" />
              ) : (
                <Bot size={16} className="text-semantic-info" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs text-neutral-400 mb-1">
                <span className="font-medium text-neutral-300">
                  {m.role === 'user' ? user?.username || '你' : 'Assistant'}
                </span>
                {m.latency_ms !== undefined && <span>· {m.latency_ms}ms</span>}
                <span>· {new Date(m.timestamp).toLocaleTimeString()}</span>
              </div>
              <Card className="bg-neutral-900 border-neutral-800 p-3">
                <p className="text-sm text-neutral-100 whitespace-pre-wrap break-words">{m.content}</p>
              </Card>
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-3 max-w-3xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-semantic-info/20 flex items-center justify-center">
              <Loader2 size={16} className="text-semantic-info animate-spin" />
            </div>
            <div className="text-sm text-neutral-400">AI 思考中...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <footer className="border-t border-neutral-800 p-3 md:p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
          className="flex items-center gap-2 max-w-4xl mx-auto"
        >
          <Button type="button" variant="ghost" size="icon" aria-label="附件">
            <Paperclip />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="提及 Agent">
            <AtSign />
          </Button>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 bg-neutral-900 border-neutral-800"
            disabled={sending}
            aria-label="消息输入"
          />
          {sending ? (
            <Button type="button" size="icon" variant="ghost" aria-label="停止生成" disabled>
              <Square />
            </Button>
          ) : (
            <Button type="submit" size="icon" aria-label="发送消息" disabled={!draft.trim()}>
              <Send />
            </Button>
          )}
        </form>
      </footer>
    </div>
  )
}
