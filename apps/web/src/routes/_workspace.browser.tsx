import { createFileRoute } from '@tanstack/react-router'
import { BrowserAutomation } from '../screens/BrowserAutomation'

export const Route = createFileRoute('/_workspace/browser')({
  component: BrowserAutomation,
})
