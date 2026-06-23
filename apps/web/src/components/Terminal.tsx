// DaShengOS Terminal · xterm.js 流式终端组件
// WebSocket 连接 PTY 引擎，支持全双工交互

import { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import 'xterm/css/xterm.css'

interface TerminalProps {
  className?: string
  cwd?: string
  onReady?: (sessionId: string) => void
  autoConnect?: boolean
}

export function Terminal({ className, cwd, onReady, autoConnect = true }: TerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const retryCount = useRef(0)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const MAX_RETRIES = 5

  // 清理函数
  const cleanup = useCallback(() => {
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null }
    retryCount.current = MAX_RETRIES
    wsRef.current?.close()
    wsRef.current = null
  }, [])

  // 连接 WebSocket
  const doConnect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (retryCount.current >= MAX_RETRIES) {
      xtermRef.current?.writeln('\r\n\x1b[91m[无法连接，请检查后端 :8000]\x1b[0m')
      return
    }

    const label = retryCount.current > 0
      ? `\r\n\x1b[93m[重连 ${retryCount.current}/${MAX_RETRIES}...]\x1b[0m`
      : '\r\n\x1b[36m[连接中...]\x1b[0m'
    xtermRef.current?.writeln(label)

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${location.hostname}:8000/api/v1/terminal`
    let token = ''
    try {
      const raw = localStorage.getItem('dasheng-auth')
      if (raw) token = JSON.parse(raw)?.state?.accessToken || ''
    } catch {}

    try {
      const ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
      wsRef.current = ws

      ws.onopen = () => {
        retryCount.current = 0
        xtermRef.current?.writeln('\r\n\x1b[32m[已连接]\x1b[0m')
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.type === 'session') onReady?.(msg.sessionId)
          else if (msg.type === 'data') xtermRef.current?.write(msg.data)
          else if (msg.type === 'exit') xtermRef.current?.writeln(`\r\n\x1b[93m[exit ${msg.exitCode}]\x1b[0m`)
        } catch {}
      }

      ws.onclose = () => {
        wsRef.current = null
        if (retryCount.current < MAX_RETRIES) {
          retryCount.current++
          xtermRef.current?.writeln(`\r\n\x1b[91m[断开]\x1b[0m \x1b[93m3s后重连...\x1b[0m`)
          retryTimer.current = setTimeout(() => doConnect(), 3000)
        } else {
          xtermRef.current?.writeln('\r\n\x1b[91m[连接失败]\x1b[0m')
        }
      }

      ws.onerror = () => { wsRef.current = null }
    } catch {
      xtermRef.current?.writeln('\r\n\x1b[91m[创建连接失败]\x1b[0m')
    }
  }, [onReady])

  // 初始化 xterm (只执行一次)
  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new XTerm({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0a0a0f', foreground: '#f0f0f0', cursor: '#0df0ff',
        selectionBackground: '#1a3a5c',
        black: '#1a1a2e', red: '#ff6b6b', green: '#00ff88', yellow: '#ffd93d',
        blue: '#6c9fff', magenta: '#c084fc', cyan: '#22d3ee', white: '#e0e0e0',
        brightBlack: '#3a3a5e', brightRed: '#ff8e8e', brightGreen: '#5fffaf',
        brightYellow: '#ffe66d', brightBlue: '#8cb4ff', brightMagenta: '#d4a0ff',
        brightCyan: '#67e8f9', brightWhite: '#ffffff',
      },
      allowProposedApi: true, scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon())
    term.open(termRef.current)
    fitAddon.fit()
    xtermRef.current = term
    fitAddonRef.current = fitAddon

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const onResize = () => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }
    window.addEventListener('resize', onResize)
    term.onResize(() => onResize())

    if (autoConnect) doConnect()

    return () => {
      window.removeEventListener('resize', onResize)
      cleanup()
      term.dispose()
      xtermRef.current = null
    }
  }, []) // 空依赖 — 只初始化一次

  return (
    <div className={className} style={{ width: '100%', height: '100%', minHeight: '300px' }}>
      <div ref={termRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

// ─── 内联终端// ─── 内联终端 (轻量版，用于 Chat 中显示命令执行) ───

interface InlineTerminalProps {
  output: string
  isRunning: boolean
  className?: string
}

export function InlineTerminal({ output, isRunning, className }: InlineTerminalProps) {
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)

  useEffect(() => {
    if (!termRef.current || xtermRef.current) return

    const term = new XTerm({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#050510',
        foreground: '#c0c0c0',
      },
      rows: 20,
      scrollback: 1000,
    })

    term.open(termRef.current)
    xtermRef.current = term

    return () => {
      term.dispose()
      xtermRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!xtermRef.current) return
    // 清除并重写输出
    xtermRef.current.clear()
    xtermRef.current.write(output.replace(/\n/g, '\r\n'))
    if (isRunning) {
      xtermRef.current.write('\r\n\x1b[33m⏳ 执行中...\x1b[0m')
    }
  }, [output, isRunning])

  return (
    <div className={className} style={{ width: '100%', minHeight: '200px' }}>
      <div ref={termRef} style={{ width: '100%' }} />
    </div>
  )
}

export default Terminal
