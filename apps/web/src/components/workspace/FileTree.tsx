// apps/web/src/components/workspace/FileTree.tsx · v0.3 spec §33.6
import { cn } from '@/lib/utils'
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react'
import { useState } from 'react'

export interface FileNode {
  name: string
  type: 'folder' | 'file'
  size?: string
  children?: FileNode[]
}

export interface FileTreeProps {
  root: FileNode
  onSelect?: (node: FileNode) => void
}

export function FileTree({ root, onSelect }: FileTreeProps) {
  return (
    <ul className="text-sm">
      <TreeNode node={root} depth={0} onSelect={onSelect} defaultOpen />
    </ul>
  )
}

function TreeNode({
  node,
  depth,
  onSelect,
  defaultOpen = false,
}: {
  node: FileNode
  depth: number
  onSelect?: (n: FileNode) => void
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const isFolder = node.type === 'folder'
  const Icon = isFolder ? Folder : FileText
  const iconColor = isFolder ? 'text-semantic-info' : 'text-neutral-400'

  return (
    <li>
      <div
        className={cn(
          'flex items-center gap-1.5 py-0.5 px-1 rounded cursor-pointer hover:bg-neutral-800',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          if (isFolder) setOpen(!open)
          else onSelect?.(node)
        }}
      >
        {isFolder ? (
          open ? <ChevronDown size={12} className="text-neutral-400" /> : <ChevronRight size={12} className="text-neutral-400" />
        ) : (
          <span className="w-3" />
        )}
        <Icon size={14} className={iconColor} />
        <span className="text-neutral-200 truncate">{node.name}</span>
        {node.size && <span className="ml-auto text-xs text-neutral-400">{node.size}</span>}
      </div>
      {isFolder && open && node.children && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.name} node={c} depth={depth + 1} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  )
}
