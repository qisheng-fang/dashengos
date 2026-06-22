// apps/web/src/screens/Chat.tsx · 2026-06-18 (D7-fix)
// 双模式聊天:
//   default agent → :8001 Agent Bridge (agentChat, Agent Loop, 当前主用)
//   social agents → :8000 /api/v1/social (socialExecuteAuto, 社媒)
//   stream 模式 → :8000 SSE 流式 (备选)
// 历史消息持久化到 localStorage (老板 hard reload 不丢历史)
// Track B.3 (2026-06-15) activeAgent 状态 + 3 社媒 agent 路由
// Track C.1 (2026-06-15) 8 agent tab 切换器
// P0-fix (2026-06-18): default agent 从 REST 改为 SSE 流式，统一与 CommandCenter 体验
import { useEffect, useRef, useState } from 'react'
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
  Zap,
  CircleDot,
  Cpu,
  MessageCircle,
} from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { socialExecuteAuto } from '@/lib/social-media-client'
import { agentChat } from '@/lib/agent-client'
import { AgentTabBar, type AgentTabId } from '@/components/chat-hermes/AgentTabBar'
import { usePreviewStore } from '@/store/preview'
import { useProjectContext } from '@/store/project-context'
import { FolderGit2, X } from 'lucide-react'  // 2026-06-20

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

/** 粗略估算 token 数（中文约 1.5 char/token） */
function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseLen = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherLen = text.length - chineseLen
  return Math.ceil(chineseLen / 1.5 + otherLen / 4)
}

/** P0-fix: SSE 流式聊天 */
interface StreamHandlers {
  onStatus: (text: string) => void
  onToken: (chunk: string) => void
  onToolCall: (name: string, args: string) => void
  onToolStart: (name: string, args: string) => void
  onToolEnd: (name: string, ok: boolean, summary: string) => void
  onThinking: (text: string) => void
  onSearching: (query: string) => void
  onDone: () => void
  onError: (msg: string) => void
}

