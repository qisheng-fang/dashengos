// apps/web/src/routes/_workspace.studio.tsx · Track C.2 (2026-06-15)
// Studio 路由 (跟 _workspace.agents/_workspace.files 同级)
// 旧 DaShengOS 也有 /studio, 用 React Flow 12 实现 ComfyUI 风格工作流编辑器

import { createFileRoute } from '@tanstack/react-router'
import { Studio } from '@/screens/Studio'

export const Route = createFileRoute('/_workspace/studio')({
  component: Studio,
})
