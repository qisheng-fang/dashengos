// apps/web/src/routes/_workspace.settings.models.custom.tsx · 自定义模型管理
import { createFileRoute } from '@tanstack/react-router'
import { CustomModelManager } from '@/screens/CustomModelManager'

export const Route = createFileRoute('/_workspace/settings/models/custom')({
  component: CustomModelManager,
})
