// apps/web/src/components/workspace/CodeBlock.tsx · v0.3 spec §33.6
// Shiki 代码高亮 (v0.3 spec §30.3 锁版 · 0 客户端 JS · ~200 主题)
// Phase 1 PR5 简化为 <pre><code> 渲染, Phase 2 接 Shiki SSR 高亮

import { Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export interface CodeBlockProps {
  code: string
  language?: string
  filename?: string
}

export function CodeBlock({ code, language = 'typescript', filename }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 overflow-hidden">
      {filename && (
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900/50">
          <span className="text-xs text-neutral-400 font-mono">{filename}</span>
          <span className="text-[10px] text-neutral-400 uppercase">{language}</span>
        </div>
      )}
      <div className="relative">
        <pre className="p-3 text-xs font-mono text-neutral-200 overflow-x-auto">
          <code>{code}</code>
        </pre>
        <Button
          size="icon"
          variant="ghost"
          onClick={copy}
          className="absolute top-2 right-2 h-7 w-7"
          aria-label={copied ? '已复制' : '复制代码'}
        >
          {copied ? <Check size={12} className="text-semantic-success" /> : <Copy size={12} />}
        </Button>
      </div>
    </div>
  )
}
