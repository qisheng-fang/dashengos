// apps/web/src/screens/Shell.tsx · DaShengOS v8.7
// 会话栏 + 导航栏 + 主区 + 底部终端

import { useUIStore } from '@/store/ui'
import { useAuthStore } from '@/lib/auth-store'
import { http, api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Settings, LogOut, Terminal, ChevronUp, ChevronDown, Activity, MessageSquare, Bot, Zap, Puzzle, Workflow, Globe, Palette, Film, Sun, Moon, Plus, Search, X, PanelLeft, ArrowRight, ExternalLink, MoreHorizontal, Edit3, Trash2, Archive, FolderOpen, Timer } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import { SimpleTerminal } from '@/components/SimpleTerminal'

interface ShellProps { children: ReactNode }

const NAV_ITEMS = [
  { to: '/chats/default', label: '工作台', icon: MessageSquare },
  { to: '/automations', label: '自动化', icon: Timer },
  { to: '/mcp', label: 'MCP', icon: Zap },
  { to: '/skills', label: 'Skills', icon: Puzzle },
  { to: '/studio', label: '工作流', icon: Workflow },
  { to: '/astrbot', label: 'AstrBot', icon: Bot },
  { to: '/agent-tars', label: 'Agent TARS', icon: Activity },
  { to: '/open-design', label: 'Open Design', icon: Palette },
  { to: '/openmontage', label: 'OpenMontage', icon: Film },
  { to: '/browser', label: '浏览器', icon: Globe },
  { to: '/terminal', label: '终端', icon: Terminal },
]

