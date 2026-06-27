// DaShengOS FileBrowser — 直接用 REST API，不依赖沙箱
// GET /api/v1/files?path=...  → 列目录
// POST /api/v1/files/read     → 读文件

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Folder, FileText, Upload, FolderPlus, ChevronRight, RefreshCw, ChevronLeft, Home } from 'lucide-react'
import { useAuthStore } from '@/lib/auth-store'

interface FsEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  mtime?: number
}

const ALLOWED_ROOTS = ['/Users/apple', '/Users/apple/Desktop', '/Users/apple/Desktop/ai-workbench-v2', '/tmp']

export function FileBrowser() {
  const [currentPath, setCurrentPath] = useState('/Users/apple/Desktop/ai-workbench-v2')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const getToken = () => {
    try {
      const raw = localStorage.getItem('dasheng-auth')
      return raw ? JSON.parse(raw)?.state?.accessToken || '' : ''
    } catch { return '' }
  }

  const listDir = async (path: string) => {
    setLoading(true)
    setError(null)
    setFileContent(null)
    setSelectedFile(null)
    try {
      const token = getToken()
      const res = await fetch(`/api/v1/files?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.message || `HTTP ${res.status}`)
      }
      const data = await res.json()
      // Sort: folders first, then files
      const sorted = (data.files || []).sort((a: FsEntry, b: FsEntry) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setEntries(sorted)
    } catch (e: any) {
      setError(e.message || '读取目录失败')
      setEntries([])
    }
    setLoading(false)
  }

  const readFile = async (filePath: string) => {
    setLoading(true)
    setError(null)
    try {
      const token = getToken()
      const res = await fetch('/api/v1/files/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ path: filePath, maxBytes: 200 * 1024 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFileContent(data.truncated ? data.content + '\n\n... (文件已截断)' : data.content)
      setSelectedFile(filePath)
    } catch (e: any) {
      setError(e.message || '读取文件失败')
    }
    setLoading(false)
  }

  useEffect(() => { listDir(currentPath) }, [currentPath])

  const goUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    if (ALLOWED_ROOTS.some(r => parent.startsWith(r))) {
      setCurrentPath(parent)
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="p-6 max-w-7xl mx-auto h-full flex flex-col">
      <header className="mb-4 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">📁 文件浏览器</h1>
          <div className="flex items-center gap-1 mt-1 text-xs text-neutral-400 font-mono">
            <button onClick={goUp} className="hover:text-neutral-200 p-0.5" title="上级目录">
              <ChevronLeft size={14} />
            </button>
            <span className="text-neutral-500">{currentPath}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => listDir(currentPath)} leftIcon={<RefreshCw size={14} />}>
            刷新
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-[240px_1fr] gap-4 flex-1 min-h-0">
        {/* 左侧：根目录快捷 */}
        <Card className="bg-neutral-900/50 border-neutral-800 p-2 overflow-auto">
          <div className="text-xs text-neutral-500 px-2 py-1 font-mono">快捷目录</div>
          <ul className="space-y-0.5">
            {ALLOWED_ROOTS.map((root) => (
              <li
                key={root}
                onClick={() => setCurrentPath(root)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
                  currentPath === root
                    ? 'bg-purple-500/10 text-purple-400 font-medium'
                    : 'text-neutral-300 hover:bg-neutral-800'
                }`}
              >
                <Home size={13} />
                {root === '/Users/apple' ? '~' : root.split('/').pop()}
              </li>
            ))}
          </ul>
        </Card>

        {/* 右侧：文件列表 + 预览 */}
        <div className="grid grid-rows-[1fr_auto] gap-2 min-h-0">
          {/* 文件列表 */}
          <Card className="bg-neutral-900/50 border-neutral-800 p-2 overflow-auto min-h-0">
            {loading && entries.length === 0 ? (
              <div className="text-neutral-400 text-sm p-4">加载中...</div>
            ) : error ? (
              <div className="text-red-400 text-sm p-4">⚠ {error}</div>
            ) : entries.length === 0 ? (
              <div className="text-neutral-500 text-sm p-4">目录为空</div>
            ) : (
              <ul className="space-y-0.5">
                {entries.map((e) => (
                  <li
                    key={e.path}
                    className="flex items-center gap-2 px-3 py-1.5 rounded text-sm text-neutral-200 hover:bg-neutral-800 cursor-pointer transition-colors"
                    onClick={() => {
                      if (e.isDir) setCurrentPath(e.path)
                      else readFile(e.path)
                    }}
                  >
                    {e.isDir ? (
                      <Folder size={14} className="text-cyan-400" />
                    ) : (
                      <FileText size={14} className="text-neutral-500" />
                    )}
                    <span className="flex-1 truncate">{e.name}</span>
                    {!e.isDir && (
                      <span className="text-neutral-600 text-xs flex-shrink-0">{formatSize(e.size)}</span>
                    )}
                    {e.isDir && (
                      <ChevronRight size={12} className="text-neutral-600 flex-shrink-0" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* 文件预览 */}
          {fileContent !== null && (
            <Card className="bg-neutral-950 border-neutral-800 p-3 max-h-[300px] overflow-auto">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-neutral-400 font-mono">{selectedFile}</span>
                <button onClick={() => { setFileContent(null); setSelectedFile(null) }}
                  className="text-neutral-500 hover:text-neutral-300 text-xs">✕ 关闭</button>
              </div>
              <pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap">{fileContent}</pre>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
