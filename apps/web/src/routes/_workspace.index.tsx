// apps/web/src/routes/_workspace.index.tsx
// 自动跳转到最近会话，无会话则新建

import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { http } from '@/lib/api'
import { Loader2 } from 'lucide-react'

export const Route = createFileRoute('/_workspace/')({
  component: IndexPage,
})

function IndexPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      try {
        // 拉取最近会话
        const res: any = await http.get('/api/v1/sessions?limit=5')
        const sessions = (res.data as any)?.sessions || []
        const recentIds = sessions
          .filter((s: any) => s.title || s.id)
          .map((s: any) => s.id)

        if (recentIds.length > 0) {
          // 尝试从 localStorage 找有历史记录的会话
          for (const id of recentIds) {
            const raw = localStorage.getItem(`dasheng_chat_history_${id}`)
            if (raw) {
              try {
                const msgs = JSON.parse(raw)
                if (msgs.length > 0) {
                  navigate({ to: '/chats/' + id, replace: true })
                  return
                }
              } catch {}
            }
          }
          // 没有本地历史，跳转到第一个会话
          navigate({ to: '/chats/' + recentIds[0], replace: true })
          return
        }
      } catch {
        // API 失败，使用 localStorage 的 key 列表
        try {
          const keys: string[] = []
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k?.startsWith('dasheng_chat_history_')) keys.push(k)
          }
          if (keys.length > 0) {
            const id = keys[0].replace('dasheng_chat_history_', '')
            navigate({ to: '/chats/' + id, replace: true })
            return
          }
        } catch {}
      }

      // 完全没有历史，跳转到新会话
      const newId = 'chat_' + Date.now().toString(36)
      navigate({ to: '/chats/' + newId, replace: true })
    }
    init()
  }, [navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-brand" />
      </div>
    )
  }
  return null
}
