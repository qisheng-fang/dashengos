// apps/web/src/screens/Workspace.tsx · Smart Dispatcher Chat + Memory (2026-06-17)
// 上下文记忆：localStorage 持久化消息 + 每次请求带完整对话历史

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Send, Bot, User, Loader2, Square, Search, FileText, BarChart3, Trash2 } from 'lucide-react'
import { http } from '@/lib/api'
import { cn } from '@/lib/utils'

interface UiMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  subAgents?: string[]
}

function newId(): string { return `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }

const MSGS_KEY = 'dasheng_workspace_msgs'
const THREAD_KEY = 'dasheng_workspace_thread'

const WELCOME_DEFAULT = '你好！我是 DaShengOS 智能工作台 🧠\n\n直接告诉我你想做什么，我会自动调度所需工具：\n\n• 简单问答 → 直接回复\n• 查资料 → 自动搜索互联网\n• 写文章 → AI 智能写作\n• 复杂任务 → 自动编排执行'

function getDefaultWelcome(): UiMessage {
  return { id: 'welcome', role: 'assistant', timestamp: Date.now(), content: WELCOME_DEFAULT }
}

function loadMsgs(): UiMessage[] {
  try { const r = localStorage.getItem(MSGS_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveMsgs(msgs: UiMessage[]) { localStorage.setItem(MSGS_KEY, JSON.stringify(msgs)) }

export function Workspace() {
  const [messages, setMessages] = useState<UiMessage[]>(() => {
    const saved = loadMsgs()
    return saved.length > 0 ? saved : [getDefaultWelcome()]
  })
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [statusText, setStatusText] = useState('')
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const threadIdRef = useRef<string>(localStorage.getItem(THREAD_KEY) || `ws_${Date.now().toString(36)}`)

  // 持久化
  useEffect(() => { saveMsgs(messages); localStorage.setItem(THREAD_KEY, threadIdRef.current) }, [messages])
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])
  useEffect(() => { inputRef.current?.focus() }, [])

  // 🔄 动态欢迎语：从后端加载可配置欢迎语
  useEffect(() => {
    const token = localStorage.getItem('dasheng-auth')
    if (!token) return
    try {
      const auth = JSON.parse(token)
      fetch('/api/v1/chat/welcome', {
        headers: { Authorization: `Bearer ${auth.state?.accessToken || ''}` },
      })
        .then(res => res.json())
        .then(data => {
          if (data.workspace) {
            const saved = loadMsgs()
            if (saved.length === 0 || saved[0]?.id === 'welcome') {
              setMessages([{ id: 'welcome', role: 'assistant', timestamp: Date.now(), content: data.workspace }])
            }
          }
        })
        .catch(() => {})
    } catch {}
  }, [])

  function clearHistory() {
    localStorage.removeItem(MSGS_KEY)
    saveMsgs([])
    setMessages([getDefaultWelcome()])
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || running) return
    setInput('')

    const userMsg: UiMessage = { id: newId(), role: 'user', content: text, timestamp: Date.now() }
    const assistantMsg: UiMessage = { id: newId(), role: 'assistant', content: '', timestamp: Date.now() }
    const updated = [...messages, userMsg, assistantMsg]
    setMessages(updated)
    saveMsgs(updated)
    setRunning(true)
    setStatusText('分析中...')

    try {
      // 构建历史（最近10轮对话）
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-20)
        .map(m => ({ role: m.role, content: m.content }))

      // TimeoutController 5分钟 (大报告可能需要)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 5 * 60 * 1000)

      setStatusText('正在调用 AI 引擎...')

      const response = await http.post<{
        threadId: string
        status: string
        report: string
        sources?: string[]
        artifacts?: Array<{ type: string; format?: string; fileName?: string; size?: number; downloadUrl?: string; error?: string }>
      }>(
        '/api/v1/chat',
        { message: text, threadId: threadIdRef.current, history },
        { signal: controller.signal },
      )
      clearTimeout(timer)

      // 业务闭环：artifacts 中有文档时，在消息末尾加下载链接
      let displayContent = response.report || '完成任务'
      if (response.artifacts && response.artifacts.length > 0) {
        const docArtifacts = response.artifacts.filter(a => a.type === 'document' && a.downloadUrl)
        if (docArtifacts.length > 0) {
          // ★ 用可点击 HTML 链接（不被 markdown 转义）
          // 从 zustand persist 拿 token
          let bearer = ''
          try {
            const authRaw = localStorage.getItem('dasheng-auth')
            if (authRaw) {
              const parsed = JSON.parse(authRaw)
              bearer = parsed?.state?.accessToken || ''
            }
          } catch { /* ignore */ }
          const links = docArtifacts.map(a => {
            const sizeKB = a.size ? `${(a.size / 1024).toFixed(1)} KB` : ''
            const handleClick = `onClick="event.preventDefault(); fetch('${a.downloadUrl}',{headers:{Authorization:'Bearer ${bearer}'}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b);const l=document.createElement('a');l.href=u;l.download='${a.fileName}';l.click();URL.revokeObjectURL(u);})"`
            return `<a href="${a.downloadUrl}" ${handleClick} class="text-brand underline cursor-pointer" target="_blank">📄 ${a.fileName} (${sizeKB})</a>`
          }).join('<br/>')
          // ★ 检测 HTML 报告：分离 Markdown 文本 + HTML 渲染
          const htmlMatch = displayContent.match(/```html\s*([\s\S]*?)\s*```/)
          if (htmlMatch) {
            // ★ 提取 HTML 单独渲染（带设计感的报告）
            const htmlContent = htmlMatch[1]
            const beforeHtml = displayContent.substring(0, htmlMatch.index || 0).trim()
            const afterHtml = displayContent.substring((htmlMatch.index || 0) + htmlMatch[0].length).trim()
            const reportDescription = beforeHtml || '报告已生成'

            // 把 HTML 注入到独立 iframe（避免 Tailwind class 污染）
            const escapedHtml = htmlContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
            displayContent = `
              <div class="text-sm text-neutral-300 mb-3">${reportDescription}</div>
              <div class="my-3 rounded-xl overflow-hidden border border-neutral-700 bg-white shadow-2xl">
                <div class="flex items-center justify-between bg-neutral-800 px-4 py-2 text-xs text-neutral-300 border-b border-neutral-700">
                  <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-red-500"></span>
                    <span class="w-2 h-2 rounded-full bg-yellow-500"></span>
                    <span class="w-2 h-2 rounded-full bg-green-500"></span>
                    <span class="ml-2">📊 精雕娃娃行业报告 · HTML Preview</span>
                  </div>
                  <div class="flex gap-2">
                    <button onclick="document.getElementById('html-fullscreen').requestFullscreen()" class="px-2 py-0.5 rounded hover:bg-neutral-700 transition">⛶ 全屏</button>
                    <button onclick="document.getElementById('html-source').style.display = document.getElementById('html-source').style.display === 'none' ? 'block' : 'none'" class="px-2 py-0.5 rounded hover:bg-neutral-700 transition">{'</>'} 源码</button>
                  </div>
                </div>
                <iframe id="html-fullscreen" src="data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}" style="width:100%;height:600px;border:0;background:white;" sandbox="allow-scripts allow-same-origin"></iframe>
                <div id="html-source" style="display:none;max-height:400px;overflow:auto;background:#1a1a1a;color:#e5e5e5;padding:16px;font-family:monospace;font-size:11px;white-space:pre-wrap;border-top:1px solid #333;">${escapedHtml}</div>
              </div>
              <div class="mt-3 p-3 bg-gradient-to-r from-brand/10 to-brand/5 border border-brand/30 rounded-lg">
                <div class="text-sm font-semibold text-brand mb-2 flex items-center gap-2">📎 可下载文件</div>
                ${links}
                <div class="text-[10px] text-neutral-500 mt-2">点击直接下载 · 支持 Word/Excel/PPT/PDF</div>
              </div>
              ${afterHtml ? `<div class="text-xs text-neutral-400 mt-2">${afterHtml}</div>` : ''}
            `
          } else {
            // 普通 markdown 报告
            displayContent = `${displayContent}\n\n---\n<div class="mt-3 p-3 bg-brand/5 border border-brand/20 rounded-lg"><div class="text-sm font-semibold text-brand mb-2">📎 可下载文件</div>${links}<div class="text-[10px] text-neutral-500 mt-2">点击直接下载，或在文档生成页面查看</div></div>`
          }
        }
      }

      setMessages(prev => {
        const next = prev.map(m =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: displayContent,
                subAgents: response.sources,
                timestamp: Date.now(),
              }
            : m
        )
        saveMsgs(next)
        return next
      })
      setStatusText('')
    } catch (e: any) {
      setMessages(prev => {
        const next = prev.map(m =>
          m.id === assistantMsg.id
            ? { ...m, content: `AI 引擎不可用：${e?.message ?? '未知'}\n\n请确认后端 :8000 正在运行。` }
            : m
        )
        saveMsgs(next)
        return next
      })
      setStatusText('')
    } finally { setRunning(false) }
  }

  function handleStop() { setRunning(false); setStatusText('') }
  function handleKeyDown(e: React.KeyboardEvent) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  return (
    <div className="h-full flex flex-col bg-neutral-950">
      {statusText && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-brand/10 border-b border-brand/20 text-xs text-brand">
          <Loader2 size={12} className="animate-spin" /> {statusText}
        </div>
      )}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((m) => (
            <div key={m.id} className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : '')}>
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
                m.role === 'user' ? 'bg-brand/20 text-brand' : m.role === 'system' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-neutral-700 text-neutral-300')}>
                {m.role === 'user' ? <User size={14} /> : m.role === 'system' ? <Search size={14} /> : <Bot size={14} />}
              </div>
              <div className={cn('flex-1 max-w-[80%]', m.role === 'user' && 'flex justify-end')}>
                <Card className={cn('p-3 text-sm leading-relaxed',
                  m.role === 'user' ? 'bg-brand/10 border-brand/20 text-neutral-100' :
                  m.role === 'system' ? 'bg-yellow-500/5 border-yellow-500/20 text-yellow-200 text-xs' :
                  'bg-neutral-900/80 border-neutral-800 text-neutral-100')}>
                  {m.content ? <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: m.content }} /> :
                   <div className="flex items-center gap-2 text-neutral-500"><Loader2 size={14} className="animate-spin" />思考中...</div>}
                  {m.subAgents && m.subAgents.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-neutral-800 flex flex-wrap gap-1">
                      {m.subAgents.map(a => <span key={a} className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">{a}</span>)}
                    </div>
                  )}
                </Card>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-neutral-800 px-4 py-4 bg-neutral-950/80 backdrop-blur">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <Input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder="输入任务，DaShengOS 自动执行..." className="flex-1 bg-neutral-900 border-neutral-700 text-base h-12 placeholder:text-neutral-500" disabled={running} />
          {running ? (
            <Button size="lg" variant="outline" onClick={handleStop} className="h-12"><Square size={16} /></Button>
          ) : (
            <Button size="lg" onClick={handleSend} disabled={!input.trim()} className="h-12 bg-brand hover:bg-brand/80"><Send size={18} /></Button>
          )}
        </div>
        <div className="max-w-3xl mx-auto mt-2 flex gap-3 justify-between">
          <div className="flex gap-3">
            <span className="text-[10px] text-neutral-600"><Search size={10} className="inline mr-1" />搜索</span>
            <span className="text-[10px] text-neutral-600"><FileText size={10} className="inline mr-1" />写作</span>
            <span className="text-[10px] text-neutral-600"><BarChart3 size={10} className="inline mr-1" />分析</span>
          </div>
          <button onClick={clearHistory} className="text-[10px] text-neutral-600 hover:text-red-400 flex items-center gap-1">
            <Trash2 size={10} />清空记忆
          </button>
        </div>
      </div>
    </div>
  )
}
