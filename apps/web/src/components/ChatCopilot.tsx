// components/ChatCopilot.tsx · v3.0 流式版 (2026-06-18)
//  v1.0: 本地意图解析 + 后端 AI 引擎
//  v2.0: 非流式 HTTP 请求
//  v3.0: ★ SSE token 级实时流式渲染 + 动态状态指示器（对标 WorkBuddy）
//
// 流式架构:
//   前端 fetch → /api/v1/chat/stream (SSE)
//     → 解析 event: status/token/usage/tool_call/done
//     → 实时渲染到消息气泡
//     → 状态栏显示动态文案 + ◇ 消耗计数器

import { useState, useRef, useEffect } from 'react'
import { Send, Terminal, Loader2, Trash2, ChevronDown, PanelLeftClose, PanelLeft, Zap, CircleDot, CheckCircle2, XCircle } from 'lucide-react'
import { useAppStore, type AppIntent } from '@/store/useAppStore'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'

interface Props {
  onToggleHistory: () => void
  historyOpen: boolean
}

/** 意图命令映射 */
const INTENT_COMMANDS: Array<{
  keywords: string[]
  intent: AppIntent
  label: string
}> = [
  { keywords: ['/模特', '写实照', '数字人', '生成图'], intent: 'generate_model', label: '数字人与视觉资产' },
  { keywords: ['/部署', '跨境', '独立站', 'S2B2C'], intent: 'deploy_s2b2c', label: 'S2B2C 跨境架构' },
  { keywords: ['/内容', '社群', 'SOP', '私域', '公众号'], intent: 'marketing_sop', label: '私域内容与 SOP' },
]

function parseIntent(text: string): { intent: AppIntent; label: string } | null {
  for (const cmd of INTENT_COMMANDS) {
    if (cmd.keywords.some((kw) => text.toLowerCase().includes(kw.toLowerCase()))) {
      return { intent: cmd.intent, label: cmd.label }
    }
  }
  return null
}

/** AI 回复中的意图关键词 */
const AUTO_INTENT_KEYWORDS: Array<{ keywords: string[]; intent: AppIntent; label: string }> = [
  { keywords: ['模特', '写真', '数字人', '生成图', '视觉资产', '写实照', '商品图', '图片生成', 'AI 照', '头像'], intent: 'generate_model', label: '数字人与视觉资产' },
  { keywords: ['部署', '跨境', '独立站', 'S2B2C', 'Shopify', '拓扑', '架构图', '服务器', '域名', 'CDN', 'SSL', '区域部署'], intent: 'deploy_s2b2c', label: 'S2B2C 跨境部署' },
  { keywords: ['SOP', '私域', '公众号', '社群', '内容日历', '文案', '推送', '朋友圈', '运营计划', '内容矩阵', '营销流程'], intent: 'marketing_sop', label: '私域内容与 SOP' },
]

function detectIntentFromResponse(text: string): { intent: AppIntent; label: string } | null {
  for (const rule of AUTO_INTENT_KEYWORDS) {
    if (rule.keywords.some((kw) => text.includes(kw))) {
      return { intent: rule.intent, label: rule.label }
    }
  }
  return null
}

/** ── SSE 事件类型 ── */

interface StreamState {
  /** 动态状态文字 */
  statusText: string
  /** 当前累计内容 */
  content: string
  /** 已消耗 token 数 */
  tokensUsed: number
  /** 是否正在接收流 */
  streaming: boolean
  /** 当前工具调用信息 */
  toolCall?: { name: string; args: string }
  /** 工具执行输出（累积） */
  toolOutputs: Array<{ name: string; args: string; ok?: boolean; summary?: string }>
  /** 错误信息 */
  error?: string
  /** 完成 */
  done: boolean
}

const INITIAL_STREAM_STATE: StreamState = {
  statusText: '',
  content: '',
  tokensUsed: 0,
  streaming: false,
  toolOutputs: [],
  done: false,
}

/** 默认状态文案（模拟 WorkBuddy 风格） */
const DEFAULT_STATUSES = [
  '等待模型响应',
  '正在准备任务',
  'AI 思考中',
  '领导潜台词解码中',
  '正在分析上下文',
]

