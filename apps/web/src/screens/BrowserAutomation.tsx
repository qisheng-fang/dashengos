// apps/web/src/screens/BrowserAutomation.tsx · Playwright 浏览器自动化页面
// 接入后端 /api/v1/browser/* 端点 (navigate/screenshot/extract/fill-form/status)
// + /api/v1/browser/screenshot/base64 用于页面内预览

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Globe,
  Camera,
  FileText,
  ClipboardList,
  Activity,
  Loader2,
  ExternalLink,
  Eye,
} from 'lucide-react'
import { http } from '@/lib/api'

type Tab = 'navigate' | 'screenshot' | 'extract' | 'fill-form' | 'status'

interface BrowserStatus {
  available: boolean
  browser_type?: string
  headless?: boolean
  version?: string
}

export function BrowserAutomation() {
  const [activeTab, setActiveTab] = useState<Tab>('status')
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<BrowserStatus | null>(null)

  // navigate 结果
  const [navResult, setNavResult] = useState<{ html_length: number; text_length: number; title?: string; url: string } | null>(null)
  // screenshot 结果
  const [screenshotSrc, setScreenshotSrc] = useState<string | null>(null)
  // extract 结果
  const [extractedText, setExtractedText] = useState<string | null>(null)
  // fill-form 结果
  const [fillResult, setFillResult] = useState<{ url: string; submitted: boolean; status?: number } | null>(null)
  const [fillFields, setFillFields] = useState('{\n  "selector": "value"\n}')
  const [fillSelector, setFillSelector] = useState('')
  // extract selector
  const [extractSelector, setExtractSelector] = useState('')

  // 首次加载状态
  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    try {
      const s = await http.get<BrowserStatus>('/api/v1/browser/status')
      setStatus(s)
    } catch {
      setStatus({ available: false })
    }
  }

  async function handleNavigate() {
    if (!url) return
    setLoading(true)
    setError(null)
    setNavResult(null)
    try {
      const res = await http.post<{ html: string; text: string; title?: string; url: string }>('/api/v1/browser/navigate', {
        url,
        timeout: 30_000,
      })
      setNavResult({ html_length: res.html?.length ?? 0, text_length: res.text?.length ?? 0, title: res.title, url: res.url })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleScreenshot() {
    if (!url) return
    setLoading(true)
    setError(null)
    setScreenshotSrc(null)
    try {
      const res = await http.post<{ base64: string; mimeType: string; size: number }>('/api/v1/browser/screenshot/base64', {
        url,
        fullPage: true,
      })
      setScreenshotSrc(`data:${res.mimeType};base64,${res.base64}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleExtract() {
    if (!url) return
    setLoading(true)
    setError(null)
    setExtractedText(null)
    try {
      const body: Record<string, string> = { url }
      if (extractSelector) body.selector = extractSelector
      const res = await http.post<{ text: string; textLength: number; url: string }>('/api/v1/browser/extract', body)
      setExtractedText(res.text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  async function handleFillForm() {
    if (!url) return
    setLoading(true)
    setError(null)
    setFillResult(null)
    try {
      const fields = JSON.parse(fillFields)
      const res = await http.post<{ url: string; submitted: boolean; status?: number }>('/api/v1/browser/fill-form', {
        url,
        fields,
        submitSelector: fillSelector || undefined,
      })
      setFillResult(res)
    } catch (e) {
      if (e instanceof SyntaxError) {
        setError('JSON 格式错误，请检查字段输入')
      } else {
        setError((e as Error).message)
      }
    } finally {
      setLoading(false)
    }
  }

  const TABS: { id: Tab; label: string; icon: typeof Globe }[] = [
    { id: 'status', label: '状态', icon: Activity },
    { id: 'navigate', label: '导航', icon: Globe },
    { id: 'screenshot', label: '截图', icon: Camera },
    { id: 'extract', label: '提取', icon: FileText },
    { id: 'fill-form', label: '表单', icon: ClipboardList },
  ]

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)]" data-testid="browser-automation-page">
      <header className="px-6 py-3 border-b border-neutral-800 flex items-center gap-3">
        <Globe size={18} className="text-brand" />
        <h1 className="text-sm font-medium text-neutral-100">浏览器自动化</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded ${status?.available ? 'bg-semantic-success/10 text-semantic-success' : 'bg-semantic-danger/10 text-semantic-danger'}`}>
            {status?.available ? `Playwright 可用${status.browser_type ? ` (${status.browser_type})` : ''}` : 'Playwright 不可用'}
          </span>
        </div>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-neutral-800 px-6">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'text-brand border-brand'
                  : 'text-neutral-400 border-transparent hover:text-neutral-200'
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-3 p-2 rounded bg-semantic-danger/10 border border-semantic-danger/30 text-sm text-semantic-danger">
          ⚠ {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        {/* Status Tab */}
        {activeTab === 'status' && (
          <Card className="bg-neutral-900/50 border-neutral-800 p-4 max-w-2xl">
            <h2 className="text-sm font-medium text-neutral-200 mb-3 flex items-center gap-2">
              <Activity size={14} className="text-brand" />
              Playwright 状态
            </h2>
            <div className="space-y-2 text-xs">
              <StatusRow label="可用" value={status?.available ? '✅ 是' : '❌ 否'} />
              <StatusRow label="浏览器类型" value={status?.browser_type || '—'} />
              <StatusRow label="Headless" value={status?.headless !== undefined ? (status.headless ? '是' : '否') : '—'} />
              <StatusRow label="版本" value={status?.version || '—'} />
            </div>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadStatus}>
              <Loader2 size={12} className={loading ? 'animate-spin' : 'hidden'} />
              刷新状态
            </Button>
          </Card>
        )}

        {/* Navigate Tab */}
        {activeTab === 'navigate' && (
          <div className="max-w-3xl space-y-4">
            <UrlInput url={url} setUrl={setUrl} onSubmit={handleNavigate} loading={loading} label="导航" />
            {navResult && (
              <Card className="bg-neutral-900/50 border-neutral-800 p-4">
                <h3 className="text-xs text-neutral-400 mb-2">导航结果</h3>
                <div className="space-y-1 text-xs">
                  <StatusRow label="URL" value={navResult.url} />
                  <StatusRow label="页面标题" value={navResult.title || '—'} />
                  <StatusRow label="HTML 长度" value={navResult.html_length.toLocaleString() + ' chars'} />
                  <StatusRow label="文本长度" value={navResult.text_length.toLocaleString() + ' chars'} />
                </div>
                <a href={navResult.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand mt-2 hover:underline">
                  <ExternalLink size={10} /> 在浏览器中打开
                </a>
              </Card>
            )}
          </div>
        )}

        {/* Screenshot Tab */}
        {activeTab === 'screenshot' && (
          <div className="max-w-3xl space-y-4">
            <UrlInput url={url} setUrl={setUrl} onSubmit={handleScreenshot} loading={loading} label="截图" />
            {screenshotSrc && (
              <Card className="bg-neutral-900/50 border-neutral-800 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Eye size={12} className="text-brand" />
                  <span className="text-xs text-neutral-400">截图预览</span>
                </div>
                <img src={screenshotSrc} alt="Page screenshot" className="w-full rounded border border-neutral-700" />
              </Card>
            )}
          </div>
        )}

        {/* Extract Tab */}
        {activeTab === 'extract' && (
          <div className="max-w-3xl space-y-4">
            <UrlInput url={url} setUrl={setUrl} onSubmit={handleExtract} loading={loading} label="提取文本" />
            <div>
              <label className="text-xs text-neutral-400 block mb-1">CSS 选择器 (可选，留空提取全文)</label>
              <Input
                value={extractSelector}
                onChange={(e) => setExtractSelector(e.target.value)}
                placeholder="例如: article, .content, #main"
                className="bg-neutral-900 border-neutral-800 text-xs"
              />
            </div>
            {extractedText !== null && (
              <Card className="bg-neutral-900/50 border-neutral-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-400">提取结果 ({extractedText.length.toLocaleString()} 字符)</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs"
                    onClick={() => { navigator.clipboard.writeText(extractedText) }}
                  >
                    复制
                  </Button>
                </div>
                <pre className="text-xs text-neutral-300 whitespace-pre-wrap break-words max-h-96 overflow-auto bg-neutral-950 p-3 rounded">
                  {extractedText}
                </pre>
              </Card>
            )}
          </div>
        )}

        {/* Fill Form Tab */}
        {activeTab === 'fill-form' && (
          <div className="max-w-3xl space-y-4">
            <UrlInput url={url} setUrl={setUrl} onSubmit={handleFillForm} loading={loading} label="填充表单" />
            <div>
              <label className="text-xs text-neutral-400 block mb-1">表单字段 (JSON: CSS选择器 → 填充值)</label>
              <textarea
                value={fillFields}
                onChange={(e) => setFillFields(e.target.value)}
                rows={5}
                className="w-full bg-neutral-900 border border-neutral-800 rounded px-3 py-2 text-xs font-mono text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-brand"
                placeholder='{\n  "#username": "user@example.com",\n  "#password": "secret"\n}'
              />
            </div>
            <div>
              <label className="text-xs text-neutral-400 block mb-1">提交按钮选择器 (可选)</label>
              <Input
                value={fillSelector}
                onChange={(e) => setFillSelector(e.target.value)}
                placeholder="例如: button[type=submit], .login-btn"
                className="bg-neutral-900 border-neutral-800 text-xs"
              />
            </div>
            {fillResult && (
              <Card className="bg-neutral-900/50 border-neutral-800 p-4">
                <h3 className="text-xs text-neutral-400 mb-2">表单提交结果</h3>
                <div className="space-y-1 text-xs">
                  <StatusRow label="URL" value={fillResult.url} />
                  <StatusRow label="已提交" value={fillResult.submitted ? '✅ 是' : '❌ 否'} />
                  {fillResult.status && <StatusRow label="HTTP 状态" value={String(fillResult.status)} />}
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function UrlInput({ url, setUrl, onSubmit, loading, label }: {
  url: string
  setUrl: (v: string) => void
  onSubmit: () => void
  loading: boolean
  label: string
}) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit() }}
      className="flex items-center gap-2"
    >
      <Globe size={14} className="text-neutral-500 flex-shrink-0" />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://example.com"
        className="flex-1 bg-neutral-900 border-neutral-800"
        type="url"
      />
      <Button type="submit" size="sm" disabled={!url || loading}>
        {loading ? <Loader2 size={14} className="animate-spin" /> : label}
      </Button>
    </form>
  )
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-neutral-800/50">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200 font-mono">{value}</span>
    </div>
  )
}
