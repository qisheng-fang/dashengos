// apps/web/src/routes/_workspace.settings.tsx · v0.3 spec §32.9 (设置 5 子页)
import { createFileRoute } from '@tanstack/react-router'
import { Settings } from '@/screens/Settings'

export const Route = createFileRoute('/_workspace/settings')({
  component: Settings,
})
