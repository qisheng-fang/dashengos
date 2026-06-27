import { createFileRoute } from '@tanstack/react-router'
import { Workspace } from '../screens/Workspace'

export const Route = createFileRoute('/_workspace/automations/templates')({
  component: Workspace,
})
