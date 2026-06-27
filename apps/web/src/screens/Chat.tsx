// apps/web/src/screens/Chat.tsx · DaShengOS v8.7
// +号菜单 · 批准模式 · 弹窗 · 流式对话
import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, Paperclip, AtSign, Bot, User, Loader2, Square, Zap, Globe, Clock, Plus, Shield, ShieldCheck, ShieldAlert, X, Code, Puzzle, Wrench, BotIcon, Cpu, ChevronDown, Check, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

// ── Types ──
interface UiMessage {
  id: string; role: 'user' | 'assistant' | 'system' | 'tool'; content: string
  timestamp: number; latency_ms?: number
  toolCalls?: Array<{ name: string; args: string; ok?: boolean; summary?: string }>
  isHtml?: boolean
}
interface StepLogEntry { ts: string; text: string }
type ApprovalMode = 'yolo' | 'ask' | 'safe'

function newId() { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }
function estimateTokens(text: string): number {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  return Math.ceil(cn / 1.5 + (text.length - cn) / 4)
}
function isHtmlContent(text: string): boolean { return /<!DOCTYPE html|<html|<\/html/i.test(text.slice(0, 500)) }

// ── Approval Mode config ──
const APPROVAL_MODES: { key: ApprovalMode; label: string; icon: typeof Shield; desc: string; color: string }[] = [
  { key: 'yolo', label: 'YOLO', icon: ShieldAlert, desc: '自动执行全部命令', color: '#f87171' },
  { key: 'ask', label: 'ASK', icon: ShieldCheck, desc: '危险操作需确认', color: '#fbbf24' },
  { key: 'safe', label: 'SAFE', icon: Shield, desc: '只读模式不执行', color: '#4ade80' },
]

// ── HTML Preview Modal ──
function HtmlPreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
  useEffect(() => () => URL.revokeObjectURL(blobUrl), [blobUrl])
  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
          <span className="text-sm text-[var(--text-soft)] flex items-center gap-2"><Globe size={14} className="text-[#0df0ff]" /> HTML 预览</span>
          <div className="flex gap-2">
            <button onClick={() => window.open(blobUrl, '_blank')} className="px-3 py-1 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-soft)] hover:bg-[var(--border)]">新窗口</button>
            <button onClick={onClose} className="px-3 py-1 text-xs rounded bg-[var(--bg-tertiary)] text-[var(--text-soft)] hover:bg-[var(--border)]"><X size={14} /></button>
          </div>
        </div>
        <iframe src={blobUrl} className="flex-1 w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin" />
      </div>
    </div>
  )
}

// ── Inline HTML ──
function HtmlPreview({ html }: { html: string }) {
  const [modal, setModal] = useState(false)
  return (<>
    <div className="mt-3 border border-[var(--border)] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <span className="text-xs text-[var(--text-soft)] flex items-center gap-1.5"><Globe size={12} className="text-[#0df0ff]" /> HTML 报告</span>
        <div className="flex gap-1">
          <button onClick={() => setModal(true)} className="px-2.5 py-0.5 text-[0.6rem] rounded bg-[var(--brand-bg)] text-[var(--brand)] hover:opacity-80">展开</button>
          <button onClick={() => window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank')} className="px-2.5 py-0.5 text-[0.6rem] rounded bg-[var(--bg-tertiary)] text-[var(--text-soft)] hover:bg-[var(--border)]">新窗口</button>
        </div>
      </div>
      <div className="max-h-60 overflow-hidden relative">
        <div className="p-3 text-xs text-[var(--text-muted)] font-mono truncate">{html.slice(0, 300)}...</div>
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--bg-primary)] to-transparent" />
      </div>
    </div>
    {modal && <HtmlPreviewModal html={html} onClose={() => setModal(false)} />}
  </>)
}

// ── SSE ──
interface StreamHandlers {
  onStatus: (t: string) => void; onToken: (c: string) => void
  onToolStart: (n: string, a: string) => void; onToolEnd: (n: string, ok: boolean, s: string) => void
  onThinking: (t: string) => void; onSearching: (q: string) => void
  onUsage: (p: number, c: number) => void; onDone: () => void; onError: (m: string) => void
}

