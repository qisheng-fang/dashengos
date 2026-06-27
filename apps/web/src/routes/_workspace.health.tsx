import { createFileRoute } from '@tanstack/react-router'
import { HealthDashboard } from '../screens/HealthDashboard'

export const Route = createFileRoute('/_workspace/health')({
  component: HealthDashboard,
})
