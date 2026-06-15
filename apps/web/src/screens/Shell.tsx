// apps/web/src/screens/Shell.tsx · v0.3 spec §31 (5 区 WorkspaceShell 完整实现)
// ① TopBar 56px + ② Sidebar 280px + ③ ChatMainArea + ④ RightPanel 320px + ⑤ InputBar
// mobile: sidebar/rightpanel 抽屉; tablet: sidebar 60px; desktop/wide: 全展开
//
// 2026-06-15 修复 (老板反馈 "UI 界面无法实现功能和布局问题"):
//   - root 加 h-screen flex flex-col (整个壳不能塌)
//   - Sidebar 底部按钮改 mt-auto flex 自然推底 (之前 absolute 漂屏)
//   - Sidebar "新会话" 接 /api/v1/sessions 真接口 (之前纯占位)
//   - "最近会话" 调 /api/v1/sessions 真拉 (之前 3 条硬编码 mock)

import { useUIStore } from '@/store/ui'
import { useAuthStore } from '@/lib/auth-store'
import { http } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Menu, Settings, Sun, Moon, Plus, Search, LogOut, Loader2 } from 'lucide-react'
import { useTheme } from 'next-themes'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { useBreakpoint, type Breakpoint } from '@/hooks/useBreakpoint'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { MessageSquare, Bot, Zap, FolderOpen, Wrench, Workflow } from 'lucide-react'
import { MobileNav } from '@/components/MobileNav'

interface ShellProps {
  children: ReactNode
}

const NAV_ITEMS = [
  { to: '/', label: '工作台', icon: MessageSquare },
  { to: '/agents', label: 'Agent', icon: Bot },
  { to: '/mcp', label: 'MCP', icon: Zap },
  { to: '/files', label: '文件', icon: FolderOpen },
  // Track C.2 (2026-06-15) 加 Studio 入口 (ComfyUI 式工作流)
  { to: '/studio', label: 'Studio', icon: Workflow },
  { to: '/settings', label: '设置', icon: Wrench },
]