async function streamChatSSE(
  message: string, history: Array<{ role: string; content: string }>,
  token: string, signal: AbortSignal, handlers: StreamHandlers, onStepLog: (e: string) => void,
  approvalMode: ApprovalMode = 'ask',
  model?: string,
) {
  const baseUrl = import.meta.env.VITE_API_URL || ''
  const makeReq = (tok: string) => fetch(`${baseUrl}/api/v1/chat/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}`, Accept: 'text/event-stream' },
    body: JSON.stringify({ message, history, mode: approvalMode, model, projectPath: typeof window !== 'undefined' ? localStorage.getItem('dasheng_project') || '' : '' }), signal,
  })
  let res = await makeReq(token)
  // 401 自动刷新 token 并重试一次
  if (res.status === 401) {
    const store = (await import('@/lib/auth-store')).useAuthStore
    const refresh = store.getState().refreshToken
    if (refresh) {
      try {
        const refRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refresh }),
        })
        if (refRes.ok) {
          const json = await refRes.json()
          store.getState().setTokens({
            access: json.access_token,
            refresh: json.refresh_token ?? refresh,
            expiresAt: Date.now() + 7200 * 1000,
          })
          res = await makeReq(json.access_token)
        }
      } catch {}
    }
    if (res.status === 401) {
      store.getState().clear()
      throw new Error('登录已过期，请重新登录')
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.body) throw new Error('No body')
  const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''
  while (!signal.aborted) {
    const { done, value } = await reader.read(); if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n\n'); buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      let evt = '', dat = ''
      for (const p of line.split('\n')) { if (p.startsWith('event:')) evt = p.slice(6).trim(); if (p.startsWith('data:')) dat = p.slice(5).trim() }
      if (!dat) continue
      try { const d = JSON.parse(dat)
        switch (evt) {
          case 'status': handlers.onStatus(d.t||''); onStepLog(`● ${d.t||''}`); break
          case 'token': handlers.onToken(d.c||''); break
          case 'tool_start': handlers.onToolStart(d.n||'', JSON.stringify(d.a||{})); onStepLog(`🔧 ${d.n}()`); break
          case 'tool_end': handlers.onToolEnd(d.n||'', !!d.ok, d.s||''); onStepLog(`  ✓ ${d.n}`); break
          case 'thinking': handlers.onThinking(d.t||''); break
          case 'searching': handlers.onSearching(d.q||''); onStepLog(`🔍 ${d.q}`); break
          case 'usage': handlers.onUsage(d.p||0, d.c||0); break
          case 'done': handlers.onDone(); onStepLog('✓ 完成'); break
          case 'error': handlers.onError(d.m||''); onStepLog(`✖ ${d.m}`); break
        }
      } catch {}
    }
  }
}

