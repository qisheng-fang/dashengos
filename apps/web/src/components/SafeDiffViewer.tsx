// SafeDiffViewer.tsx — 安全 Diff 查看器
// 只展示差异，不执行。突出显示文件路径和变更
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FileCode, Shield, AlertTriangle } from 'lucide-react'

interface SafeDiffViewerProps {
  path: string
  content: string
  reason?: string
  redacted?: boolean
  warnings?: string[]
}

export default function SafeDiffViewer({
  path, content, reason, redacted, warnings,
}: SafeDiffViewerProps) {
  const lines = content.split('\n')
  const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
  const removedLines = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length

  return (
    <Card className="p-3 border-neutral-700/50 bg-neutral-900/50 mb-2">
      <div className="flex items-center gap-2 mb-2">
        <FileCode className="w-4 h-4 text-blue-400 shrink-0" />
        <span className="text-sm font-mono text-neutral-200 truncate">{path}</span>
        <div className="flex items-center gap-1 ml-auto">
          {addedLines > 0 && (
            <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              +{addedLines}
            </Badge>
          )}
          {removedLines > 0 && (
            <Badge className="text-[10px] bg-red-500/20 text-red-400 border-red-500/30">
              -{removedLines}
            </Badge>
          )}
          {redacted && (
            <Badge className="text-[10px] bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
              <Shield className="w-3 h-3 mr-0.5" />
              脱敏
            </Badge>
          )}
        </div>
      </div>

      {reason && (
        <p className="text-xs text-neutral-400 mb-1">{reason}</p>
      )}

      {warnings && warnings.length > 0 && (
        <div className="mb-2 bg-amber-950/30 border border-amber-500/20 rounded p-2">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      )}

      <pre className="text-xs font-mono text-neutral-300 bg-neutral-950 rounded p-2 overflow-x-auto max-h-[200px] overflow-y-auto">
        {content.length > 2000
          ? content.slice(0, 2000) + '\n... (truncated)'
          : content}
      </pre>
    </Card>
  )
}