export function Shell({ children }: ShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clear)
  const { sessionBarOpen, toggleSessionBar, terminalOpen, toggleTerminal, setActiveSessionId } = useUIStore()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'online' | 'offline' | 'checking'>('checking')
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserUrl, setBrowserUrl] = useState('https://www.google.com')
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [sessionFilter, setSessionFilter] = useState<'active' | 'archived'>('active')
  const [archivedSessions, setArchivedSessions] = useState<Array<{ id: string; title: string; updated_at: string }>>([])
  const [projectPath, setProjectPath] = useState<string>(() => localStorage.getItem('dasheng_project') || '/Users/apple/Desktop/ai-workbench-v2')
  const [projectDirs, setProjectDirs] = useState<Array<{ path: string; name: string }>>([])
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')

  useEffect(() => setMounted(true), [])

  // Context menu closes via backdrop click or action selection

  useEffect(() => {
    const check = async () => {
      try { const res = await fetch('http://127.0.0.1:8000/api/v1/health/ping', { signal: AbortSignal.timeout(3000) }); setBackendStatus(res.ok ? 'online' : 'offline') }
      catch { setBackendStatus('offline') }
    }; check(); const i = setInterval(check, 15000); return () => clearInterval(i)
  }, [])

  // 加载会话列表（token 过期时静默停止，不做无效重试）
  useEffect(() => {
    const token = useAuthStore.getState().accessToken
    if (!token) return
    const load = async () => {
      try {
        const res = await http.get<{ sessions: Array<{ id: string; title: string; updated_at: string; status?: string }> }>('/api/v1/sessions')
        const allSessions = (res as any).sessions || []
        setSessions(allSessions.filter((s: any) => s.status !== 'ARCHIVED').slice(0, 50))
        setArchivedSessions(allSessions.filter((s: any) => s.status === 'ARCHIVED').slice(0, 50))
      } catch (e: any) {
        // 401 表示 token 过期，不重试（api client 会自动刷新）
        if (e.status === 401 || e.code === 'UNAUTHORIZED') return
        // 网络错误等可恢复的才重试
        console.warn('[Shell] 加载会话失败，5秒后重试:', e.message)
        setTimeout(load, 5000)
      }
    }
    load()
  }, [])

  useEffect(() => { api.setUnauthorizedHandler(() => { clearAuth(); void navigate({ to: '/login' }); return false }) }, [clearAuth, navigate])

  async function openSession(s: { id: string; title: string; updated_at: string }) {
    setActiveSessionId(s.id)
    // 加载会话消息到 localStorage，Chat 组件会读取
    try {
      const res = await fetch('http://127.0.0.1:8000/api/v1/sessions/' + s.id + '/messages?limit=50', {
        headers: { Authorization: 'Bearer ' + (useAuthStore.getState().accessToken || '') }
      })
      if (res.ok) {
        const data = await res.json()
        if (data.messages) {
          const msgs = data.messages.map((m: any) => ({
            id: m.id || 'm_' + Date.now(), role: m.role === 'USER' ? 'user' : 'assistant',
            content: m.content || '', timestamp: m.created_at || Date.now(),
            isHtml: /<!DOCTYPE html|<html/i.test((m.content || '').slice(0, 500)),
          }))
          localStorage.setItem('dasheng_chat_' + s.id, JSON.stringify(msgs))
        }
      }
    } catch {}
    // 导航到对话页
    navigate({ to: '/chats/' + s.id })
  }

  async function renameSession(sessionId: string, newTitle: string) {
    try {
      await http.patch('/api/v1/sessions/' + sessionId, { title: newTitle })
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: newTitle } : s))
    } catch {}
    setRenaming(null)
  }

  async function deleteSession(sessionId: string) {
    const token = useAuthStore.getState().accessToken
    if (!token) { console.error('no token'); return }
    try {
      const res = await fetch('/api/v1/sessions/' + sessionId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token }
      })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      } else {
        console.error('delete failed:', res.status, await res.text())
      }
    } catch (e) { console.error('delete failed:', e) }
    setContextMenu(null)
  }

  async function archiveSession(sessionId: string) {
    const token = useAuthStore.getState().accessToken
    if (!token) { console.error('no token'); return }
    try {
      const res = await fetch('/api/v1/sessions/' + sessionId + '/archive', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token }
      })
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== sessionId))
      } else {
        console.error('archive failed:', res.status, await res.text())
      }
    } catch (e) { console.error('archive failed:', e) }
    setContextMenu(null)
  }

  async function handleLogout() { try { await http.post('/api/v1/auth/logout') } catch {}; clearAuth(); void navigate({ to: '/login' }) }
  async function handleNewSession() {
    try { const res = await http.post<{ id: string }>('/api/v1/sessions', { title: '新会话' }); navigate({ to: `/chats/${(res as any).id || 'default'}` as any }) }
    catch { navigate({ to: '/chats/default' as any }) }
  }

  // 分离活跃/归档会话
  const activeSessions = sessions.filter(s =>
    !sessionSearch || s.title?.toLowerCase().includes(sessionSearch.toLowerCase())
  )
  const filteredArchived = archivedSessions.filter(s =>
    !sessionSearch || s.title?.toLowerCase().includes(sessionSearch.toLowerCase())
  )
  const displayedSessions = sessionFilter === 'active' ? activeSessions : filteredArchived

  const activePath = location.pathname
  const isDark = theme === 'dark'
  const filteredSessions = sessions.filter(s => !sessionSearch || s.title?.toLowerCase().includes(sessionSearch.toLowerCase()))

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] text-[var(--text-primary)] overflow-hidden" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* ① 顶栏 */}
      <header className="flex items-center justify-between px-4 h-11 bg-[var(--bg-primary)] border-b border-[var(--border)] flex-shrink-0 select-none">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={toggleSessionBar} title="会话栏">
            <PanelLeft size={16} />
          </Button>

          <Link to="/" className="flex items-center gap-2 no-underline">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect width="22" height="22" rx="5" fill="#0df0ff"/><text x="11" y="15.5" textAnchor="middle" fill="#050510" fontSize="12" fontWeight="700" fontFamily="monospace">DS</text>
            </svg>
            <span className="text-base font-semibold text-[var(--text-primary)] tracking-tight">DaShengOS</span>
          </Link>
          <span className="text-[0.55rem] text-[var(--text-muted)] hidden sm:inline">v8.7</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] hidden md:flex" onClick={() => setSearchOpen(true)} title="搜索会话"><Search size={15} /></Button>
        </div>
        <div className="flex items-center gap-1">
          {mounted && <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setTheme(isDark ? 'light' : 'dark')}>{isDark ? <Sun size={15} /> : <Moon size={15} />}</Button>}
          <span className="hidden md:flex items-center gap-1.5 text-[0.55rem] text-[var(--text-muted)] mr-1"><span className={cn("inline-block w-1.5 h-1.5 rounded-full", backendStatus === 'online' ? 'bg-[#4ade80]' : backendStatus === 'checking' ? 'bg-amber-400' : 'bg-[#f87171]')} />:8000</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={toggleTerminal}><Terminal size={15} /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]" onClick={() => setBrowserOpen(true)} title="内置浏览器"><Globe size={15} /></Button>
          <Link to="/settings"><Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><Settings size={15} /></Button></Link>
          {user && <div className="flex items-center gap-2 ml-2 pl-2 border-l border-[var(--border)]"><span className="text-[0.6rem] text-[var(--text-soft)] hidden md:inline">{user.username}</span><Button variant="ghost" size="icon" className="h-7 w-7 text-[var(--text-muted)] hover:text-[#f87171]" onClick={handleLogout}><LogOut size={14} /></Button></div>}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* ③ 导航栏 — 原左侧栏 */}
        <div className={cn("flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border)] flex-shrink-0 overflow-hidden transition-all duration-200", "w-[200px]")}>
          <div className="px-3 py-3"><span className="text-[0.55rem] text-[var(--text-muted)] uppercase tracking-wider px-1">导航</span></div>
          <div className="flex-1 space-y-0.5 px-2">
            {NAV_ITEMS.map(item => {
              const active = activePath.startsWith(item.to); const Icon = item.icon
              return <Link key={item.to} to={item.to} className={cn("flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors no-underline mb-0.5",
                active ? "bg-[var(--brand-bg)] text-[var(--brand)]" : "text-[var(--text-soft)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              )}><Icon size={14} /><span>{item.label}</span></Link>
            })}
          </div>
        </div>

        {/* ② 会话栏 — 左侧第一个 */}
        <div className={cn("flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border)] flex-shrink-0 overflow-hidden transition-all duration-200", sessionBarOpen ? "w-[240px]" : "w-0")}>
          <div className="p-3">
            <button onClick={handleNewSession} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-soft)] hover:text-[var(--text-primary)] hover:border-[var(--brand)] transition-colors text-sm">
              <Plus size={16} /> 新建会话
            </button>
          </div>
          {/* 本地项目 */}
          <div className="border-t border-[var(--border)] px-2 py-2">
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-[0.55rem] text-[var(--text-muted)] uppercase tracking-wider">本地项目</span>
              <button onClick={() => setShowProjectPicker(true)} className="text-[var(--text-muted)] hover:text-[var(--brand)]">
                <Plus size={13} />
              </button>
            </div>
            {/* 当前激活的项目 */}
            <div className="px-2 py-1.5 rounded bg-[var(--bg-tertiary)] mb-1.5" title={projectPath}>
              <div className="flex items-center gap-1.5">
                <span className="text-xs">📂</span>
                <span className="text-xs text-[var(--text-soft)] truncate">{projectPath.split('/').pop()}</span>
              </div>
              <div className="text-[0.5rem] text-[var(--text-muted)] mt-0.5 truncate">{projectPath}</div>
            </div>
            {/* 已保存的项目列表 */}
            {projectDirs.filter(d => d.path !== projectPath).slice(0, 5).map((d, i) => (
              <div key={i} onClick={() => { setProjectPath(d.path); localStorage.setItem('dasheng_project', d.path) }}
                className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] cursor-pointer truncate">
                <span className="text-[0.55rem]">📁</span>
                <span className="truncate">{d.name}</span>
              </div>
            ))}
          </div>



          <div className="px-3 pb-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input value={sessionSearch} onChange={e => setSessionSearch(e.target.value)} placeholder="搜索会话..." className="w-full pl-8 pr-2 py-1.5 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand)]" />
              {sessionSearch && <button onClick={() => setSessionSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"><X size={12} /></button>}
            </div>
          </div>
          <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border)]">
              <button onClick={() => setSessionFilter('active')} className={cn(
                "flex-1 text-xs py-1 rounded transition-colors",
                sessionFilter === 'active' ? "bg-[var(--brand-bg)] text-[var(--brand)]" : "text-[var(--text-muted)] hover:text-[var(--text-soft)]"
              )}>活跃</button>
              <button onClick={() => setSessionFilter('archived')} className={cn(
                "flex-1 text-xs py-1 rounded transition-colors",
                sessionFilter === 'archived' ? "bg-[var(--brand-bg)] text-[var(--brand)]" : "text-[var(--text-muted)] hover:text-[var(--text-soft)]"
              )}>归档 {archivedSessions.length > 0 ? `(${archivedSessions.length})` : ''}</button>
            </div>
            <div className="flex items-center justify-between px-3 py-1">
              <span className="text-[0.55rem] text-[var(--text-muted)] uppercase tracking-wider">对话管理</span>
              <button onClick={handleNewSession} className="text-[var(--text-muted)] hover:text-[var(--brand)]"><Plus size={13} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-2">
            {displayedSessions.map(s => (
              <button key={s.id} onClick={() => openSession(s)} className={cn("w-full text-left flex items-center gap-2 group px-3 py-1.5 rounded-md text-sm transition-colors mb-0.5",
                activePath === `/chats/${s.id}` ? "bg-[var(--brand-bg)] text-[var(--brand)]" : "text-[var(--text-soft)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
              )}><MessageSquare size={13} />
                {renaming === s.id ? (
                  <form onSubmit={(e) => { e.preventDefault(); renameSession(s.id, renameText) }} className="flex-1 flex gap-1">
                    <input autoFocus value={renameText} onChange={e => setRenameText(e.target.value)}
                      className="flex-1 bg-[var(--bg-primary)] border border-[var(--brand)] rounded px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
                      onBlur={() => setRenaming(null)} />
                  </form>
                ) : (
                  <span className="truncate flex-1">{s.title || '未命名'}</span>
                )}
                <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setContextMenu({ sessionId: s.id, x: e.clientX, y: e.clientY }) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-pointer inline-flex">
                  <MoreHorizontal size={13} />
                </span></button>
            ))}
            {displayedSessions.length === 0 && <div className="text-center text-[var(--text-muted)] text-sm py-4">暂无会话</div>}
          </div>
          {/* 项目选择弹窗 */}
          {showProjectPicker && (
            <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center" onClick={() => setShowProjectPicker(false)}>
              <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-md p-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-[var(--text-primary)]">添加项目文件夹</span>
                  <button onClick={() => setShowProjectPicker(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
                </div>
                <input
                  autoFocus
                  placeholder="输入文件夹路径，如 /Users/apple/Desktop/my-project"
                  className="w-full bg-[var(--bg-primary)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--brand)] mb-3"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim()
                      if (val) {
                        const name = val.split('/').pop() || val
                        setProjectDirs(prev => {
                          const updated = [{ path: val, name }, ...prev.filter(p => p.path !== val)].slice(0, 20)
                          localStorage.setItem('dasheng_projects', JSON.stringify(updated))
                          return updated
                        })
                        setProjectPath(val)
                        localStorage.setItem('dasheng_project', val)
                        setShowProjectPicker(false)
                      }
                    }
                  }}
                />
                <div className="text-[0.55rem] text-[var(--text-muted)] mb-2">常用项目</div>
                {['/Users/apple/Desktop/ai-workbench-v2', '/Users/apple/Documents/Codex/open-design', '/Users/apple/Downloads'].map(p => {
                  const name = p.split('/').pop() || p
                  return (
                    <button key={p} onClick={() => {
                      setProjectDirs(prev => {
                        const updated = [{ path: p, name }, ...prev.filter(d => d.path !== p)].slice(0, 20)
                        localStorage.setItem('dasheng_projects', JSON.stringify(updated))
                        return updated
                      })
                      setProjectPath(p)
                      localStorage.setItem('dasheng_project', p)
                      setShowProjectPicker(false)
                    }} className="w-full text-left px-3 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] flex items-center gap-2">
                      <span>📁</span> <span className="truncate">{p}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

        </div>

        {/* ④ 主区 */}
        <main className="flex-1 overflow-hidden bg-[var(--bg-primary)]">{children}</main>
      </div>

      {/* ⑤ 终端 — 轻量版 HTTP 命令执行 */}
      {terminalOpen && <SimpleTerminal onClose={toggleTerminal} />}
      {!terminalOpen && <button onClick={toggleTerminal} className="fixed bottom-3 right-4 z-50 flex items-center gap-1 px-2.5 py-1 rounded bg-[var(--bg-tertiary)]/90 text-[0.55rem] text-[var(--text-muted)] border border-[var(--border)] shadow-lg"><Terminal size={11} /><ChevronUp size={11} /></button>}

      
      {/* 内置浏览器弹窗 */}
      {browserOpen && (
        <div className="fixed inset-0 z-[200] bg-black/70 flex items-center justify-center p-4" onClick={() => setBrowserOpen(false)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
              <Globe size={14} className="text-[var(--brand)] flex-shrink-0" />
              <input
                value={browserUrl}
                onChange={e => setBrowserUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && setBrowserUrl(browserUrl)}
                placeholder="输入网址..."
                className="flex-1 bg-[var(--bg-primary)] border border-[var(--border)] rounded px-2 py-1 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--brand)]"
              />
              <button onClick={() => window.open(browserUrl, '_blank')} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="在系统浏览器打开">
                <ExternalLink size={14} />
              </button>
              <button onClick={() => setBrowserOpen(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <iframe src={browserUrl} className="flex-1 w-full border-0 bg-white" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" title="内置浏览器" />
          </div>
        </div>
      )}

      
      {/* 右键菜单背景遮罩 */}
      {contextMenu && (
        <div className="fixed inset-0 z-[240]" onClick={() => setContextMenu(null)} />
      )}
      {/* 右键菜单 */}
      {contextMenu && (
        <div onClick={e => e.stopPropagation()} className="fixed z-[250] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl p-1 min-w-[160px]"
          style={{ left: contextMenu.x - 80, top: contextMenu.y - 10 }}>
          <button onClick={() => { setRenaming(contextMenu.sessionId); setRenameText(sessions.find(s => s.id === contextMenu.sessionId)?.title || ''); setContextMenu(null) }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">
            <Edit3 size={13} /> 重命名
          </button>
          <button onClick={() => archiveSession(contextMenu.sessionId)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[var(--text-soft)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]">
            <Archive size={13} /> 归档
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <button onClick={() => deleteSession(contextMenu.sessionId)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-[#f87171] hover:bg-[#f87171]/10">
            <Trash2 size={13} /> 删除
          </button>
        </div>
      )}

      {/* 搜索弹窗 */}
      {searchOpen && (
        <div className="fixed inset-0 z-[200] bg-black/60 flex items-start justify-center pt-[15vh]" onClick={() => setSearchOpen(false)}>
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl w-full max-w-lg shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <Search size={16} className="text-[var(--text-muted)]" />
              <input
                autoFocus
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                placeholder="搜索会话..."
                className="flex-1 bg-transparent border-none outline-none text-base text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />
              <button onClick={() => { setSearchOpen(false); setGlobalSearch('') }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={16} /></button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {displayedSessions.length === 0 && globalSearch && (
                <div className="text-center text-sm text-[var(--text-muted)] py-8">未找到 "{globalSearch}"</div>
              )}
              {displayedSessions.map(s => (
                <Link key={s.id} to={`/chats/${s.id}` as any} onClick={() => { setSearchOpen(false); setGlobalSearch('') }}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-tertiary)] transition-colors no-underline border-b border-[var(--border)]/50 last:border-0">
                  <MessageSquare size={15} className="text-[var(--text-muted)] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--text-primary)] truncate">{s.title || '未命名'}</div>
                    <div className="text-[0.55rem] text-[var(--text-muted)]">{s.updated_at ? new Date(s.updated_at).toLocaleString() : ''}</div>
                  </div>
                  <ArrowRight size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                </Link>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-[var(--border)] text-[0.55rem] text-[var(--text-muted)]">
              {sessions.length} 个会话
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