export function Shell({ children }: ShellProps) {
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const { sidebarOpen, rightPanelOpen, toggleSidebar, setSidebarOpen, setRightPanelOpen } =
    useUIStore()
  const user = useAuthStore((s) => s.user)
  const clearAuth = useAuthStore((s) => s.clear)
  const bp = useBreakpoint()
  const location = useLocation()

  async function handleLogout() {
    try {
      await http.post('/api/v1/auth/logout')
    } catch {
      // ignore
    }
    clearAuth()
    void navigate({ to: '/login' })
  }

  // 移动端默认收起
  const isMobile = bp === 'mobile'
  const showSidebar = !isMobile && sidebarOpen
  const showRightPanel = !isMobile && rightPanelOpen

  // 平板默认 sidebar 60px
  const sidebarWidth = bp === 'tablet' && sidebarOpen ? '60px' : showSidebar ? '280px' : '0px'
  const rightPanelWidth = showRightPanel ? '320px' : '0px'

  return (
    <div className="layout h-screen flex flex-col bg-neutral-950 text-neutral-100" data-bp={bp}>
      {/* ① TopBar 56px */}
      <header className="topbar flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-950 flex-shrink-0 h-14">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="切换侧栏">
            <Menu />
          </Button>
          <Link to="/" className="font-semibold text-neutral-100 flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-brand flex items-center justify-center text-neutral-950 text-sm font-bold">
              DS
            </div>
            {bp !== 'mobile' && <span>DaShengOS</span>}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="hidden md:flex">
            <Search size={14} className="mr-1" /> 搜索会话
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label="切换主题"
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label="设置">
            <Link to="/settings">
              <Settings />
            </Link>
          </Button>
          {user && (
            <div
              className="hidden md:flex items-center gap-2 px-2 py-1 rounded-md text-xs text-neutral-300"
              title={`${user.username} · ${user.role}`}
            >
              <div className="w-6 h-6 rounded-full bg-brand/20 text-brand flex items-center justify-center font-semibold">
                {user.username.slice(0, 1).toUpperCase()}
              </div>
              <span>{user.username}</span>
            </div>
          )}
          <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="登出">
            <LogOut />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden pb-14 md:pb-0">
        {/* ② Sidebar */}
        <AnimatePresence>
          {showSidebar && (
            <motion.aside
              initial={{ x: -280, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -280, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-neutral-900 border-r border-neutral-800 overflow-y-auto flex-shrink-0"
              style={{ width: sidebarWidth }}
            >
              <Sidebar bp={bp} currentPath={location.pathname} />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ③ ChatMainArea */}
        <main className="flex-1 overflow-auto bg-neutral-950">{children}</main>

        {/* ④ RightPanel */}
        <AnimatePresence>
          {showRightPanel && (
            <motion.aside
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="bg-neutral-900 border-l border-neutral-800 overflow-y-auto flex-shrink-0"
              style={{ width: rightPanelWidth }}
            >
              <RightPanel />
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* 移动端 backdrop */}
      {isMobile && (sidebarOpen || rightPanelOpen) && (
        <div
          className="fixed inset-0 z-modal bg-black/60"
          onClick={() => {
            setSidebarOpen(false)
            setRightPanelOpen(false)
          }}
        />
      )}
      <MobileNav />
    </div>
  )
}

function Sidebar({ bp, currentPath }: { bp: Breakpoint; currentPath: string }) {
  const isCollapsed = bp === 'tablet'
  const navigate = useNavigate()
  const [recentSessions, setRecentSessions] = useState<Array<{ id: string; title: string; agent_id: string }>>([])
  const [loadingSessions, setLoadingSessions] = useState(false)

  // 拉最近会话 (失败/未登录 → 静默空列表)
  useEffect(() => {
    let cancelled = false
    setLoadingSessions(true)
    http
      .get<{ sessions: Array<{ id: string; title: string; agent_id: string; updated_at: number }> }>(
        '/api/v1/sessions',
      )
      .then((res) => {
        if (cancelled) return
        const sorted = [...res.sessions]
          .sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0))
          .slice(0, 8)
        setRecentSessions(sorted)
      })
      .catch(() => {
        // 静默空
      })
      .finally(() => {
        if (!cancelled) setLoadingSessions(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleNewSession() {
    try {
      const res = await http.post<{ id: string }>('/api/v1/sessions', {
        agent_id: 'deep-researcher',
        title: '新会话',
      })
      void navigate({ to: '/chats/$id', params: { id: res.id } })
    } catch {
      // 静默
    }
  }

  return (
    <nav className="p-3 space-y-1 h-full flex flex-col relative">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        const isActive =
          item.to === '/' ? currentPath === '/' : currentPath.startsWith(item.to)

        return (
          <Link
            key={item.to}
            to={item.to}
            aria-label={item.label}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors',
              isActive
                ? 'bg-brand/10 text-brand font-medium'
                : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100',
            )}
          >
            <Icon size={16} className="flex-shrink-0" aria-hidden="true" />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
          </Link>
        )
      })}

      {!isCollapsed && (
        <>
          <div className="border-t border-neutral-800 my-3" />
          <div className="px-3 py-2 text-xs font-medium text-neutral-400 uppercase tracking-wider flex items-center justify-between">
            <span>最近会话</span>
            {loadingSessions && <Loader2 size={10} className="animate-spin" />}
          </div>
          <ul className="space-y-0.5 max-h-64 overflow-y-auto">
            {recentSessions.length === 0 && !loadingSessions ? (
              <li className="px-3 py-1.5 text-xs text-neutral-500">暂无会话</li>
            ) : (
              recentSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    to="/chats/$id"
                    params={{ id: s.id }}
                    className="block px-3 py-1.5 rounded text-xs text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 truncate transition-colors"
                    title={`${s.title} · ${s.agent_id}`}
                  >
                    {s.title || `会话 ${s.id.slice(-6)}`}
                  </Link>
                </li>
              ))
            )}
          </ul>
        </>
      )}

      <div className="mt-auto pt-3 border-t border-neutral-800">
        <Button
          size="sm"
          className="w-full"
          leftIcon={<Plus size={14} />}
          onClick={handleNewSession}
          aria-label="新会话"
        >
          {isCollapsed ? '' : '新会话'}
        </Button>
      </div>
    </nav>
  )
}

// RightPanel — 3 tab (工具/文件/Trace), 工具 tab 从 /api/v1/tools 拉真列表
//   之前: 写死 3 个 tool calls (read_file/search_code/list_dir), search_code 401 是 hardcoded
//   Phase 10: 真接 backend, 顶部 tab 切活动面板, 文件 tab 显示最近文件, Trace tab 显示 session 日志
type Tab = 'tools' | 'files' | 'trace'

interface Tool {
  id: string
  category: string
  description: string
}

interface ActiveCall {
  id: string
  tool: string
  status: 'success' | 'running' | 'queued' | 'error'
  duration?: string
  started_at: number
}

