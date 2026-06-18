// apps/web/src/routes/_workspace.agents.tsx · v0.3 spec §32.5 (Agent 市场)
import { createFileRoute } from '@tanstack/react-router'
import { AgentMarket } from '@/screens/AgentMarket'

export const Route = createFileRoute('/_workspace/agents')({
  component: AgentMarket,
})
