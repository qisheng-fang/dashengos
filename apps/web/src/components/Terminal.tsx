// DaShengOS Terminal v6.2 — Hermes 对齐 · WebSocket PTY 真实终端
// 连接 ws://127.0.0.1:8001，使用 node-pty 引擎

import { useState, useRef, useEffect, useCallback } from 'react'

type Line = { text: string; type?: 'input' | 'output' | 'error' | 'info' | 'system' }

const WELCOME: Line[] = [
  { text: '╔══════════════════════════════════════════╗', type: 'info' },
  { text: '║     DaShengOS Terminal · OMNI-BRAIN     ║', type: 'info' },
  { text: '║     真实 PTY 终端 · 像 Hermes 一样       ║', type: 'info' },
  { text: '║     ws://127.0.0.1:8001                  ║', type: 'info' },
  { text: '╚══════════════════════════════════════════╝', type: 'info' },
  { text: '', type: 'system' },
]

const LINE_COLORS: Record<string, string> = {
  'input': 'text-cyan-400 font-semibold',
  'output': 'text-neutral-200 font-mono text-sm',
  'error': 'text-red-400 font-mono text-sm',
  'info': 'text-cyan-400 font-mono text-xs',
  'system': 'text-neutral-600 font-mono text-xs',
}

export function Terminal({ className }: { className?: string }) {
  const [lines, setLines] = useState<Line[]>(WELCOME)
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight }, [lines])

  const addLine = useCallback((text: string, type?: Line['type']) => {
    setLines(prev => [...prev, { text, type }])
  }, [])

  // 连接 PTY WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    addLine('连接终端...', 'system')
    const ws = new WebSocket('ws://127.0.0.1:8001')
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      addLine('[已连接] PTY 终端就绪', 'info')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'session') {
          setSessionId(msg.sessionId)
        } else if (msg.type === 'data') {
          // PTY 输出按行分割
          const text = msg.data as string
          if (text.includes('\n')) {
            text.split('\n').filter(Boolean).forEach(l => addLine(l, 'output'))
          } else if (text.trim()) {
            addLine(text, 'output')
          }
        } else if (msg.type === 'exit') {
          addLine(`[进程退出, exit code: ${msg.exitCode}]`, 'system')
        }
      } catch {
        // 非 JSON 消息，直接输出
        addLine(event.data, 'output')
      }
    }

    ws.onclose = () => {
      setConnected(false)
      addLine('[连接断开] 3秒后自动重连...', 'error')
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    ws.onerror = () => {
      addLine('[连接失败] 终端服务 :8001 不可达', 'error')
    }
  }, [addLine])

  // 断开
  const disconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    wsRef.current?.close()
    wsRef.current = null
    setConnected(false)
    setSessionId(null)
  }, [])

  // 挂载时连接，卸载时断开
  useEffect(() => {
    connect()
    return () => disconnect()
  }, [])

  // 发送输入
  const sendInput = useCallback((data: string) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      addLine('终端未连接', 'error')
      return
    }
    wsRef.current.send(JSON.stringify({ type: 'input', data }))
  }, [addLine])

  // 处理回车
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      const cmd = input.trim()
      addLine('$ ' + cmd, 'input')
      sendInput(cmd + '\n')
      setInput('')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      // TODO: command history
    } else if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
      sendInput('\x03') // Ctrl+C
    }
  }

  return (
    <div className={`flex flex-col h-full bg-neutral-950 ${className || ''}`}>
      {/* 状态栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        <span className="text-[10px] text-neutral-500 flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {connected ? 'PTY 已连接' : '未连接'}
          {sessionId && <span className="text-neutral-700">| {sessionId.slice(0, 8)}</span>}
        </span>
        <div className="flex gap-2">
          {!connected ? (
            <button onClick={connect} className="text-[10px] text-cyan-400 hover:text-cyan-300">连接</button>
          ) : (
            <button onClick={disconnect} className="text-[10px] text-neutral-600 hover:text-neutral-400">断开</button>
          )}
          <button onClick={() => setLines(WELCOME)} className="text-[10px] text-neutral-600 hover:text-neutral-400">清屏</button>
        </div>
      </div>

      {/* 输出区域 */}
      <div ref={outputRef} className="flex-1 overflow-y-auto p-3 font-mono text-sm scrollbar-thin">
        {lines.map((line, i) => (
          <div key={i} className={`whitespace-pre-wrap break-all leading-5 ${LINE_COLORS[line.type || 'output'] || 'text-neutral-300'}`}>
            {line.text}
          </div>
        ))}
      </div>

      {/* 输入行 */}
      <div className="flex items-center px-3 py-2 bg-neutral-900 border-t border-neutral-800 flex-shrink-0">
        <span className="text-cyan-400 font-mono text-sm mr-2 flex-shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected}
          placeholder={connected ? '输入命令...' : '终端未连接...'}
          className="flex-1 bg-transparent text-neutral-200 font-mono text-sm outline-none placeholder:text-neutral-700"
          autoFocus
        />
        {!connected && (
          <button onClick={connect} className="text-xs text-cyan-400 hover:text-cyan-300 ml-2 px-2 py-0.5 rounded border border-cyan-400/30">
            重连
          </button>
        )}
      </div>
    </div>
  )
}
