// apps/web/src/components/visualization/SvgRenderer.tsx · Phase A.5
// 安全 SVG 渲染器 — 清洗脚本/事件处理器, 限尺寸
import { useMemo, useState, useRef, useCallback, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { Maximize2, Minimize2 } from 'lucide-react'

// 危险标签/属性
const DANGEROUS_TAGS = ['script', 'foreignObject', 'iframe', 'object', 'embed']
const DANGEROUS_ATTRS = [
  'onload', 'onerror', 'onclick', 'ondblclick', 'onmousedown', 'onmouseup',
  'onmouseover', 'onmousemove', 'onmouseout', 'onkeydown', 'onkeyup',
  'onkeypress', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset',
  'onselect', 'onresize', 'onscroll', 'onunload', 'xlink:href',
] as const

// 属性中危险协议
const DANGEROUS_PROTOCOLS = ['javascript:', 'data:text/html', 'vbscript:']

export interface SvgRendererProps {
  /** 原始 SVG 字符串 */
  svg: string
  className?: string
  /** 最大宽度 (px), 默认 960 */
  maxWidth?: number
  /** 最大高度 (px), 默认 640 */
  maxHeight?: number
  /** 标题 */
  title?: string
  /** 允许全屏 */
  allowFullscreen?: boolean
  /** 空状态提示 */
  placeholder?: string
}

/**
 * 安全清洗 SVG 字符串:
 * 1. 去掉 <script> / <foreignObject> / <iframe> 等危险标签
 * 2. 去掉 on* 事件处理器
 * 3. 清理 javascript: / data:text/html 等危险协议
 * 4. 去掉 XML 声明
 */
function sanitizeSvg(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let svg = raw.trim()
  if (svg.length === 0) return ''

  // 去掉 XML 声明
  svg = svg.replace(/<\?xml[^?]*\?>/gi, '').trim()

  // 提取 <svg>...</svg> 块 (去掉 HTML wrapper)
  const svgMatch = svg.match(/<svg[\s\S]*?<\/svg>/i)
  if (svgMatch) {
    svg = svgMatch[0]
  }

  // 1. 移除危险标签
  for (const tag of DANGEROUS_TAGS) {
    svg = svg.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '')
    svg = svg.replace(new RegExp(`<${tag}\\b[^>]*/>`, 'gi'), '')
  }

  // 2. 移除 on* 事件处理器 (属性中)
  for (const attr of DANGEROUS_ATTRS) {
    svg = svg.replace(new RegExp(`\\s${attr}=["'][^"']*["']`, 'gi'), '')
    svg = svg.replace(new RegExp(`\\s${attr}=[^\\s>]*`, 'gi'), '')
  }

  // 3. 移除危险协议
  for (const proto of DANGEROUS_PROTOCOLS) {
    svg = svg.replace(new RegExp(proto, 'gi'), '')
  }

  // 4. 限制 viewBox 尺寸 (防止放大溢出)
  //    不改 viewBox 本身, 由 CSS max-width/max-height 控制

  return svg
}

export function SvgRenderer({
  svg,
  className,
  maxWidth = 960,
  maxHeight = 640,
  title,
  allowFullscreen = true,
  placeholder = '暂无 SVG 内容',
}: SvgRendererProps) {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const safeSvg = useMemo(() => sanitizeSvg(svg), [svg])

  const toggleFullscreen = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  // Escape key to exit fullscreen
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) {
        setExpanded(false)
        containerRef.current?.focus()
      }
    },
    [expanded],
  )

  if (!safeSvg) {
    return (
      <div className={cn('flex items-center justify-center p-8 text-neutral-500 text-sm', className)}>
        {placeholder}
      </div>
    )
  }

  const hasViewBox = /viewBox=["']/i.test(safeSvg)
  // 解析 SVG 中的 viewBox 用于比例计算
  const vbMatch = safeSvg.match(/viewBox=["']([\d.\s-]+)["']/i)
  const [, vbW, vbH] = vbMatch?.[1]?.split(/\s+/)?.map(Number) ?? []

  const containerStyle: CSSProperties = expanded
    ? {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
      }
    : {
        maxWidth: hasViewBox && vbW && vbW < maxWidth ? vbW : maxWidth,
        maxHeight: hasViewBox && vbH && vbH < maxHeight ? vbH : maxHeight,
        width: '100%',
      }

  const svgStyle: CSSProperties = {
    width: '100%',
    height: 'auto',
    maxWidth: expanded ? '90vw' : containerStyle.maxWidth,
    maxHeight: expanded ? '90vh' : containerStyle.maxHeight,
  }

  return (
    <div
      className={cn('relative group', className)}
    >
      {title && (
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-neutral-400 font-medium">{title}</span>
          {allowFullscreen && (
            <button
              onClick={toggleFullscreen}
              className="text-neutral-500 hover:text-neutral-300 transition-colors p-1"
              aria-label={expanded ? '退出全屏' : '全屏查看'}
            >
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        style={containerStyle}
        className={cn(
          'overflow-auto rounded-lg border border-neutral-800 bg-neutral-900/50 p-4 flex items-center justify-center',
          expanded && 'cursor-zoom-out',
        )}
        onClick={expanded ? toggleFullscreen : undefined}
        onKeyDown={handleKeyDown}
        tabIndex={expanded ? 0 : undefined}
        role={expanded ? 'dialog' : undefined}
        aria-label={expanded ? '全屏 SVG 查看' : undefined}
      >
        <div
          className="svg-content"
          style={svgStyle}
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      </div>
    </div>
  )
}
