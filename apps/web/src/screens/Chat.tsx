// apps/web/src/screens/Chat.tsx · 2026-06-15
// 直连 :8001 Python DeerFlow 2.0 backend (AG-UI GraphQL 协议) — 通过 src/lib/agent-client.ts
// 不再打 :8000 (那个后端没 /api/v1/sessions/:id/messages 路由)
// 历史消息持久化到 localStorage (老板 hard reload 不丢历史)
// 6/15 老板拍板: backend 改用 deerflow (底层 LLM engine 还是 hermes-agent), 路径 /api/copilotkit → /api/agent
import { useEffect, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, Paperclip, AtSign, Bot, User, Loader2, Square } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { agentChat, type AgentMessage } from '@/lib/agent-client'

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

function uiToAgent(m: UiMessage): AgentMessage {
  return { id: m.id, role: m.role, content: m.content }
}

export function Chat() {
  const { id } = useParams({ from: '/_workspace/chats/$id' })
  const user = useAuthStore((s) => s.user)
  const [title, setTitle] = useState<string>('新会话')
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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

    try {
      const res = await agentChat({
        threadId: id,
        messages: next.map(uiToAgent),
        agentId: 'default',
      })
      if (res.assistantMessage) {
        const assistantMsg: UiMessage = {
          id: res.assistantMessage.id,
          role: 'assistant',
          content: res.assistantMessage.content,
          timestamp: Date.now(),
          latency_ms: res.latencyMs,
        }
        const updated = [...next, assistantMsg]
        setMessages(updated)
        saveHistory(id, updated)
      } else {
        setError(res.status.reason || 'agent 返回空消息')
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]">
      <header className="px-6 py-3 border-b border-neutral-800">
        <h1 className="text-sm font-medium text-neutral-100 truncate">{title}</h1>
        <div className="text-xs text-neutral-400 mt-0.5 font-mono">
          thread #{id?.slice(-12)} · backend :8001 (deerflow · Qwen2.5-72B)
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-2 p-2 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ {error}
          <div className="text-xs mt-1 opacity-70">
            检查 :8001 agent bridge (<code>curl http://localhost:8001/health</code>)
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
              后端: <code className="text-brand">:8001/api/agent</code> (deerflow · AG-UI 协议)
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
            <div className="text-sm text-neutral-400">deerflow 推理中...</div>
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
