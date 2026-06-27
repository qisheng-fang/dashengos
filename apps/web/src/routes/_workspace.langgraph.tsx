import { createFileRoute } from '@tanstack/react-router'
import { LangGraph } from '../screens/LangGraph'

export const Route = createFileRoute('/_workspace/langgraph')({
  component: LangGraph,
})