// ── PlusMenu: 动态加载 Skills/MCP/Agents ──
function PlusMenu({ onSelect }: { onSelect: (t: string) => void }) {
  const [subMenu, setSubMenu] = useState<"skills" | "mcp" | "agents" | null>(null)
  const [items, setItems] = useState<Array<{ name: string; desc: string; extra: string }>>([])
  const token = useAuthStore((s) => s.accessToken)

  useEffect(() => {
    if (!subMenu) { setItems([]); return }
    const urls: Record<string, string> = {
      skills: "http://127.0.0.1:8000/api/v1/skills",
      mcp: "http://127.0.0.1:8000/api/v1/mcp/tools",
      agents: "http://127.0.0.1:8000/api/v1/agents",
    }
    const mapFn: Record<string, (d: any) => Array<{ name: string; desc: string; extra: string }>> = {
      skills: (d) => (d.skills || d || []).slice(0, 20).map((s: any) => ({ name: s.name || s, desc: s.description || "", extra: "" })),
      mcp: (d) => (d.tools || d || []).slice(0, 20).map((t: any) => ({ name: t.name || t, desc: "", extra: t.server || "" })),
      agents: (d) => (d.agents || d || []).slice(0, 20).map((a: any) => ({ name: a.name || a.id || a, desc: "", extra: "" })),
    }
    fetch(urls[subMenu], { headers: { Authorization: "Bearer " + token } })
      .then(r => r.json()).then(d => setItems(mapFn[subMenu](d))).catch(() => setItems([]))
  }, [subMenu, token])

  const labels: Record<string, { icon: typeof Puzzle; label: string }> = {
    skills: { icon: Puzzle, label: "已安装技能" },
    mcp: { icon: Wrench, label: "MCP 工具" },
    agents: { icon: BotIcon, label: "调度 Agent" },
  }

  if (subMenu !== null) {
    const { icon: Icon, label } = labels[subMenu]
    return (
      <div className="absolute bottom-full left-0 mb-2 w-64 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-50 p-1.5 max-h-72 overflow-y-auto">
        <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-[var(--text-soft)] border-b border-[var(--border)] mb-1">
          <button onClick={() => setSubMenu(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">&larr;</button>
          <Icon size={14} className="text-[var(--brand)]" /> {label}
        </div>
        {items.length === 0 && <div className="text-xs text-[var(--text-muted)] px-2 py-2">加载中...</div>}
        {items.map((item, i) => (
          <button key={i} onClick={() => onSelect("@" + item.name + " ")} className="w-full text-left px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] truncate">
            {item.name}
            <span className="text-[0.55rem] text-[var(--text-muted)] block truncate">
              {item.extra ? "(" + item.extra + ") " : ""}{item.desc?.slice(0, 60)}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="absolute bottom-full left-0 mb-2 w-56 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl z-50 p-1.5">
      <div className="text-[0.55rem] text-[var(--text-muted)] uppercase px-2 py-1">快捷操作</div>
      <button onClick={() => setSubMenu("skills")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"><Puzzle size={14} /> 调用 Skill &rarr;</button>
      <button onClick={() => setSubMenu("mcp")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"><Wrench size={14} /> 调用 MCP &rarr;</button>
      <button onClick={() => setSubMenu("agents")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"><BotIcon size={14} /> 调度 Agent &rarr;</button>
      <div className="border-t border-[var(--border)] my-1" />
      <button onClick={() => onSelect("/code ")} className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"><Code size={14} /> 代码模式</button>
    </div>
  )
}

// ── Main Chat ──
export function Chat() {
  const { activeSessionId } = useUIStore()
  const setActiveSessionId = useUIStore((s) => s.setActiveSessionId)
  const params = useParams({ strict: false }) as { id?: string }
  const rawId = activeSessionId || params.id || (typeof window !== 'undefined' ? window.location.pathname.split('/chats/')[1]?.split('/')[0] : undefined)
  const token = useAuthStore((s) => s.accessToken)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [streamStatus, setStreamStatus] = useState('')
  const [streamToolCall, setStreamToolCall] = useState<{ name: string; args: string } | null>(null)
  const [streamThink, setStreamThink] = useState('')
  const [streamTokens, setStreamTokens] = useState(0)
  const [stepLog, setStepLog] = useState<StepLogEntry[]>([])
  const [mcpStatus, setMcpStatus] = useState<{ total: number; online: number; servers: Array<{ name: string; online: boolean }> }>({ total: 0, online: 0, servers: [] })
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>(() => (localStorage.getItem('dasheng_approval') as ApprovalMode) || 'ask')
  const [activeModel, setActiveModel] = useState<string>(() => localStorage.getItem('dasheng_model') || 'deepseek-v4-pro')
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string; provider: string }>>([])
  const [showModelMenu, setShowModelMenu] = useState(false)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const msgRef = useRef<HTMLDivElement>(null)
  const plusRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const chatId = rawId || 'default'; const storageKey = `dasheng_chat_${chatId}`
  useEffect(() => {
    // 1. 先尝试 localStorage（快速恢复）
    try { const r = localStorage.getItem(storageKey); if (r) { const p = JSON.parse(r); if (Array.isArray(p) && p.length > 0) { setMessages(p); return } } } catch {}
    // 2. 从后端加载会话消息
    if (chatId !== 'default' && token) {
      fetch('http://127.0.0.1:8000/api/v1/sessions/' + chatId, { headers: { Authorization: 'Bearer ' + token } })
        .then(r => r.json()).then(d => {
          if (d.id) {
            // 加载该会话的消息
            return fetch('http://127.0.0.1:8000/api/v1/sessions/' + chatId + '/messages?limit=50', { headers: { Authorization: 'Bearer ' + token } })
          }
          return null
        }).then(r => r?.json()).then(d => {
          if (d?.messages && Array.isArray(d.messages)) {
            const msgs = d.messages.map((m: any) => ({
              id: m.id || newId(), role: m.role === 'USER' ? 'user' : 'assistant',
              content: m.content || '', timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
              isHtml: isHtmlContent(m.content || ''),
            }))
            setMessages(msgs)
          }
        }).catch(() => {})
    }
  }, [storageKey, chatId, token])
  useEffect(() => { if (messages.length > 0) localStorage.setItem(storageKey, JSON.stringify(messages.slice(-100))) }, [messages, storageKey])
  useEffect(() => { localStorage.setItem('dasheng_approval', approvalMode) }, [approvalMode])
  useEffect(() => { localStorage.setItem('dasheng_model', activeModel) }, [activeModel])
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch((import.meta.env.VITE_API_URL || '') + '/api/v1/models', {
          headers: { Authorization: 'Bearer ' + token }
        })
        if (res.ok) {
          const data = await res.json()
          const models = (data.models || []).map((m: any) => ({
            id: m.id,
            label: m.id.includes(':') ? m.id.split(':')[1] : m.id,
            provider: m.provider || m.id.split(':')[0],
          }))
          // 确保默认模型在列表中
          const defaultModel = data.default_model
          if (defaultModel && !models.find((m: any) => m.id === defaultModel || m.label === defaultModel)) {
            models.unshift({ id: defaultModel, label: defaultModel, provider: data.llm_provider || 'default' })
          }
          if (models.length > 0) setAvailableModels(models)
        }
      } catch {}
    }
    if (token) fetchModels()
  }, [token])

  // MCP heartbeat
  useEffect(() => {
    const check = async () => { try { const r = await fetch('http://127.0.0.1:8000/api/v1/mcp/health', { signal: AbortSignal.timeout(2000) }); if (r.ok) { const d = await r.json(); setMcpStatus({ total: d.total||0, online: d.online||0, servers: d.servers||[] }) } } catch {} }; check(); const i = setInterval(check, 30000); return () => clearInterval(i)
  }, [])

  const scrollToBottom = useCallback((force = false) => {
    const el = msgRef.current; if (!el) return; const dist = el.scrollHeight - el.scrollTop - el.clientHeight; if (force || dist < 150) el.scrollTop = el.scrollHeight
  }, [])
  useEffect(() => { scrollToBottom() }, [streamContent, streamStatus, stepLog, scrollToBottom])
  useEffect(() => { inputRef.current?.focus() }, [])
  // 读取从自动化页面传来的预设 prompt
  useEffect(() => {
    const preset = sessionStorage.getItem('dasheng_ai_prompt')
    if (preset) {
      setDraft(preset)
      sessionStorage.removeItem('dasheng_ai_prompt')
      // 自动聚焦 + 不自动发送，让用户确认
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [])
  useEffect(() => { const h = (e: MouseEvent) => { if (plusRef.current && !plusRef.current.contains(e.target as Node)) setShowPlusMenu(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])
  useEffect(() => { const h = (e: MouseEvent) => { if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) setShowModelMenu(false) }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h) }, [])

  const mode = APPROVAL_MODES.find(m => m.key === approvalMode)!

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0 || !token) return
    setErrorBanner(null)

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/v1/files/upload', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          body: formData,
        })
        if (res.ok) {
          const data = await res.json()
          const projectPath = localStorage.getItem('dasheng_project') || ''
          const filePath = data.path || file.name
          setDraft(d => d + '\n[文件: ' + filePath + ']')
          setStepLog(prev => [...prev, { ts: new Date().toLocaleTimeString(), text: '📎 已上传: ' + file.name }])
        } else {
          const err = await res.json().catch(() => ({ message: '上传失败' }))
          setErrorBanner('上传失败: ' + (err.message || err.code || res.status))
        }
      } catch (err: any) {
        setErrorBanner('上传失败: ' + (err.message || '网络错误'))
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function send() {
    const text = draft.trim(); if (!text || sending) return; if (!token) { setErrorBanner('未登录'); return }
    setDraft(''); setSending(true); setStreamContent(''); setStreamStatus('分析任务中...')
    setStreamToolCall(null); setStreamThink(''); setStreamTokens(0)
    setStepLog([{ ts: new Date().toLocaleTimeString(), text: `[${mode.label}] 开始处理` }]); setErrorBanner(null)
    const userMsg: UiMessage = { id: newId(), role: 'user', content: text, timestamp: Date.now() }
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(prev => [...prev, userMsg])
    const aiId = newId(); let aiContent = ''
    const toolCalls: Array<{ name: string; args: string; ok?: boolean; summary?: string }> = []
    const abort = new AbortController(); abortRef.current = abort
    const h: StreamHandlers = {
      onStatus: (t) => setStreamStatus(t), onToken: (c) => { aiContent += c; setStreamContent(aiContent); setStreamTokens(p => p + estimateTokens(c)) },
      onToolStart: (n, a) => { toolCalls.push({ name: n, args: a }); setStreamToolCall({ name: n, args: a }); setStreamStatus(`调用: ${n}`) },
      onToolEnd: (n, ok, s) => { const tc = toolCalls.find(t => t.name === n && t.ok === undefined); if (tc) { tc.ok = ok; tc.summary = s }; setStreamToolCall(null); setStreamStatus(ok ? `${n} 完成` : `${n} 失败`) },
      onThinking: (t) => setStreamThink(t), onSearching: (q) => setStreamStatus(`搜索: ${q}`),
      onUsage: (p, c) => setStreamTokens(pr => pr + p + c),
      onDone: () => {
        const final = aiContent || streamContent; const html = isHtmlContent(final)
        let display = final; if (html) display = final.replace(/^```html?\s*\n?/i,'').replace(/\n?```\s*$/i,'').replace(/^[\s\S]*?<!DOCTYPE/i,'<!DOCTYPE')
        setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: display, timestamp: Date.now(), latency_ms: Date.now()-userMsg.timestamp, toolCalls: toolCalls.length>0?toolCalls:undefined, isHtml: html||isHtmlContent(display) }])
        setSending(false); setStreamContent(''); setStreamStatus(''); setStreamToolCall(null); setStreamThink('')
      },
      onError: (msg) => { setErrorBanner(msg); if (aiContent) setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: aiContent, timestamp: Date.now(), toolCalls: toolCalls.length>0?toolCalls:undefined, isHtml: isHtmlContent(aiContent) }]); setSending(false); setStreamContent(''); setStreamStatus(''); setStreamToolCall(null) },
    }
    try {
      await streamChatSSE(text, history, token, abort.signal, h, (entry) => { setStepLog(prev => [...prev.slice(-19), { ts: new Date().toLocaleTimeString(), text: entry }]) }, approvalMode, activeModel)
    } catch (err: any) {
      if (err.name !== 'AbortError') setErrorBanner(err.message||'连接失败')
      if (aiContent && err.name === 'AbortError') setMessages(prev => [...prev, { id: aiId, role: 'assistant', content: aiContent, timestamp: Date.now(), toolCalls: toolCalls.length>0?toolCalls:undefined, isHtml: isHtmlContent(aiContent) }])
      setSending(false); setStreamContent(''); setStreamStatus('')
    }
  }
  function handleStop() { abortRef.current?.abort(); setSending(false); setStreamStatus('已停止') }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }

  const ModeIcon = mode.icon

  return (
    <div className="h-full flex flex-col bg-[var(--bg-primary)]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {errorBanner && (
        <div className="px-4 py-2 bg-[#f87171]/10 border-b border-[#f87171]/20 text-sm text-[#f87171] flex items-center justify-between">
          <span>⚠ {errorBanner}</span><button onClick={() => setErrorBanner(null)} className="text-[#f87171]/60 hover:text-[#f87171]">×</button>
        </div>
      )}

      {/* Messages */}
      <div ref={msgRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-5 scroll-smooth">
        {messages.length === 0 && !sending && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mb-5 opacity-25">
              <rect width="48" height="48" rx="10" fill="#0df0ff"/>
              <text x="24" y="33" textAnchor="middle" fill="#050510" fontSize="24" fontWeight="700" fontFamily="monospace">DS</text>
            </svg>
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-1.5">DaShengOS 指挥中心</h2>
            <p className="text-sm text-[var(--text-muted)] max-w-md">全域代理就绪 · 当前模式: <span style={{color: mode.color}}>{mode.label}</span></p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex gap-3 max-w-3xl", m.role === 'user' ? 'ml-auto flex-row-reverse' : '')}>
            <div className={cn("flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5", m.role === 'user' ? 'bg-[var(--accent-bg)]' : 'bg-[var(--bg-tertiary)]')}>
              {m.role === 'user' ? <User size={15} className="text-[var(--accent)]" /> : <Bot size={15} className="text-[var(--text-soft)]" />}
            </div>
            <div className={cn("flex-1 min-w-0", m.role === 'user' && 'flex flex-col items-end')}>
              <div className={cn("text-xs mb-1.5", m.role === 'user' ? 'text-[var(--accent)]/70 text-right' : 'text-[var(--text-muted)]')}>
                {m.role === 'user' ? 'You' : 'DaShengOS'}
                {m.latency_ms != null && <span className="ml-2 opacity-60">{m.latency_ms<1000?`${m.latency_ms}ms`:`${(m.latency_ms/1000).toFixed(1)}s`}</span>}
              </div>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="mb-2 space-y-1">
                  {m.toolCalls.map((tc, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs">
                      <span className={cn("inline-block w-1.5 h-1.5 rounded-full flex-shrink-0", tc.ok===undefined?'bg-amber-400 animate-pulse':tc.ok?'bg-[#4ade80]':'bg-[#f87171]')} />
                      <span className="text-[var(--brand)] font-mono text-[0.6rem]">{tc.name}</span>
                      <span className="text-[var(--text-muted)] truncate">{tc.args.slice(0,60)}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.isHtml ? <HtmlPreview html={m.content} /> : <div className="text-base text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">{m.content}</div>}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex gap-3 max-w-3xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center"><Loader2 size={15} className="text-[var(--brand)] animate-spin" /></div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[var(--text-muted)] mb-1.5">DaShengOS <span style={{color: mode.color}}>[{mode.label}]</span></div>
              {streamToolCall && (
                <div className="mb-2 flex items-center gap-2 px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                  <span className="text-[var(--brand)] font-mono text-[0.6rem]">{streamToolCall.name}</span>
                  <span className="text-[var(--text-muted)] truncate">{streamToolCall.args.slice(0,60)}</span>
                </div>
              )}
              {streamThink && <div className="mb-2 px-2.5 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)]/50 text-xs text-[var(--text-muted)] italic">{streamThink.slice(0,150)}</div>}
              {streamContent ? <div className="text-base text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">{streamContent}<span className="inline-block w-1.5 h-5 bg-[var(--brand)] animate-pulse ml-0.5 align-middle" /></div>
              : <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 size={14} className="animate-spin text-[var(--brand)]" />{streamStatus || '思考中...'}</div>}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Current step indicator — 只显示当前执行步骤，随流式更新 */}
      {stepLog.length > 0 && (
        <div className="mx-4 mb-0 flex-shrink-0">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)]/60 border border-[var(--border)]/50 text-xs text-[var(--text-soft)] transition-all duration-300">
            {sending ? (
              <Loader2 size={11} className="animate-spin text-[var(--brand)] flex-shrink-0" />
            ) : (
              <CheckCircle2 size={11} className="text-green-400 flex-shrink-0" />
            )}
            <span className="truncate">{stepLog[stepLog.length - 1]?.text || ''}</span>
          </div>
        </div>
      )}

      {/* Status bar */}
      {(streamStatus || sending) && (
        <div className="px-4 py-1 bg-[var(--bg-secondary)]/80 border-t border-[var(--border)] text-[0.6rem] flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-[var(--text-muted)]"><Loader2 size={9} className="animate-spin text-[var(--brand)]" /><span>{streamStatus || '处理中...'}</span></div>
          <div className="flex items-center gap-3">
            {streamTokens > 0 && <span className="text-[var(--text-muted)] flex items-center gap-1"><Zap size={9} className="text-amber-500/50" />{streamTokens.toFixed(0)} tok</span>}
            <button onClick={handleStop} className="px-2 py-0.5 text-[0.6rem] rounded bg-[#f87171]/10 text-[#f87171] hover:bg-[#f87171]/20">停止</button>
          </div>
        </div>
      )}

      {/* Input */}
      <footer className="border-t border-[var(--border)] p-3 bg-[var(--bg-primary)]">
        <form onSubmit={(e) => { e.preventDefault(); void send() }} className="flex items-center gap-2 max-w-3xl mx-auto">
          {/* + 菜单 */}
          <div className="relative" ref={plusRef}>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setShowPlusMenu(!showPlusMenu)}>
              <Plus size={18} />
            </Button>
            {showPlusMenu && (
              <PlusMenu onSelect={(text) => { setShowPlusMenu(false); setDraft(d => d + text) }} />
            )}
          </div>

          {/* 批准模式 */}
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] cursor-pointer" onClick={() => { const idx = APPROVAL_MODES.findIndex(m => m.key === approvalMode); setApprovalMode(APPROVAL_MODES[(idx+1)%3].key) }} title={mode.desc}>
            <ModeIcon size={13} style={{color: mode.color}} />
            <span className="text-[0.55rem] ml-1 font-mono" style={{color: mode.color}}>{mode.label}</span>
          </div>

          <>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileUpload} accept="*/*" />
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-[var(--text-muted)] hover:text-[var(--text-soft)]" aria-label="附件" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></Button>
          </>
          <Input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            className="flex-1 bg-[var(--bg-secondary)] border-[var(--border)] text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)] h-9 rounded-lg focus:border-[var(--brand)]/50 focus:ring-0"
            disabled={sending} />
          {/* 模型切换下拉 */}
          {availableModels.length > 0 && (
            <div className="relative flex-shrink-0" ref={modelMenuRef}>
              <button type="button" onClick={() => setShowModelMenu(!showModelMenu)}
                className="flex items-center gap-1 px-2 py-1 h-7 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[0.55rem] text-[var(--text-muted)] hover:text-[var(--brand)] hover:border-[var(--brand)]/40 transition-colors">
                <Cpu size={10} className="text-[var(--brand)]" />
                <span className="max-w-[70px] truncate">{activeModel.includes(':') ? activeModel.split(':')[1] : activeModel}</span>
                <ChevronDown size={9} className={showModelMenu ? 'rotate-180' : ''} />
              </button>
              {showModelMenu && (
                <div className="absolute bottom-full right-0 mb-1 w-56 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-2xl z-[100] py-1 max-h-64 overflow-y-auto">
                  <div className="px-2.5 py-1.5 text-[0.55rem] text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)]/50">切换模型</div>
                  {/* Group by provider */}
                  {(() => {
                    const providers = [...new Set(availableModels.map(m => m.provider))]
                    return providers.map(prov => (
                      <div key={prov}>
                        <div className="px-2.5 pt-2 pb-0.5 text-[0.5rem] text-[var(--text-muted)]/60 uppercase">{prov}</div>
                        {availableModels.filter(m => m.provider === prov).map(m => (
                          <button key={m.id} type="button"
                            onClick={() => { setActiveModel(m.id); setShowModelMenu(false) }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-[var(--bg-tertiary)] transition-colors">
                            <span className="flex-1 truncate text-[var(--text-soft)]">{m.label}</span>
                            {activeModel === m.id && <Check size={12} className="text-[var(--brand)] flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    ))
                  })()}
                </div>
              )}
            </div>
          )}
          {sending ? <Button type="button" size="icon" variant="ghost" className="h-9 w-9 text-[#f87171]" onClick={handleStop}><Square size={16} /></Button>
          : <Button type="submit" size="icon" className="h-9 w-9 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white" disabled={!draft.trim()}><Send size={15} /></Button>}
        </form>
      </footer>

      {/* MCP */}
      {mcpStatus.total > 0 && (
        <div className="px-4 py-1 bg-[var(--bg-secondary)] border-t border-[var(--border)]/50 text-[0.55rem] flex items-center gap-2 flex-shrink-0">
          <span className="text-[var(--text-muted)]">MCP:</span>
          {mcpStatus.servers.slice(0,6).map((s,i) => (
            <span key={i} className="inline-flex items-center gap-1 cursor-help" title={`${s.name}: ${s.online?'在线':'离线'}`}>
              <span className={cn("inline-block w-1.5 h-1.5 rounded-full", s.online?'bg-[#4ade80]':'bg-[#f87171]/60')} />
              <span className="text-[var(--text-muted)]">{s.name.slice(0,8)}</span>
            </span>
          ))}
          <span className="text-[var(--text-muted)] ml-auto">{mcpStatus.online}/{mcpStatus.total} 在线</span>
        </div>
      )}
    </div>
  )
}
