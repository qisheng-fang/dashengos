import { createFileRoute } from '@tanstack/react-router'
import { TeamDashboard } from '../screens/TeamDashboard'

export const Route = createFileRoute('/_workspace/team')({
  component: TeamDashboard,
})
