// apps/web/src/screens/FileBrowser.tsx · v0.3 Phase 4 (sandbox-integrated)
//
// Real sandbox integration via sandbox-client. Replaces MOCK_TREE
// with a fetch to subagent.file_op { op: 'list' }.

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Folder, FileText, Upload, FolderPlus, ChevronRight, RefreshCw } from 'lucide-react'
import { sandboxClient } from '@/lib/sandbox-client'

interface FsEntry {
  name: string
  path: string
  type: 'folder' | 'file'
  size: number
}

const ALLOWED_ROOTS = ['/tmp/dasheng', '/Users']

export function FileBrowser() {
  const [currentPath, setCurrentPath] = useState('/tmp/dasheng')
  const [entries, setEntries] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sandboxAvailable, setSandboxAvailable] = useState<boolean | null>(null)

  // Health check on mount
  useEffect(() => {
    if (!sandboxClient) {
      setSandboxAvailable(false)
      return
    }
    sandboxClient
      .health()
      .then(() => setSandboxAvailable(true))
      .catch(() => setSandboxAvailable(false))
  }, [])

  // List directory
  useEffect(() => {
    if (!sandboxClient || !sandboxAvailable) return
    let cancelled = false
    setLoading(true)
    setError(null)
    sandboxClient
      .fileList(currentPath)
      .then((res) => {
        if (cancelled) return
        const list = (res.files || []).map((p) => {
          const name = p.split('/').pop() || p
          return {
            name,
            path: p,
            type: p.endsWith('/') ? 'folder' : 'file',
            size: 0,
          } as FsEntry
        })
        setEntries(list)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        // 沙箱不可达时静默 fallback
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentPath, sandboxAvailable])

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">📁 文件浏览器</h1>
          <p className="text-sm text-neutral-400 mt-1">
            沙箱路径: <code className="text-brand">{currentPath}</code>
            {sandboxAvailable === false && (
              <span className="ml-3 text-semantic-warning">
                ⚠ 沙箱不可达 (VITE_SANDBOX_URL=
                {import.meta.env?.VITE_SANDBOX_URL || 'http://127.0.0.1:9100'})
              </span>
            )}
            {sandboxAvailable === true && (
              <span className="ml-3 text-semantic-success">✓ 沙箱已连接</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (sandboxClient && sandboxAvailable) {
                setLoading(true)
                sandboxClient
                  .fileList(currentPath)
                  .then((res) => {
                    setEntries(
                      (res.files || []).map((p) => ({
                        name: p.split('/').pop() || p,
                        path: p,
                        type: p.endsWith('/') ? 'folder' : 'file',
                        size: 0,
                      })),
                    )
                    setLoading(false)
                  })
                  .catch((e) => setError(String(e)))
              }
            }}
            leftIcon={<RefreshCw size={14} />}
          >
            刷新
          </Button>
          <Button leftIcon={<Upload size={16} />}>上传</Button>
          <Button variant="outline" leftIcon={<FolderPlus size={16} />}>
            新建文件夹
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-[260px_1fr] gap-4">
        <Card className="bg-neutral-900/50 border-neutral-800 p-2 h-[600px] overflow-auto">
          <div className="text-xs text-neutral-400 px-2 py-1 font-mono">允许根</div>
          <ul className="space-y-0.5">
            {ALLOWED_ROOTS.map((root) => (
              <li
                key={root}
                onClick={() => setCurrentPath(root)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm cursor-pointer transition-colors ${
                  currentPath === root
                    ? 'bg-brand/10 text-brand font-medium'
                    : 'text-neutral-200 hover:bg-neutral-800'
                }`}
              >
                <Folder size={14} className="text-semantic-info" />
                {root}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="bg-neutral-900/50 border-neutral-800 p-4 h-[600px] overflow-auto">
          {loading ? (
            <div className="text-neutral-400 text-sm">加载中...</div>
          ) : error ? (
            <div className="text-semantic-danger text-sm">⚠ {error}</div>
          ) : entries.length === 0 ? (
            <div className="text-neutral-400 text-sm">
              {sandboxAvailable ? '目录为空' : '等待沙箱连接...'}
            </div>
          ) : (
            <ul className="space-y-1">
              {entries.map((e) => (
                <li
                  key={e.path}
                  className="flex items-center gap-2 px-3 py-2 rounded text-sm text-neutral-200 hover:bg-neutral-800 cursor-pointer transition-colors"
                  onClick={() => {
                    if (e.type === 'folder') setCurrentPath(e.path)
                  }}
                >
                  {e.type === 'folder' ? (
                    <Folder size={14} className="text-semantic-info" />
                  ) : (
                    <FileText size={14} className="text-neutral-400" />
                  )}
                  {e.name}
                  {e.type === 'folder' && (
                    <ChevronRight size={12} className="ml-auto text-neutral-400" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
