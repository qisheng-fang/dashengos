import { createFileRoute } from '@tanstack/react-router'
import { Automations } from '../screens/Automations'

export const Route = createFileRoute('/_workspace/automations')({
  component: Automations,
})
