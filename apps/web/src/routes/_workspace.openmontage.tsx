// apps/web/src/routes/_workspace.openmontage.tsx
// OpenMontage 路由 — AI 驱动视频/设计工作台

import { createFileRoute } from '@tanstack/react-router'
import { OpenMontage } from '@/screens/OpenMontage'

export const Route = createFileRoute('/_workspace/openmontage')({
  component: OpenMontage,
})
