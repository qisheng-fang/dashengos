import { createFileRoute } from '@tanstack/react-router'
import { Visualizations } from '../screens/Visualizations'

export const Route = createFileRoute('/_workspace/visualizations')({
  component: Visualizations,
})
