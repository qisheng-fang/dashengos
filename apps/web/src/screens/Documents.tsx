// DaShengOS v8.8 — 文档/文件管理面板
// 文件浏览器 · 最近文件 · 上传 · 知识库

import { useEffect, useState } from 'react'
import { http } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FolderOpen, FileText, Upload, RefreshCw, Loader2, Search, Clock, Download, Image, FileCode, File } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileEntry {
  name: string
  path: string
  size: number
  mtime: number
  isDir: boolean
}

const FILE_ICONS: Record<string, typeof FileText> = {
  '.ts': FileCode, '.tsx': FileCode, '.js': FileCode, '.jsx': FileCode,
  '.py': FileCode, '.go': FileCode, '.rs': FileCode,
  '.md': FileText, '.txt': FileText, '.json': FileCode, '.yaml': FileCode, '.yml': FileCode,
  '.html': FileCode, '.css': FileCode, '.svg': Image,
  '.png': Image, '.jpg': Image, '.jpeg': Image, '.gif': Image, '.webp': Image,
}

function getIcon(name: string) {
  const ext = name.substring(name.lastIndexOf('.'))
  return FILE_ICONS[ext] || File
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function Documents() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [currentPath, setCurrentPath] = useState('/Users/apple/Desktop/ai-workbench-v2')
  const [uploading, setUploading] = useState(false)

  const fetchFiles = async (dir?: string) => {
    setLoading(true)
    try {
      const res = await http.post<{ files: FileEntry[] }>('/api/v1/files/info', { path: dir || currentPath })
      const items = (res.files || []).sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return b.mtime - a.mtime
      })
      setFiles(items)
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchFiles() }, [])

  const filtered = files.filter(f =>
    !search || f.name.toLowerCase().includes(search.toLowerCase())
  )

  const navigateUp = () => {
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    setCurrentPath(parent)
    fetchFiles(parent)
  }

  const enterDir = (entry: FileEntry) => {
    if (!entry.isDir) return
    const newPath = currentPath + '/' + entry.name
    setCurrentPath(newPath)
    fetchFiles(newPath)
  }

  return (
    <div className="h-full overflow-auto p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-100 flex items-center gap-2">
            <FolderOpen size={22} /> 文档
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            {files.length} 个项目 · {currentPath}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              placeholder="搜索文件..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-3 py-1.5 text-sm bg-neutral-900 border border-neutral-800 rounded-md text-neutral-200 w-44 focus:outline-none focus:border-neutral-600"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchFiles()}>
            <RefreshCw size={13} className="mr-1" />刷新
          </Button>
        </div>
      </div>

      {/* 路径导航 */}
      <div className="flex items-center gap-1 mb-4 text-xs text-neutral-500 overflow-x-auto pb-2">
        {currentPath.split('/').filter(Boolean).map((seg, i, arr) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span>/</span>}
            <button
              onClick={() => {
                const p = '/' + arr.slice(0, i + 1).join('/')
                setCurrentPath(p); fetchFiles(p)
              }}
              className="hover:text-neutral-300 transition-colors"
            >
              {seg}
            </button>
          </span>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-neutral-500" />
        </div>
      ) : (
        <div className="space-y-1">
          {currentPath !== '/' && (
            <button onClick={navigateUp} className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-neutral-800/50 text-sm text-neutral-400 transition-colors">
              <FolderOpen size={14} /> ..
            </button>
          )}
          {filtered.map(f => {
            const Icon = f.isDir ? FolderOpen : getIcon(f.name)
            return (
              <button
                key={f.name}
                onClick={() => enterDir(f)}
                className="w-full flex items-center justify-between px-3 py-2 rounded hover:bg-neutral-800/50 text-sm transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon size={14} className={cn("shrink-0", f.isDir ? 'text-blue-400' : 'text-neutral-500')} />
                  <span className="text-neutral-200 truncate">{f.name}</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-500 shrink-0">
                  {!f.isDir && <span>{formatSize(f.size)}</span>}
                  <span className="flex items-center gap-1"><Clock size={10} />{formatTime(f.mtime)}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
