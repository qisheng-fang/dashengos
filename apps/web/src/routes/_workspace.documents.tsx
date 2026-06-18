// apps/web/src/routes/_workspace.documents.tsx · Phase A.4 (2026-06-17)
// 文档生成页面 — AI 辅助生成 PPTX/DOCX/PDF/XLSX

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Loader2, Download, FileText, FileSpreadsheet, Presentation, File, Sparkles, Trash2, RefreshCw } from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { http, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────

interface FormatInfo {
  id: string
  name: string
  extension: string
  mime_type: string
  ai_supported: boolean
  available: boolean
}

interface GenerateResponse {
  ok: boolean
  file_path: string
  file_name: string
  size: number
  format: string
}

interface HistoryItem {
  id: string
  format: string
  file_name: string
  size: number
  topic?: string
  created_at: number
}

type DocFormat = 'pptx' | 'docx' | 'pdf' | 'xlsx'

// ─── Constants ────────────────────────────────────────────

const FORMAT_ICONS: Record<DocFormat, typeof FileText> = {
  pptx: Presentation,
  docx: FileText,
  pdf: File,
  xlsx: FileSpreadsheet,
}

const FORMAT_LABELS: Record<DocFormat, string> = {
  pptx: 'PPT 演示文稿',
  docx: 'Word 文档',
  pdf: 'PDF 文档',
  xlsx: 'Excel 表格',
}

const FORMAT_PLACEHOLDERS: Record<DocFormat, string> = {
  pptx: '例如：Q3季度工作总结、新产品发布会、技术方案分享',
  docx: '例如：项目立项书、技术调研报告、团队管理手册',
  pdf: '例如：投资人路演材料、年度数据报告、白皮书',
  xlsx: '例如：项目预算表、竞品对比分析、销售数据统计',
}

// ─── Component ────────────────────────────────────────────

export function Documents() {
  const [selectedFormat, setSelectedFormat] = useState<DocFormat>('pptx')
  const [topic, setTopic] = useState('')
  const [manualContent, setManualContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenerateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formats, setFormats] = useState<FormatInfo[]>([])
  const [loadingFormats, setLoadingFormats] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Load formats ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingFormats(true)
      try {
        const res = await http.get<{
          formats: FormatInfo[]
          python: string
        }>('/api/v1/documents/formats')
        if (!cancelled) setFormats(res.formats)
      } catch {
        if (!cancelled) {
          setFormats([
            { id: 'pptx', name: 'PPT 演示文稿', extension: '.pptx', mime_type: '', ai_supported: true, available: false },
            { id: 'docx', name: 'Word 文档', extension: '.docx', mime_type: '', ai_supported: true, available: false },
            { id: 'pdf', name: 'PDF 文档', extension: '.pdf', mime_type: '', ai_supported: true, available: false },
            { id: 'xlsx', name: 'Excel 表格', extension: '.xlsx', mime_type: '', ai_supported: true, available: false },
          ])
        }
      } finally {
        if (!cancelled) setLoadingFormats(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Load history from localStorage ──────────────────────
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dasheng_doc_history')
      if (stored) setHistory(JSON.parse(stored))
    } catch { /* ignore */ }
  }, [])

  function addToHistory(item: HistoryItem) {
    const updated = [item, ...history].slice(0, 20)
    setHistory(updated)
    localStorage.setItem('dasheng_doc_history', JSON.stringify(updated))
  }

  function removeFromHistory(id: string) {
    const updated = history.filter((h) => h.id !== id)
    setHistory(updated)
    localStorage.setItem('dasheng_doc_history', JSON.stringify(updated))
  }

  // ── Generate ─────────────────────────────────────────────
  async function handleGenerate() {
    setError(null)
    setResult(null)

    if (!topic.trim() && !manualContent.trim()) {
      setError('请输入主题或手动内容')
      return
    }

    // Build request body
    const body: Record<string, unknown> = {
      format: selectedFormat,
    }

    if (topic.trim()) {
      body.topic = topic.trim()
    }

    if (manualContent.trim()) {
      try {
        const parsed = JSON.parse(manualContent.trim())
        body.content = parsed
      } catch {
        // Not JSON — treat as raw content
        if (selectedFormat === 'pdf') {
          body.content = { html: manualContent.trim(), title: topic.trim() || 'Untitled' }
        } else if (selectedFormat === 'pptx') {
          body.content = { slides: [{ title: topic.trim() || 'Slide', content: manualContent.trim() }] }
        } else if (selectedFormat === 'docx') {
          body.content = { sections: [{ heading: topic.trim() || 'Section', content: manualContent.trim() }] }
        } else {
          body.content = { sheets: [{ name: 'Sheet1', headers: ['内容'], rows: manualContent.trim().split('\n').map((l) => [l]) }] }
        }
      }
    }

    setGenerating(true)
    try {
      const res = await http.post<GenerateResponse>('/api/v1/documents/generate', body)
      setResult(res)
      addToHistory({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        format: res.format,
        file_name: res.file_name,
        size: res.size,
        topic: topic.trim() || undefined,
        created_at: Date.now(),
      })
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message || '文档生成失败')
      } else {
        setError((e as Error).message || '文档生成失败')
      }
    } finally {
      setGenerating(false)
    }
  }

  // ── Download ─────────────────────────────────────────────
  async function handleDownload(fileName: string) {
    setDownloadBusy(fileName)
    try {
      const token = localStorage.getItem('dasheng_access_token') || ''
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const baseUrl = import.meta.env.VITE_API_URL || ''
      const resp = await fetch(`${baseUrl}/api/v1/documents/download/${fileName}`, {
        headers,
      })

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.message || '下载失败')
      }

      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message || '下载失败')
    } finally {
      setDownloadBusy(null)
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const currentFormat = formats.find((f) => f.id === selectedFormat)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
          <Sparkles size={24} className="text-brand" />
          文档生成
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          AI 驱动的文档生成工具 — 支持 PPT、Word、PDF、Excel 四种格式
        </p>
      </div>

      {/* Format Tabs */}
      <Card className="border-neutral-800 bg-neutral-900/60">
        <CardContent className="pt-4">
          <div className="flex gap-1 bg-neutral-800/50 rounded-lg p-1" role="tablist">
            {(['pptx', 'docx', 'pdf', 'xlsx'] as DocFormat[]).map((fmt) => {
              const Icon = FORMAT_ICONS[fmt]
              const info = formats.find((f) => f.id === fmt)
              return (
                <button
                  key={fmt}
                  role="tab"
                  aria-selected={selectedFormat === fmt}
                  onClick={() => {
                    setSelectedFormat(fmt)
                    setResult(null)
                    setError(null)
                  }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2 px-2 rounded-md text-xs font-medium transition-colors',
                    selectedFormat === fmt
                      ? 'bg-brand text-white shadow-sm'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700/50',
                  )}
                >
                  <Icon size={14} />
                  <span className="hidden sm:inline">{FORMAT_LABELS[fmt]}</span>
                  {loadingFormats ? null : info && !info.available ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" title="Python 依赖未安装" />
                  ) : null}
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Main Form */}
      <Card className="border-neutral-800 bg-neutral-900/60">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            {FORMAT_ICONS[selectedFormat] &&
              (() => {
                const Icon = FORMAT_ICONS[selectedFormat]
                return <Icon size={18} className="text-brand" />
              })()}
            {FORMAT_LABELS[selectedFormat]}
            {currentFormat && !currentFormat.available && (
              <span className="text-xs text-red-400 font-normal ml-2">
                (Python 依赖未安装 — 无法生成)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Topic Input */}
          <div className="space-y-1.5">
            <Label className="text-sm text-neutral-300">
              <Sparkles size={12} className="inline mr-1 text-brand" />
              主题 (AI 自动生成内容)
            </Label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={FORMAT_PLACEHOLDERS[selectedFormat]}
              className="w-full px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-100 text-sm
                         placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand/50"
              maxLength={500}
            />
            <p className="text-[11px] text-neutral-500">
              输入主题后点击"生成"，AI 将自动生成结构化内容。
              如需精确控制内容，在下方填写手动内容。
            </p>
          </div>

          {/* Manual Content */}
          <div className="space-y-1.5">
            <Label className="text-sm text-neutral-300">
              手动内容 (JSON 格式或纯文本，覆盖 AI 生成)
            </Label>
            <textarea
              ref={textareaRef}
              value={manualContent}
              onChange={(e) => setManualContent(e.target.value)}
              placeholder={
                selectedFormat === 'pptx'
                  ? 'JSON 格式: {"slides":[{"title":"第一页","content":"要点1\\n要点2"}]}'
                  : selectedFormat === 'docx'
                    ? 'JSON 格式: {"sections":[{"heading":"第一章","content":"..."}]}'
                    : selectedFormat === 'pdf'
                      ? '粘贴 HTML 内容或 JSON: {"html":"<h1>Title</h1><p>..."}'
                      : 'JSON 格式: {"sheets":[{"name":"Sheet1","headers":["A","B"],"rows":[["1","2"]]}]}'
              }
              rows={6}
              className="w-full px-3 py-2 rounded-md bg-neutral-800 border border-neutral-700 text-neutral-100 text-sm font-mono
                         placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand/50 resize-y"
            />
            <p className="text-[11px] text-neutral-500">
              可选。留空则由 AI 根据主题自动生成。支持直接粘贴 JSON 结构内容。
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-400">
              <div className="font-medium mb-0.5">生成失败</div>
              <div className="text-xs">{error}</div>
            </div>
          )}

          {/* Generate Button */}
          <Button
            onClick={handleGenerate}
            disabled={generating || (!topic.trim() && !manualContent.trim())}
            className="w-full"
            leftIcon={generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          >
            {generating
              ? 'AI 正在生成文档...'
              : '生成文档'}
          </Button>

          {/* Result */}
          {result && (
            <div className="rounded-md bg-green-500/10 border border-green-500/30 px-3 py-3 space-y-2">
              <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center text-xs">✓</div>
                文档已生成
              </div>
              <div className="text-xs text-neutral-300 space-y-1 ml-7">
                <div>
                  文件: <code className="text-neutral-400">{result.file_name}</code>
                </div>
                <div>大小: {formatSize(result.size)}</div>
              </div>
              <div className="ml-7">
                <Button
                  size="sm"
                  onClick={() => handleDownload(result.file_name)}
                  disabled={downloadBusy === result.file_name}
                  leftIcon={downloadBusy === result.file_name ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                >
                  下载
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card className="border-neutral-800 bg-neutral-900/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw size={14} className="text-neutral-400" />
            生成历史
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 text-center">暂无生成记录</p>
          ) : (
            <div className="space-y-1">
              {history.map((item) => {
                const Icon = FORMAT_ICONS[item.format as DocFormat] || File
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-2 py-2 rounded hover:bg-neutral-800/50 transition-colors text-xs group"
                  >
                    <Icon size={14} className="text-neutral-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-neutral-200 truncate">
                        {item.topic || item.file_name}
                      </div>
                      <div className="text-neutral-500 flex gap-3">
                        <span>{FORMAT_LABELS[item.format as DocFormat] || item.format}</span>
                        <span>{formatSize(item.size)}</span>
                        <span>{formatTime(item.created_at)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => handleDownload(item.file_name)}
                      disabled={downloadBusy === item.file_name}
                      aria-label="下载"
                    >
                      {downloadBusy === item.file_name ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-400"
                      onClick={() => removeFromHistory(item.id)}
                      aria-label="删除记录"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