function RightPanel() {
  const location = useLocation()
  const [activeTab, setActiveTab] = useState<Tab>('tools')
  const [tools, setTools] = useState<Tool[]>([])
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([])
  const [loadingTools, setLoadingTools] = useState(true)
  const [invokeBusy, setInvokeBusy] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ tool: string; result: unknown; ts: number } | null>(null)

  // Phase 10: 真接 /api/v1/tools
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingTools(true)
      try {
        const res = await http.get<{ tools: Tool[]; count: number }>('/api/v1/tools')
        if (cancelled) return
        setTools(res.tools)
      } catch {
        // 忽略, 显示空
      } finally {
        if (!cancelled) setLoadingTools(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // 从当前 URL 解析 session id (/_workspace/chats/$id)
  const sessionMatch = location.pathname.match(/\/chats\/([^/]+)/)
  const sessionId = sessionMatch?.[1]

  // 触发工具 (手动 invoke)
  async function invokeTool(toolId: string) {
    setInvokeBusy(toolId)
    const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const startedAt = Date.now()
    const newCall: ActiveCall = { id: callId, tool: toolId, status: 'running' as const, started_at: startedAt }
    setActiveCalls((c): ActiveCall[] => [newCall, ...c].slice(0, 8))
    try {
      const res = await http.post<{ result: unknown; duration_ms: number }>(
        `/api/v1/tools/${toolId}/invoke`,
        { params: toolId === 'sandbox.exec' ? { command: 'echo', args: ['hi-from-ui'] } : {} },
      )
      setActiveCalls((c) =>
        c.map((x) => (x.id === callId ? { ...x, status: 'success', duration: `${res.duration_ms}ms` } : x)),
      )
      setLastResult({ tool: toolId, result: res.result, ts: Date.now() })
    } catch (e) {
      setActiveCalls((c) =>
        c.map((x) => (x.id === callId ? { ...x, status: 'error' as const } : x)),
      )
    } finally {
      setInvokeBusy(null)
      // 3s 后自动移除 (避免 panel 太长)
      setTimeout(() => setActiveCalls((c) => c.filter((x) => x.id !== callId)), 3000)
    }
  }

  return (
    <div className="p-3 space-y-3 h-full overflow-auto">
      <div className="flex border-b border-neutral-800 -mx-3">
        {(['tools', 'files', 'trace'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 py-2 text-xs font-medium',
              activeTab === tab
                ? 'text-brand border-b-2 border-brand'
                : 'text-neutral-400 hover:text-neutral-100',
            )}
          >
            {tab === 'tools' ? '工具' : tab === 'files' ? '文件' : 'Trace'}
          </button>
        ))}
      </div>

      {activeTab === 'tools' && (
        <div className="space-y-2">
          {/* 当前活动调用 */}
          {activeCalls.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 uppercase tracking-wider px-1 mb-1">Active Calls</div>
              {activeCalls.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'flex items-center gap-2 px-2 py-1.5 rounded text-xs mb-1',
                    c.status === 'success' && 'bg-semantic-success/10 text-semantic-success',
                    c.status === 'running' && 'bg-semantic-info/10 text-semantic-info',
                    c.status === 'queued' && 'bg-neutral-800 text-neutral-400',
                    c.status === 'error' && 'bg-semantic-danger/10 text-semantic-danger',
                  )}
                >
                  {c.status === 'success' && '✓'}
                  {c.status === 'running' && <Loader2 size={10} className="animate-spin" />}
                  {c.status === 'queued' && '⏱'}
                  {c.status === 'error' && '⚠'}
                  <span className="font-mono">{c.tool}</span>
                  {c.duration && <span className="ml-auto">{c.duration}</span>}
                </div>
              ))}
            </div>
          )}

          {/* 最近一次 invoke 结果 */}
          {lastResult && (
            <details className="rounded border border-neutral-800 bg-neutral-900/50 p-2 text-xs">
              <summary className="cursor-pointer text-neutral-300 font-mono">
                {lastResult.tool} (result)
              </summary>
              <pre className="mt-1 text-neutral-400 overflow-auto max-h-40 text-[10px]">
                {JSON.stringify(lastResult.result, null, 2)}
              </pre>
            </details>
          )}

          {/* 真工具列表 (从 /api/v1/tools) */}
          <div>
            <div className="text-xs text-neutral-400 uppercase tracking-wider px-1 mb-1">
              Available Tools ({tools.length})
            </div>
            {loadingTools ? (
              <div className="text-xs text-neutral-500 px-2 py-1">加载中...</div>
            ) : tools.length === 0 ? (
              <div className="text-xs text-neutral-500 px-2 py-1">暂无工具</div>
            ) : (
              <div className="space-y-1">
                {tools.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => invokeTool(t.id)}
                    disabled={invokeBusy === t.id}
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-neutral-800 border border-transparent hover:border-neutral-700 disabled:opacity-50 transition-colors"
                    title={t.description}
                  >
                    <div className="flex items-center gap-1.5">
                      {invokeBusy === t.id ? (
                        <Loader2 size={10} className="animate-spin text-semantic-info" />
                      ) : (
                        <span className="text-neutral-500">▶</span>
                      )}
                      <span className="font-mono text-neutral-200">{t.id}</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">{t.category}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'files' && (
        <div className="text-xs text-neutral-500 p-2">
          {sessionId ? (
            <span>
              Session <span className="font-mono">{sessionId.slice(-8)}</span> · 文件浏览
              <br />
              <span className="text-neutral-600">(Phase 10.5 接 /api/v1/tools/file.read 列表当前 session 的 audit 文件)</span>
            </span>
          ) : (
            <span>无 active session. 进 Chat 屏才显示文件</span>
          )}
        </div>
      )}

      {activeTab === 'trace' && (
        <div className="text-xs text-neutral-500 p-2">
          {sessionId ? (
            <span>
              Session <span className="font-mono">{sessionId.slice(-8)}</span> · Trace
              <br />
              <span className="text-neutral-600">(Phase 10.5 接 /api/v1/audit/logs 实时拉)</span>
            </span>
          ) : (
            <span>无 active session. 进 Chat 屏才显示 Trace</span>
          )}
        </div>
      )}
    </div>
  )
}