async function streamChatSSE(
  message: string,
  history: Array<{ role: string; content: string }>,
  token: string,
  signal: AbortSignal,
  handlers: StreamHandlers,
) {
  const baseUrl = import.meta.env.VITE_API_URL || ''
  const response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ message, history }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  if (!response.body) throw new Error('No response body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      let eventType = ''
      let dataStr = ''
      for (const part of line.split('\n')) {
        if (part.startsWith('event:')) eventType = part.slice(6).trim()
        if (part.startsWith('data:')) dataStr = part.slice(5).trim()
      }
      if (!dataStr) continue
      try {
        const data = JSON.parse(dataStr)
        switch (eventType) {
          case 'status':
            handlers.onStatus(data.t || '')
            break
          case 'token':
            handlers.onToken(data.c || '')
            break
          case 'tool_call':
            handlers.onToolCall(data.tool_name || '', data.tool_args || '')
            break
          case 'tool_start':
            handlers.onToolStart(data.n || '', JSON.stringify(data.a || {}))
            break
          case 'tool_end':
            handlers.onToolEnd(data.n || '', !!data.ok, data.s || '')
            break
          case 'thinking':
            handlers.onThinking(data.t || '')
            break
          case 'searching':
            handlers.onSearching(data.q || '')
            break
          case 'error':
            handlers.onError(data.e || '未知错误')
            break
          case 'done': {
            handlers.onDone()
            reader.cancel()
            return
          }
        }
      } catch {/* 非 JSON 行，跳过 */}
    }
  }
  handlers.onDone()
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
  // P0-fix: SSE 流式状态
  const [streamContent, setStreamContent] = useState('')
  const [streamStatus, setStreamStatus] = useState('')
  const [streamTokens, setStreamTokens] = useState(0)
  const [streamToolCall, setStreamToolCall] = useState<{ name: string; args: string } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Track B.3 · activeAgent — 'default' 走 SSE; 3 social 走 REST
  const [activeAgent, setActiveAgent] = useState<'default' | 'DouyinAgent' | 'XiaohongshuAgent' | 'WechatAgent'>('default')
  const bottomRef = useRef<HTMLDivElement>(null)
  // Agent Runtime 模式切换: 'stream' = SSE 流式, 'agent' = Agent Loop (tool_call 自主循环)
  const [chatMode, setChatMode] = useState<'stream' | 'agent'>('stream')
  const activeProject = useProjectContext((s) => s.active)

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
  }, [messages, streamContent, sending])

  /** 停止 SSE 生成 */
  function handleStop() {
    abortRef.current?.abort()
    setSending(false)
    setStreamStatus('')
    setStreamToolCall(null)
  }

  async function send() {
    if (!id || sending) return
    const text = draft.trim()

    // 自动注入当前激活项目上下文
    const projectCtx = useProjectContext.getState().getChatContext()
    const enrichedText = projectCtx ? projectCtx + '\n\n[用户消息]\n' + text : text
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

    // P0-fix · 按 activeAgent 路由: social 走 :8000 /api/v1/social, default 走 SSE /api/v1/chat/stream
    // Agent Runtime 模式: default + chatMode='agent' 走 /api/v1/chat/agent
    if (targetAgent !== 'default') {
      try {
        const res = await socialExecuteAuto(targetAgent, { message: enrichedText })
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
        // Agent bridge :8001 unreachable → auto-fallback to stream SSE mode
        console.warn('[Agent] 8001 unreachable, auto-fallback to stream:', (e as Error).message)
        setStreamStatus('⚠️ Agent Bridge 不可达 → 流式模式')
        setChatMode('stream')
        // Remove the placeholder status message then fall through
        setMessages((prev) => prev.filter(m => m.content !== '🔄 Agent 思考中...'))
        setSending(false)
        // Continue to stream mode below — note: send() will re-trigger
        // Since chatMode changed to 'stream', next render will use stream path
        // For THIS invocation, fall through by removing the 'return' after agent block
        return  // Agent failed; the stream code path needs fresh state, skip this invocation
      } finally {
        setSending(false)
      }
      return
    }

    // Agent Runtime 模式: 走 :8001 Agent Bridge (tool_call 自主循环)
    if (chatMode === 'agent') {
      try {
        setStreamContent('')
        setStreamStatus('🎯 Agent Bridge :8001 · 执行中...')
        setStreamTokens(0)
        setStreamToolCall(null)

        // 放一个临时状态消息（等结果回来替换）
        const statusMsg: UiMessage = {
          id: newId(),
          role: 'system',
          content: '🔄 Agent 思考中...',
          timestamp: Date.now(),
        }
        const nextWithStatus = [...next, statusMsg]
        setMessages(nextWithStatus)

        const result = await agentChat({
          threadId: id,
          messages: next.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.role === 'user' && m.id === next[next.length-1].id ? enrichedText : m.content,
          })),
          signal: abortRef.current?.signal,
        })

        // 构建最终消息列表：用户消息 → 工具调用记录 → assistant 回复
        const finalMessages = [...next]

        // 插入工具调用记录
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            let argsPreview = ''
            try { argsPreview = JSON.stringify(JSON.parse(tc.arguments), null, 1).slice(0, 300) } catch { argsPreview = tc.arguments?.slice(0, 300) || '' }
            let resultPreview = ''
            if (tc.result) {
              try { resultPreview = JSON.stringify(JSON.parse(tc.result), null, 1).slice(0, 500) } catch { resultPreview = tc.result?.slice(0, 500) || '' }
            }
            finalMessages.push({
              id: newId(),
              role: 'tool',
              content: `🔧 **${tc.name}**\n\`\`\`json\n${argsPreview}${argsPreview.length >= 300 ? '...' : ''}\n\`\`\`\n${resultPreview ? '📋 结果:\n\`\`\`json\n' + resultPreview + (resultPreview.length >= 500 ? '...' : '') + '\n\`\`\`' : '⏳ 执行中...'}`,
              timestamp: Date.now(),
            })
          }
        }

        // 插入 assistant 回复
        const agentContent = result.assistantMessage?.content || '(无响应)'
        finalMessages.push({
          id: newId(),
          role: 'assistant',
          content: agentContent + `\n\n⚡ ${result.latencyMs}ms · ${result.toolCalls?.length || 0} 次工具调用`,
          timestamp: Date.now(),
          latency_ms: result.latencyMs,
        })

        setMessages(finalMessages)
        saveHistory(id, finalMessages)
        setStreamStatus('')

        // 推送工具调用到预览面板
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const tc of result.toolCalls) {
            usePreviewStore.getState().push({
              type: 'json',
              title: `🔧 ${tc.name}`,
              content: tc.result || tc.arguments,
              source: 'Agent 工具调用',
            })
          }
        }
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setSending(false)
      }
      return
    }

    try {
      // P0-fix: default agent 走 SSE 流式 /api/v1/chat/stream
      const token = useAuthStore.getState().accessToken
      if (!token) {
        throw new Error('未登录，请先登录后重试')
      }

      setStreamContent('')
      setStreamStatus('等待模型响应')
      setStreamTokens(0)
      setStreamToolCall(null)
      abortRef.current = new AbortController()

      // 添加空的 assistant 占位消息（流式中会更新）
      const placeholderMsg: UiMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      }
      const nextWithPlaceholder = [...next, placeholderMsg]
      setMessages(nextWithPlaceholder)

      const history = next.map((m) => ({ role: m.role, content: m.content }))
      await streamChatSSE(enrichedText, history, token, abortRef.current.signal, {
        onStatus: (t) => setStreamStatus(t),
        onToken: (c) => {
          setStreamContent((prev) => {
            const updated = prev + c
            // 实时更新最后一条 assistant 消息
            setMessages((msgs) => {
              const lastIdx = msgs.length - 1
              if (lastIdx >= 0 && msgs[lastIdx].role === 'assistant') {
                const updatedMsgs = [...msgs]
                updatedMsgs[lastIdx] = { ...updatedMsgs[lastIdx], content: updated }
                return updatedMsgs
              }
              return msgs
            })
            return updated
          })
          setStreamTokens((n) => n + estimateTokens(c))
        },
        onToolCall: (name, args) => {
          setStreamToolCall({ name, args })
          // 2026-06-20: 推送到预览面板
          usePreviewStore.getState().push({
            type: 'json',
            title: `🔧 ${name}`,
            content: args,
            source: 'Agent 工具调用',
          })
        },
        onToolStart: (name, args) => {
          setStreamToolCall({ name, args })
          setStreamStatus("🔧 " + name + " 执行中...")
          usePreviewStore.getState().push({
            type: "json",
            title: "⚡ " + name + " 调用中",
            content: args,
            source: "Agent 工具调用",
          })
        },
        onToolEnd: (name, ok, summary) => {
          setStreamStatus(ok ? "✅ " + name + " 完成" : "❌ " + name + " 失败")
          setStreamToolCall(null)
          usePreviewStore.getState().push({
            type: "text",
            title: ok ? "✅ " + name + " 完成" : "❌ " + name + " 失败",
            content: summary,
            source: "Agent 工具结果",
          })
        },
        onThinking: (t) => {
          setStreamStatus("💭 " + t)
        },
        onSearching: (q) => {
          setStreamStatus("🔍 搜索: " + (q || "").slice(0, 60) + "...")
        },
        onDone: () => {
          setStreamStatus('')
          setStreamToolCall(null)
          // 2026-06-20: 推送到预览面板 (仅长内容)
          const final = streamContent || ''
          if (final.length > 200) {
            const isCode = final.includes('```') || final.includes('function ') || final.includes('class ')
            const isMarkdown = final.includes('##') || final.includes('**') || final.includes('- ')
            usePreviewStore.getState().push({
              type: isCode ? 'code' : isMarkdown ? 'markdown' : 'text',
              title: 'Agent 回复',
              content: final,
              source: 'Agent 输出',
            })
          }
        },
        onError: (e) => setError(e),
      })

      // 流结束，保存最终内容
      const finalContent = streamContent || ''
      if (finalContent) {
        saveHistory(id, nextWithPlaceholder.map((m, i) =>
          i === nextWithPlaceholder.length - 1 && m.role === 'assistant'
            ? { ...m, content: finalContent }
            : m
        ))
      }
    } catch (e) {
      const msg = (e as Error).message
      if (msg !== 'AbortError') {
        setError(msg)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }

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
                ? chatMode === 'agent'
                  ? 'Agent Bridge · :8001 (慢速·全自主)'
                  : 'SSE 流式 · :8000 (快速·推荐)'
                : `social REST · :8000/api/v1/social → ${activeAgent}`}
            </div>
          </div>
        {/* Track C.1 · 10 agent tab 切换器 (统一入口) */}
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
        {activeProject && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <FolderGit2 size={14} className="text-brand" />
            <span className="text-brand font-medium">{activeProject.name}</span>
            <span className="text-neutral-500">{activeProject.path}</span>
          </div>
          <button onClick={() => useProjectContext.getState().setProject(null)} className="text-neutral-500 hover:text-neutral-300 transition-colors">
            <X size={12} />
          </button>
        </div>
      )}
      {messages.length === 0 && !sending && (
          <div className="text-center mt-12 space-y-2">
            <p className="text-sm text-neutral-500">
              {user ? `${user.username}, 发条消息开始吧` : '发条消息开始吧'}
            </p>
            <p className="text-xs text-neutral-600">
              后端: <code className="text-brand">{chatMode === 'agent' ? ':8001/api/agent' : ':8000/api/v1/chat/stream'}</code> {chatMode === 'agent' ? '(Agent Bridge · 13 工具集 · 自主循环)' : '(Backend · SSE 流式)'}
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
                {m.content ? (
                  <p className="text-sm text-neutral-100 whitespace-pre-wrap break-words">{m.content}</p>
                ) : m.role === 'assistant' && sending ? (
                  /* 流式中：显示动态加载状态 */
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-1.5 min-w-0">
                      {/* 工具调用指示器 */}
                      {streamToolCall && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-amber-400/80 bg-amber-400/5 px-2 py-0.5 rounded border border-amber-400/10 max-w-fit">
                          <CircleDot size={10} />
                          <span>{streamToolCall.name}</span>
                          {streamToolCall.args && (
                            <span className="text-neutral-500 truncate max-w-[200px]">{streamToolCall.args.slice(0, 40)}</span>
                          )}
                        </div>
                      )}
                      {/* 主状态行 */}
                      <div className="flex items-center gap-2 text-neutral-400">
                        <Loader2 size={14} className="animate-spin text-brand" />
                        <span className="text-xs">{streamStatus || 'AI 思考中...'}</span>
                        {streamTokens > 0 && (
                          <span className="text-xs text-neutral-500 flex items-center gap-1">
                            <Zap size={10} className="text-amber-500/60" />
                            已消耗 ◇ {streamTokens.toFixed(2)}
                          </span>
                        )}
                      </div>
                      {/* 光标闪烁效果 */}
                      {streamContent.length > 0 && (
                        <span className="inline-block w-1.5 h-4 bg-brand animate-pulse ml-0.5" />
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-neutral-100 whitespace-pre-wrap break-words">{m.content}</p>
                )}
              </Card>
            </div>
          </div>
        ))}
        {sending && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex gap-3 max-w-3xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-semantic-info/20 flex items-center justify-center">
              <Loader2 size={16} className="text-semantic-info animate-spin" />
            </div>
            <div className="text-sm text-neutral-400">AI 思考中...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 底部 SSE 状态栏 */}
      {(streamStatus || sending) && activeAgent === 'default' && (
        <div className="px-4 py-1.5 bg-neutral-900/80 border-t border-neutral-800 text-xs flex items-center justify-between flex-shrink-0 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-neutral-400">
            <Loader2 size={10} className="animate-spin text-brand" />
            <span>{streamStatus || 'AI 处理中...'}</span>
          </div>
          <div className="flex items-center gap-3">
            {streamTokens > 0 && (
              <span className="text-neutral-500 flex items-center gap-1">
                <Zap size={10} className="text-amber-500/50" />
                已消耗 ◇ {streamTokens.toFixed(2)}
              </span>
            )}
            <button
              onClick={handleStop}
              className="px-2 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              停止
            </button>
          </div>
        </div>
      )}

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
          {/* Agent Runtime 模式切换 */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={activeAgent !== 'default' || sending}
            onClick={() => setChatMode(chatMode === 'stream' ? 'agent' : 'stream')}
            className={`gap-1 text-xs px-2 ${chatMode === 'agent' ? 'bg-brand/10 text-brand ring-1 ring-brand/30' : 'text-neutral-400'}`}
            title={chatMode === 'stream' ? '当前: SSE 流式\n点击切换到 Agent Loop (自主调用工具)' : '当前: Agent Loop\n点击切换到 SSE 流式'}
          >
            {chatMode === 'agent' ? <Cpu size={13} /> : <MessageCircle size={13} />}
            <span className="hidden sm:inline">{chatMode === 'agent' ? 'Agent' : '流式'}</span>
          </Button>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 bg-neutral-900 border-neutral-800"
            disabled={sending}
            aria-label="消息输入"
          />
          {sending && activeAgent === 'default' ? (
            <Button type="button" size="icon" variant="ghost" aria-label="停止生成" onClick={handleStop}>
              <Square className="text-red-400" />
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
