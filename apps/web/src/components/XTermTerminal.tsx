// XTermTerminal.tsx — Hermes 对齐 · 真实 xterm.js 终端
// 连接 ws://127.0.0.1:8001 PTY WebSocket

import { useEffect, useRef } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'

export function XTermTerminal({ className }: { className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Create xterm instance
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e2e2e8',
        cursor: '#00d4aa',
        selectionBackground: '#1e3a5f',
        black: '#1a1a2e',
        red: '#ff6b6b',
        green: '#00d4aa',
        yellow: '#ffd93d',
        blue: '#6c9fff',
        magenta: '#c084fc',
        cyan: '#67e8f9',
        white: '#e2e2e8',
        brightBlack: '#3a3a4e',
        brightRed: '#ff8787',
        brightGreen: '#69db7c',
        brightYellow: '#ffe066',
        brightBlue: '#91b3ff',
        brightMagenta: '#daa8ff',
        brightCyan: '#9be9fd',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitRef.current = fitAddon

    // Connect WebSocket
    const connect = () => {
      term.writeln('\x1b[36m连接终端...\x1b[0m')
      const ws = new WebSocket('ws://127.0.0.1:8001')
      wsRef.current = ws

      ws.onopen = () => {
        term.writeln('\x1b[32m[已连接] PTY 终端就绪\x1b[0m\r\n')
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'data') {
            term.write(msg.data)
          } else if (msg.type === 'exit') {
            term.writeln(`\r\n\x1b[33m[进程退出, exit code: ${msg.exitCode}]\x1b[0m`)
          }
        } catch {
          // Raw data
          term.write(event.data)
        }
      }

      ws.onclose = () => {
        term.writeln('\r\n\x1b[31m[连接断开] 3秒后自动重连...\x1b[0m')
        setTimeout(connect, 3000)
      }

      ws.onerror = () => {
        term.writeln('\x1b[31m[连接失败] 终端服务 :8001 不可达\x1b[0m')
      }
    }

    connect()

    // Keyboard input → WebSocket
    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Resize handling
    const handleResize = () => {
      fitAddon.fit()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }))
      }
    }

    const observer = new ResizeObserver(() => {
      handleResize()
    })
    observer.observe(containerRef.current)
    window.addEventListener('resize', handleResize)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
      wsRef.current?.close()
      term.dispose()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className || ''}`}
      style={{ padding: '4px' }}
    />
  )
}
