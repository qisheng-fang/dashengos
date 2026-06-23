// DaShengOS SimpleTerminal — HTTP 命令执行终端
// 不走 WebSocket，直接 POST /api/v1/terminal/exec
import { useState, useRef, useEffect } from 'react'

export function SimpleTerminal({ onClose }: { onClose: () => void }) {
  const [output, setOutput] = useState<string[]>(['$ 简易终端就绪 — 输入命令后回车执行'])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [output])

  async function execute(cmd: string) {
    if (!cmd.trim()) return
    setOutput(prev => [...prev, `$ ${cmd}`])
    setInput('')
    setRunning(true)
    try {
      const token = (() => {
        try { return JSON.parse(localStorage.getItem('dasheng-auth') || '{}')?.state?.accessToken || '' }
        catch { return '' }
      })()
      const resp = await fetch('/api/v1/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ command: cmd, cwd: '/Users/apple/Desktop/ai-workbench-v2' }),
      })
      const data = await resp.json()
      if (data.output) {
        setOutput(prev => [...prev, ...data.output.split('\n').filter((l: string) => l.trim())])
      } else if (data.error) {
        setOutput(prev => [...prev, `\x1b[31m${data.error}\x1b[0m`])
      }
    } catch (e: any) {
      // Fallback: if API fails, try the PTY WebSocket approach
      setOutput(prev => [...prev, `\x1b[33m后端未响应: ${e.message}\x1b[0m`])
      setOutput(prev => [...prev, '\x1b[36m提示: 可在左侧导航点击「终端」使用完整 PTY 终端\x1b[0m'])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-48 bg-[#0a0a0f] border-t border-[#1e1e2e] flex-shrink-0 flex flex-col font-mono text-xs">
      <div className="flex items-center justify-between px-3 py-1 bg-[#12121f] border-b border-[#1e1e2e]">
        <span className="text-[10px] text-[#888]">Terminal</span>
        <button onClick={onClose} className="text-[#888] hover:text-white text-xs">✕</button>
      </div>
      <div ref={outputRef} className="flex-1 overflow-auto px-3 py-1 text-[#0df0ff] whitespace-pre-wrap">
        {output.map((line, i) => (
          <div key={i} className={line.startsWith('$') ? 'text-[#4ade80]' : 'text-[#e0e0e0]'}>
            {line}
          </div>
        ))}
        {running && <div className="text-[#fbbf24]">⏳ 执行中...</div>}
      </div>
      <form
        onSubmit={e => { e.preventDefault(); execute(input) }}
        className="flex items-center border-t border-[#1e1e2e] px-2"
      >
        <span className="text-[#4ade80] mr-1">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-[#f0f0f0] py-1.5 text-xs font-mono placeholder:text-[#555]"
          placeholder="输入命令..."
          disabled={running}
          spellCheck={false}
        />
      </form>
    </div>
  )
}
