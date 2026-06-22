// apps/web/src/routes/_workspace.open-design.tsx
// Open Design 路由 — iframe 嵌入开源 Open Design 项目

import { createFileRoute } from '@tanstack/react-router'
import { OpenDesign } from '@/screens/OpenDesign'

export const Route = createFileRoute('/_workspace/open-design')({
  component: OpenDesign,
})
