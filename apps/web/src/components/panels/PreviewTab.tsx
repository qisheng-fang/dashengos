// apps/web/src/components/panels/PreviewTab.tsx · 2026-06-20
// 右侧预览面板 — 展示文本/图片/代码/Markdown/HTML

import { useEffect, useRef } from 'react'
import { usePreviewStore, type PreviewItem } from '@/store/preview'
import { X, FileText, Image, Code, Globe, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { marked } from 'marked'

/** 简易 Markdown 渲染 (兜底 marked) */
function MarkdownView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) {
      ref.current.innerHTML = marked.parse(content, { breaks: true }) as string
    }
  }, [content])
  return <div ref={ref} className="prose prose-sm prose-invert max-w-none text-xs [&_pre]:bg-neutral-900 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-auto [&_code]:text-[11px] [&_img]:max-w-full [&_img]:rounded" />
}

/** 代码预览 (基础高亮) */
function CodeView({ content, language }: { content: string; language?: string }) {
  return (
    <pre className="bg-neutral-900 rounded-lg p-3 overflow-auto max-h-[60vh] text-[11px] font-mono text-neutral-200 leading-relaxed">
      {language && <div className="text-neutral-500 text-[10px] mb-1 uppercase">{language}</div>}
      <code>{content}</code>
    </pre>
  )
}

/** 图片预览 */
function ImageView({ content, title }: { content: string; title: string }) {
  return (
    <div className="space-y-2">
      <img
        src={content}
        alt={title}
        className="w-full rounded-lg border border-neutral-800"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none'
        }}
      />
      <div className="text-[10px] text-neutral-500 break-all font-mono">{content}</div>
    </div>
  )
}

/** HTML 预览 */
function HtmlView({ content, title }: { content: string; title: string }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-neutral-500">{title}</div>
      <iframe
        srcDoc={content}
        title={title}
        className="w-full h-64 rounded-lg border border-neutral-800 bg-white"
        sandbox="allow-scripts"
      />
    </div>
  )
}

/** 文本预览 */
function TextView({ content }: { content: string }) {
  return (
    <pre className="text-xs text-neutral-300 whitespace-pre-wrap break-words leading-relaxed max-h-[60vh] overflow-auto">
      {content}
    </pre>
  )
}

/** JSON 预览 */
function JsonView({ content }: { content: string }) {
  let formatted = content
  try {
    formatted = JSON.stringify(JSON.parse(content), null, 2)
  } catch { /* use raw */ }
  return <CodeView content={formatted} language="json" />
}

function ItemIcon({ type }: { type: PreviewItem['type'] }) {
  const cls = 'w-3.5 h-3.5 text-neutral-500'
  switch (type) {
    case 'image': return <Image className={cls} />
    case 'code': return <Code className={cls} />
    case 'markdown': return <FileText className={cls} />
    case 'html': return <Globe className={cls} />
    case 'json': return <Code className={cls} />
    default: return <FileText className={cls} />
  }
}

const ITEM_LABEL: Record<PreviewItem['type'], string> = {
  text: '文本', markdown: 'MD', image: '图片', code: '代码', html: 'HTML', json: 'JSON',
}

export default function PreviewTab() {
  const { items, activeId, setActive, remove, clear } = usePreviewStore()
  const active = items.find((i) => i.id === activeId)
  const idx = active ? items.indexOf(active) : -1

  const goPrev = () => {
    if (idx < items.length - 1) setActive(items[idx + 1].id)
  }
  const goNext = () => {
    if (idx > 0) setActive(items[idx - 1].id)
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600 gap-3">
        <Eye className="w-8 h-8 opacity-30" />
        <div className="text-xs text-center">
          <p className="mb-1">暂无预览内容</p>
          <p className="text-[10px]">当 Agent 输出文档、图片或<br />代码时，会自动显示在此处</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 历史列表 */}
      <div className="border-b border-neutral-800 pb-2 mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-neutral-500 uppercase tracking-wider">历史预览</span>
          <button onClick={clear} className="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors">
            清空
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 max-w-full">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => setActive(item.id)}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded text-[10px] whitespace-nowrap flex-shrink-0 transition-colors',
                item.id === activeId
                  ? 'bg-brand/20 text-brand border border-brand/30'
                  : 'bg-neutral-900 text-neutral-400 border border-neutral-800 hover:border-neutral-700',
              )}
            >
              <ItemIcon type={item.type} />
              <span className="max-w-[80px] truncate">{item.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 当前预览内容 */}
      {active && (
        <div className="flex-1 overflow-auto">
          {/* 标题栏 */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded font-medium',
                active.type === 'image' && 'bg-purple-500/20 text-purple-400',
                active.type === 'code' && 'bg-amber-500/20 text-amber-400',
                active.type === 'markdown' && 'bg-blue-500/20 text-blue-400',
                active.type === 'html' && 'bg-green-500/20 text-green-400',
                active.type === 'json' && 'bg-amber-500/20 text-amber-400',
                active.type === 'text' && 'bg-neutral-500/20 text-neutral-400',
              )}>
                {ITEM_LABEL[active.type]}
              </span>
              <span className="text-xs text-neutral-300 truncate">{active.title}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <span className="text-[10px] text-neutral-600">
                {idx + 1}/{items.length}
              </span>
              <button onClick={goNext} disabled={idx <= 0} className="text-neutral-600 hover:text-neutral-400 disabled:opacity-30">
                <ChevronLeft className="w-3 h-3" />
              </button>
              <button onClick={goPrev} disabled={idx >= items.length - 1} className="text-neutral-600 hover:text-neutral-400 disabled:opacity-30">
                <ChevronRight className="w-3 h-3" />
              </button>
              <button onClick={() => remove(active.id)} className="text-neutral-600 hover:text-red-400 transition-colors ml-1">
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* 来源 */}
          {active.source && (
            <div className="text-[10px] text-neutral-500 mb-2">
              来源: {active.source}
            </div>
          )}

          {/* 内容区 */}
          <div className="rounded-lg">
            {active.type === 'image' && <ImageView content={active.content} title={active.title} />}
            {active.type === 'code' && <CodeView content={active.content} language={active.language} />}
            {active.type === 'markdown' && <MarkdownView content={active.content} />}
            {active.type === 'html' && <HtmlView content={active.content} title={active.title} />}
            {active.type === 'json' && <JsonView content={active.content} />}
            {active.type === 'text' && <TextView content={active.content} />}
          </div>
        </div>
      )}
    </div>
  )
}
