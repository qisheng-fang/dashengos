// apps/web/src/routes/_workspace.mcp.tsx · v0.3 spec §32.7 (MCP 服务器管理)
import { createFileRoute } from '@tanstack/react-router'
import { McpManager } from '@/screens/McpManager'

export const Route = createFileRoute('/_workspace/mcp')({
  component: McpManager,
})