export default function ChatCopilot({ onToggleHistory, historyOpen }: Props) {
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE)
  const [showCmds, setShowCmds] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { addChatMessage, updateLastMessage, setActiveIntent, clearCurrentChat, activeIntent, conversations, activeConversationId, newConversation, setWelcomeMessage, syncConversationsFromBackend } =
    useAppStore()
  
  // ★ 关键修复：直接从 conversations 计算消息列表，而不是用 getter（getter 不触发 React 重渲染）
  const currentConv = conversations.find((c) => c.id === activeConversationId)
  const chatHistory = currentConv?.messages ?? []
  
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const statusRotateRef = useRef(0)

  // 🔄 模型选择器状态
  const [selectedModel, setSelectedModel] = useState<{ modelId: string; providerName: string; label: string } | null>(null)
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string; modelId: string; providerName: string; isCustom: boolean }>>([])
  const [showModelMenu, setShowModelMenu] = useState(false)

  // 加载可用模型列表
  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    if (!token) return
    fetch('/api/models', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        const all = [...(data.builtIn || []), ...(data.custom || [])]
        setAvailableModels(all)
        if (data.active && !selectedModel) {
          setSelectedModel({ modelId: data.active.modelId, providerName: data.active.providerName, label: data.active.label })
        } else if (all.length > 0 && !selectedModel) {
          setSelectedModel({ modelId: all[0].modelId, providerName: all[0].providerName, label: all[0].label })
        }
      })
      .catch(() => {})
  }, [])

  // 从当前会话取 threadId
  const threadIdRef = useRef<string>(currentConv?.threadId ?? `cc_${Date.now().toString(36)}`)

  useEffect(() => {
    if (currentConv?.threadId) {
      threadIdRef.current = currentConv.threadId
    }
  }, [currentConv?.threadId])

  // 自动滚动到最新消息
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatHistory, stream.content])

  // 状态轮转动画：每 3 秒切换一次默认状态文案
  useEffect(() => {
    if (!running || stream.statusText || !stream.streaming) return
    const interval = setInterval(() => {
      statusRotateRef.current = (statusRotateRef.current + 1) % DEFAULT_STATUSES.length
      setStream((s) => ({ ...s, statusText: DEFAULT_STATUSES[statusRotateRef.current] }))
    }, 3000)
    return () => clearInterval(interval)
  }, [running, stream.streaming, stream.statusText])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 🔄 动态欢迎语：从后端加载可配置的欢迎语
  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    if (!token) return
    fetch('/api/v1/chat/welcome', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        if (data.copilot) {
          setWelcomeMessage(data.copilot)
        } else if (data.content) {
          setWelcomeMessage(data.content)
        }
      })
      .catch(() => {
        // 静默失败，使用 store 中的默认欢迎语
      })
  }, [])

  // 🔄 初始化时从后端加载对话历史（保障跨刷新持久化）
  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    if (!token) return
    syncConversationsFromBackend().then(() => {
      const store = useAppStore.getState()
      const activeConv = store.conversations.find(c => c.id === store.activeConversationId)
      if (activeConv && activeConv.messages.length === 0 && activeConv.threadId) {
        store.loadMessagesForConversation(activeConv.id)
      }
    }).catch(() => {})
  }, [])

  // ✅ 挂载守卫：确保存在活跃会话（修复 activeConversationId=null 导致消息静默丢失）
  useEffect(() => {
    if (!activeConversationId || conversations.length === 0) {
      newConversation()
    }
    // 仅在首次挂载时执行（依赖空数组 = 只运行一次）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** ★ 核心函数：发送消息并启用 SSE 流式接收 */
  async function handleSend() {
    const text = input.trim()
    if (!text || running) return

    let currentId = activeConversationId
    let currentConvForSend = currentId ? conversations.find((c) => c.id === currentId) : undefined
    if (!currentConvForSend || !currentConvForSend.threadId) {
      currentId = newConversation()
      currentConvForSend = useAppStore.getState().conversations.find((c) => c.id === currentId)
    }
    const threadIdForSend = currentConvForSend?.threadId || `cc_${Date.now().toString(36)}`

    setInput('')
    setShowCmds(false)

    addChatMessage({ role: 'user', content: text })

    // 本地意图解析
    const intentMatch = parseIntent(text)
    if (intentMatch) {
      setActiveIntent(intentMatch.intent)
      addChatMessage({
        role: 'assistant',
        content: `已为您唤起【${intentMatch.label}】控制台。请在右侧配置参数并执行。\n\n如需直接对话，继续输入即可。`,
      })
      return
    }

    // 启动流式模式
    setRunning(true)
    if (streamTimeoutRef.current) { clearTimeout(streamTimeoutRef.current); streamTimeoutRef.current = null }
    setStream({ ...INITIAL_STREAM_STATE, streaming: true, statusText: '等待模型响应' })
    abortRef.current = new AbortController()

    // 占位消息
    addChatMessage({ role: 'assistant', content: '' })

    try {
      const store = useAppStore.getState()
      const history = (store.conversations.find((c) => c.id === currentId)?.messages ?? chatHistory)
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }))

      await streamChat(text, history, threadIdForSend, abortRef.current.signal)

      // 流结束后检测意图
      const autoIntent = detectIntentFromResponse(stream.content)
      if (autoIntent && activeIntent === null) {
        setActiveIntent(autoIntent.intent)
        addChatMessage({
          role: 'assistant',
          content: `\n> 🎯 已为您自动唤起【${autoIntent.label}】面板，可在右侧查看详情。`,
        })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '未知错误'
      updateLastMessage(`AI 引擎不可用：${msg}\n\n请确认后端 :8000 正在运行。`)
      setStream((s) => ({ ...s, error: msg, streaming: false, done: true }))
    } finally {
      setRunning(false)
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      streamTimeoutRef.current = setTimeout(() => {
        setStream((s) => ({ ...s, streaming: false, done: true }))
        streamTimeoutRef.current = null
      }, 500)
    }
  }

  /**
   * ★ SSE 流式聊天核心实现
   * 连接 POST /api/v1/chat/stream，逐事件处理：
   * - status: 更新底部状态栏
   * - token: 追加文本到当前消息
   * - usage: 更新消耗计数器
   * - tool_call: 显示工具调用状态
   * - done: 结束标记
   * - error: 错误处理
   */
  async function streamChat(message: string, history: Array<{ role: string; content: string }>, threadId: string, signal: AbortSignal) {
    const token = useAuthStore.getState().accessToken || ''

    const baseUrl = import.meta.env.VITE_API_URL || ''  // 空串 = 走 Vite proxy (/api → :8000)
    let fullContent = ''  // ★ 每次新对话从空开始，不继承上轮内容

    try {
      let response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          message,
          threadId,
          history,
          model: selectedModel?.modelId || undefined,
          providerName: selectedModel?.providerName || undefined,
        }),
        signal,
      })

      // 401 → 尝试刷新 token 并重试一次
      if (response.status === 401) {
        const refresh = useAuthStore.getState().refreshToken
        if (refresh) {
          try {
            const refRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refresh }),
            })
            if (refRes.ok) {
              const json = await refRes.json()
              useAuthStore.getState().setTokens({
                access: json.access_token,
                refresh: json.refresh_token ?? refresh,
                expiresAt: Date.now() + 7200 * 1000,
              })
              // 用新 token 重试
              response = await fetch(`${baseUrl}/api/v1/chat/stream`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${json.access_token}`, Accept: 'text/event-stream' },
                body: JSON.stringify({ message, threadId, history, model: selectedModel?.modelId || undefined, providerName: selectedModel?.providerName || undefined }),
                signal,
              })
            }
          } catch {}
        }
        if (response.status === 401) {
          useAuthStore.getState().clear()
          window.location.href = '/login'
          throw new Error('登录已过期，正在跳转登录页...')
        }
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status} ${text || response.statusText}`.trim())
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

          // 解析 SSE 行: "event: XXX\ndata: {...}"
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
                // 动态状态更新（如："📖 已读取文件，分析上下文中..."）
                statusRotateRef.current = 0 // 停止轮转，使用服务端真实状态
                setStream((s) => ({
                  ...s,
                  statusText: data.t || s.statusText,
                  streaming: true,
                }))
                break

              case 'token':
                // ★ 核心：token 级渲染
                fullContent += data.c || ''
                updateLastMessage(fullContent)
                setStream((s) => ({
                  ...s,
                  content: fullContent,
                  tokensUsed: s.tokensUsed + estimateTokens(data.c || ''),
                }))
                break

              case 'usage':
                // 服务端返回的准确用量
                setStream((s) => ({
                  ...s,
                  tokensUsed: data.total_tokens || s.tokensUsed,
                }))
                break

              case 'tool_start': {
                const toolName = data.n || ''
                const toolArgs = typeof data.a === 'string' ? data.a : JSON.stringify(data.a || {}, null, 2)
                setStream((s) => ({
                  ...s,
                  toolCall: toolName ? { name: toolName, args: toolArgs } : null,
                  statusText: `⚡ 执行: ${toolName}`,
                  toolOutputs: [...s.toolOutputs, { name: toolName, args: toolArgs }],
                }))
                break
              }

              case 'tool_end': {
                const endName = data.n || data.name || ''
                setStream((s) => {
                  const outputs = s.toolOutputs.map(o => 
                    o.name === endName && o.ok === undefined 
                      ? { ...o, ok: data.ok ?? data.success ?? false, summary: data.s || data.summary || '' }
                      : o
                  )
                  return {
                    ...s,
                    toolCall: null,
                    statusText: (data.ok ?? data.success) ? `✅ ${endName} 完成` : `❌ ${endName} 失败`,
                    toolOutputs: outputs,
                  }
                })
                break
              }

              case 'tool_confirm':
                updateLastMessage(`⚠️ 需要确认操作：${data.tool || '未知工具'}\n参数：${data.args || ''}\n请在浏览器中确认后继续。`)
                setStream((s) => ({ ...s, statusText: '⏳ 等待确认...' }))
                break

              case 'tool_call':
                setStream((s) => ({
                  ...s,
                  toolCall: data.tool_name ? { name: data.tool_name, args: data.tool_args || '' } : s.toolCall,
                  statusText: data.tool_name ? `🔧 调用工具: ${data.tool_name}` : s.statusText,
                }))
                break

              case 'error':
                console.error('[Stream Error]', data.e)
                updateLastMessage(`AI 返回错误：${data.e || '未知错误'}`)
                setStream((s) => ({ ...s, error: data.e || '未知错误', streaming: false, done: true }))
                return

              case 'done':
                // 流结束
                setStream((s) => ({
                  ...s,
                  streaming: false,
                  done: true,
                  statusText: '',
                }))
                return
            }
          } catch {/* 非 JSON 行，跳过 */}
        }
      }

      // 正常退出
      if (!signal.aborted) {
        setStream((s) => ({ ...s, streaming: false, done: true, statusText: '' }))
      }
    } catch (e: any) {
      if (e.name === 'AbortError') {
        updateLastMessage(fullContent + '\n\n*已停止生成*')
      } else {
        throw e
      }
    }
  }

  /** 粗略估算 token 数（中文约 1.5 char/token） */
  function estimateTokens(text: string): number {
    if (!text) return 0
    const chineseLen = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const otherLen = text.length - chineseLen
    return Math.ceil(chineseLen / 1.5 + otherLen / 4)
  }

  /** 停止生成 */
  function handleStop() {
    abortRef.current?.abort()
    setRunning(false)
    setStream((s) => ({ ...s, streaming: false, done: true, statusText: '' }))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === '/') {
      e.preventDefault()
      setShowCmds(true)
      setInput('/')
    }
  }

  const intentLabel = INTENT_COMMANDS.find((c) => c.intent === activeIntent)?.label

  return (
    <div className="flex flex-col h-full">
      {/* ── 顶部状态栏 ── */}
      <div className="h-14 border-b border-neutral-800 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onToggleHistory}
            className="p-1 rounded text-neutral-500 hover:text-brand hover:bg-neutral-800 transition-colors flex-shrink-0"
            title={historyOpen ? '收起历史' : '对话历史'}
          >
            {historyOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          <Terminal className="w-4 h-4 text-brand flex-shrink-0" />
          <span className="font-medium tracking-wide text-sm text-neutral-300 truncate">
            {currentConv?.title ?? 'DaShengOS / Terminal'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {intentLabel && (
            <span className="text-[10px] px-2 py-0.5 rounded bg-brand/10 text-brand border border-brand/20">
              {intentLabel}
            </span>
          )}
          <button
            onClick={clearCurrentChat}
            className="text-neutral-600 hover:text-red-400 transition-colors"
            title="清空对话"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── 消息流 ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
        {chatHistory.map((msg, idx) => (
          <div
            key={idx}
            className={cn('flex flex-col', msg.role === 'user' ? 'items-end' : 'items-start')}
          >
            <span className="text-[11px] text-neutral-600 mb-1 uppercase tracking-wider">
              {msg.role === 'user' ? 'You' : msg.role === 'system' ? 'System' : 'AI'}
            </span>
            <div
              className={cn(
                'p-3 rounded-lg max-w-[85%] text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-brand/10 border border-brand/20 text-neutral-100'
                  : 'bg-transparent text-neutral-300',
              )}
            >
              {msg.content ? (
                <div className="whitespace-pre-wrap">{msg.content}</div>
              ) : (
                /* ★ 流式中：显示动态加载状态 */
                <div className="flex items-start gap-2">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    {/* 工具执行块 — 每个 tool output 格式化显示 */}
                    {stream.toolOutputs.length > 0 && stream.toolOutputs.map((to, ti) => (
                      <div key={ti} className={cn(
                        "w-full rounded-lg border text-xs font-mono overflow-hidden",
                        to.ok === undefined ? "border-amber-500/30 bg-amber-500/5" :
                        to.ok ? "border-emerald-500/20 bg-emerald-500/5" :
                        "border-red-500/20 bg-red-500/5"
                      )}>
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-inherit">
                          <div className="flex items-center gap-2">
                            {to.ok === undefined ? (
                              <Loader2 size={11} className="animate-spin text-amber-400" />
                            ) : to.ok ? (
                              <CheckCircle2 size={11} className="text-emerald-400" />
                            ) : (
                              <XCircle size={11} className="text-red-400" />
                            )}
                            <span className="text-neutral-300 font-semibold">{to.name}</span>
                          </div>
                          {to.ok !== undefined && (
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              to.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                            )}>
                              {to.ok ? 'OK' : 'FAIL'}
                            </span>
                          )}
                        </div>
                        {to.args && (
                          <div className="px-3 py-2 text-neutral-400 bg-black/20">
                            <code className="whitespace-pre-wrap break-all">{to.args}</code>
                          </div>
                        )}
                        {to.summary && (
                          <div className="px-3 py-1.5 text-neutral-500 border-t border-inherit text-[11px]">
                            {to.summary.slice(0, 300)}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* 主状态行：对标 WorkBuddy 截图风格 */}
                    <div className="flex items-center gap-2 text-neutral-400">
                      {stream.streaming && !stream.done ? (
                        <>
                          <Loader2 size={14} className="animate-spin text-brand" />
                          <span className="text-xs">{stream.statusText || '思考中...'}</span>
                          {stream.tokensUsed > 0 && (
                            <span className="text-xs text-neutral-500 flex items-center gap-1">
                              <Zap size={10} className="text-amber-500/60" />
                              已消耗 ◇ {stream.tokensUsed.toFixed(2)}
                            </span>
                          )}
                        </>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-neutral-500">
                          <Loader2 size={14} className="animate-spin" />
                          <span>思考中...</span>
                        </div>
                      )}
                    </div>

                    {/* 光标闪烁效果（流式中且有内容时） */}
                    {stream.streaming && stream.content.length > 0 && (
                      <span className="inline-block w-1.5 h-4 bg-brand animate-pulse ml-0.5" />
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── 底部状态栏（WorkBuddy 风格）── */}
      {(stream.statusText || (running && !stream.done)) && (
        <div className="px-4 py-1.5 bg-neutral-900/80 border-t border-neutral-800 text-xs flex items-center justify-between flex-shrink-0 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-neutral-400">
            {stream.streaming ? (
              <><Loader2 size={10} className="animate-spin text-brand" /><span>{stream.statusText || 'AI 处理中...'}</span></>
            ) : (
              <><span>{stream.statusText || ''}</span></>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* 消耗计数器 */}
            {stream.tokensUsed > 0 && (
              <span className="text-neutral-500 flex items-center gap-1">
                <Zap size={10} className="text-amber-500/50" />
                已消耗 ◇ {stream.tokensUsed.toFixed(2)}
              </span>
            )}
            {/* 停止按钮 */}
            {stream.streaming && (
              <button
                onClick={handleStop}
                className="px-2 py-0.5 text-[10px] rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
              >
                停止
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 输入区 ── */}
      <div className="px-5 py-4 bg-neutral-900/80 backdrop-blur-sm border-t border-neutral-800 flex-shrink-0">
        {/* 快捷命令面板 */}
        {showCmds && (
          <div className="mb-2 p-2 bg-neutral-950 border border-neutral-800 rounded-lg space-y-1">
            {INTENT_COMMANDS.map((cmd) => (
              <button
                key={cmd.intent}
                onClick={() => {
                  setActiveIntent(cmd.intent)
                  addChatMessage({
                    role: 'assistant',
                    content: `已为您唤起【${cmd.label}】控制台。请在右侧配置参数。`,
                  })
                  setShowCmds(false)
                  setInput('')
                }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-neutral-800 text-sm text-neutral-300 transition-colors"
              >
                <span className="text-brand font-mono text-xs">{cmd.keywords[0]}</span>
                <span className="text-neutral-500 text-xs">— {cmd.label}</span>
              </button>
            ))}
            <button
              onClick={() => { setShowCmds(false); setInput('') }}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded hover:bg-neutral-800 text-xs text-neutral-600 transition-colors"
            >
              <ChevronDown className="w-3 h-3" /> 取消
            </button>
          </div>
        )}

        {/* 🔄 模型选择器（WorkBuddy 风格：输入框上方下拉） */}
        <div className="flex items-center gap-2 mb-2">
          <div className="relative">
            <button
              onClick={() => setShowModelMenu(!showModelMenu)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-neutral-900 border border-neutral-800 text-xs text-neutral-400 hover:text-neutral-300 hover:border-neutral-700 transition-colors"
            >
              <span className="text-neutral-500">模型</span>
              <span className="text-neutral-300 max-w-[180px] truncate">
                {selectedModel?.label || '默认'}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>
            {showModelMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelMenu(false)} />
                <div className="absolute bottom-full left-0 mb-1 z-50 w-72 bg-neutral-900 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
                  <div className="p-1 max-h-64 overflow-y-auto">
                    <div className="px-2 py-1.5 text-[10px] text-neutral-600 uppercase tracking-wider">内置模型</div>
                    {availableModels.filter(m => !m.isCustom).map(m => (
                      <button
                        key={m.id}
                        onClick={() => {
                          setSelectedModel({ modelId: m.modelId, providerName: m.providerName, label: m.label })
                          setShowModelMenu(false)
                        }}
                        className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                          selectedModel?.modelId === m.modelId && selectedModel?.providerName === m.providerName
                            ? 'bg-brand/10 text-brand'
                            : 'text-neutral-300 hover:bg-neutral-800'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                    {availableModels.filter(m => m.isCustom).length > 0 && (
                      <>
                        <div className="px-2 py-1.5 text-[10px] text-neutral-600 uppercase tracking-wider mt-1">自定义模型</div>
                        {availableModels.filter(m => m.isCustom).map(m => (
                          <button
                            key={m.id}
                            onClick={() => {
                              setSelectedModel({ modelId: m.modelId, providerName: m.providerName, label: m.label })
                              setShowModelMenu(false)
                            }}
                            className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors ${
                              selectedModel?.modelId === m.modelId && selectedModel?.providerName === m.providerName
                                ? 'bg-brand/10 text-brand'
                                : 'text-neutral-300 hover:bg-neutral-800'
                            }`}
                          >
                            ✦ {m.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <span className="text-[10px] text-neutral-600">
            设置中可添加自定义模型
          </span>
        </div>

        <div className="relative flex items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-resize
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 200) + 'px'
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
              if (e.key === '/' && input === '') { e.preventDefault(); setShowCmds(true) }
            }}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            disabled={running}
            rows={1}
            className="w-full bg-neutral-950 border border-neutral-700 rounded-xl py-3.5 pl-5 pr-12 text-[15px] text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20 transition-all disabled:opacity-50 resize-none min-h-[52px] max-h-[200px] leading-relaxed"
          />
          <button
            onClick={running ? handleStop : handleSend}
            disabled={!input.trim() && !running}
            className={`absolute right-3 bottom-3 transition-colors ${running ? 'text-red-400 hover:text-red-300' : 'text-neutral-400 hover:text-brand'} disabled:opacity-30`}
            title={running ? '停止生成' : '发送'}
          >
            {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
