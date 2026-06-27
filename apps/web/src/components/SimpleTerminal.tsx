// SimpleTerminal — 隐藏 input 方案 + 强制聚焦
import { useState, useEffect, useRef } from 'react'

export function SimpleTerminal({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<string[]>(['DaShengOS Terminal v6.1 — 点击任意位置后输入命令'])
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState<boolean | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [val, setVal] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/v1/health/ping')
      .then(r => r.json()).then(d => setOk(d.status === 'ok'))
      .catch(() => setOk(false))
  }, [])

  const tok = () => {
    try { return JSON.parse(localStorage.getItem('dasheng-auth') || '{}')?.state?.accessToken || '' }
    catch { return '' }
  }

  const focus = () => {
    const el = inputRef.current
    if (el) { el.focus(); el.click() }
  }

  // 强制聚焦：监听 mousedown 在容器内
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = () => focus()
    el.addEventListener('mousedown', handler)
    return () => el.removeEventListener('mousedown', handler)
  }, [])

  // 初始聚焦
  useEffect(() => { setTimeout(focus, 300) }, [])

  const exec = async () => {
    const c = val.trim()
    if (!c || busy) return
    setLines(prev => [...prev, '$ ' + c])
    setVal('')
    setBusy(true)
    try {
      const r = await fetch('/api/v1/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok() },
        body: JSON.stringify({ command: c, cwd: '/Users/apple/Desktop/ai-workbench-v2' }),
      })
      const d = await r.json()
      if (d.output) setLines(prev => [...prev, ...d.output.split('\n').filter(l => l)])
      if (d.error) setLines(prev => [...prev, 'ERR: ' + d.error])
    } catch (e: any) {
      setLines(prev => [...prev, 'ERR: ' + e.message])
    } finally {
      setBusy(false)
      setTimeout(focus, 100)
    }
  }

  return (
    <div ref={containerRef} className="h-48 bg-[#0a0a0f] border-t border-[#1e1e2e] flex-shrink-0 flex flex-col font-mono text-xs"
      style={{ cursor: 'text' }}>
      {/* bar */}
      <div className="flex items-center justify-between px-2 py-0.5 bg-[#12121f] border-b border-[#1e1e2e]">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok === true ? 'bg-green-500' : ok === false ? 'bg-red-500' : 'bg-yellow-500'}`} />
          <span className="text-[10px] text-neutral-500">Terminal</span>
          {ok === true && <span className="text-[9px] text-green-600">在线</span>}
          {ok === false && <span className="text-[9px] text-red-500">离线</span>}
        </div>
        <button onClick={onClose} className="text-neutral-500 hover:text-white text-sm leading-none">✕</button>
      </div>
      {/* output */}
      <div className="flex-1 overflow-auto px-2 py-1 text-neutral-300 leading-relaxed">
        {lines.map((l, i) => <div key={i} className="whitespace-pre-wrap break-all">{l}</div>)}
        {busy && <div className="text-cyan-400 animate-pulse text-xs">...</div>}
      </div>
      {/* input line */}
      <div className="border-t border-[#1e1e2e] flex items-center px-2 py-1 relative">
        <span className="text-green-400 mr-1.5 select-none font-bold">$</span>
        <span className={`text-sm ${val ? 'text-neutral-200' : 'text-neutral-600'}`}>
          {val || (ok === false ? '后端离线' : '点击输入命令...')}
        </span>
        {val && <span className="inline-block w-0.5 h-4 bg-cyan-400 ml-0.5 animate-pulse align-middle" />}
        <input
          ref={inputRef}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); exec() } }}
          className="absolute opacity-0 w-0 h-0"
          autoFocus
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  )
}
