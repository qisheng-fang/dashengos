import { createFileRoute } from '@tanstack/react-router'
import { AgentTARS } from '../screens/AgentTARS'

export const Route = createFileRoute('/_workspace/agent-tars')({
  component: AgentTARS,
})
