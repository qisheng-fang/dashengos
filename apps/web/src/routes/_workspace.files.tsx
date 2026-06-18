// apps/web/src/routes/_workspace.files.tsx · v0.3 spec §32.8 (文件浏览器)
import { createFileRoute } from '@tanstack/react-router'
import { FileBrowser } from '@/screens/FileBrowser'

export const Route = createFileRoute('/_workspace/files')({
  component: FileBrowser,
})
