// packages/backend/src/core/mcp-server-host.ts · DaShengOS v8.0
// MCP Server Host — JSON-RPC 2.0 over HTTP at POST /mcp/jsonrpc

import type { FastifyInstance } from 'fastify'
import { getToolsForLLM, executeTool, type ToolCall, type ExecutionContext } from './tools/registry.js'

// Types
interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

interface MCPToolSchema {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string; enum?: string[] }>
    required: string[]
  }
}

const SERVER_INFO = { name: 'DaShengOS', version: '8.0.0', protocolVersion: '2025-03-15' }
const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
  prompts: { listChanged: false },
  logging: {},
}

function dashengToolToMCP(t: ReturnType<typeof getToolsForLLM>[number]): MCPToolSchema | null {
  if (!t?.function) return null
  const fn = t.function
  return {
    name: fn.name,
    description: fn.description || '',
    inputSchema: {
      type: 'object',
      properties: fn.parameters?.properties
        ? Object.fromEntries(
            Object.entries(fn.parameters.properties).map(([k, v]: [string, any]) => [
              k, { type: v.type || 'string', description: v.description || '' },
            ])
          )
        : {},
      required: fn.parameters?.required || [],
    },
  }
}

function dashengToolToMCPResult(toolResult: Awaited<ReturnType<typeof executeTool>>) {
  const text = toolResult.success
    ? toolResult.data || JSON.stringify(toolResult)
    : toolResult.error || 'Unknown error'
  return { content: [{ type: 'text', text }], isError: !toolResult.success }
}

function getServerResources() {
  return [
    { uri: 'dasheng://system/health', name: 'System Health', description: 'Live system health and component status', mimeType: 'application/json' },
    { uri: 'dasheng://system/sessions', name: 'Active Sessions', description: 'List of active AI sessions', mimeType: 'application/json' },
    { uri: 'dasheng://skills/marketplace', name: 'Skill Marketplace', description: 'Available installable skills', mimeType: 'application/json' },
    { uri: 'dasheng://memory/ledger', name: 'Memory Ledger', description: 'Persistent cross-session memory entries', mimeType: 'application/json' },
  ]
}

function getResourceTemplates() {
  return [
    { uriTemplate: 'dasheng://sessions/{sessionId}', name: 'Session Detail', description: 'Full conversation and context for a session', mimeType: 'application/json' },
    { uriTemplate: 'dasheng://memory/search?q={query}', name: 'Memory Search', description: 'Semantic search across memory ledger', mimeType: 'application/json' },
  ]
}

function getServerPrompts() {
  return [
    { name: 'dasheng-analyze', description: 'Analyze a codebase, task, or problem with DaShengOS agent tools', arguments: [{ name: 'task', description: 'The task or question to analyze', required: true }, { name: 'context', description: 'Additional context' }] },
    { name: 'dasheng-execute', description: 'Execute a multi-step workflow with tool calls', arguments: [{ name: 'workflow', description: 'Workflow description or JSON spec', required: true }] },
  ]
}

async function readResource(uri: string) {
  if (uri === 'dasheng://system/health') {
    try { const r = await fetch('http://127.0.0.1:8000/api/status'); const d = await r.json(); return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(d, null, 2) }] } }
    catch { return { contents: [{ uri, mimeType: 'text/plain', text: '{"status":"unknown"}' }] } }
  }
  if (uri === 'dasheng://system/sessions') {
    try { const r = await fetch('http://127.0.0.1:8000/api/v1/sessions'); const d = await r.json(); return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(d, null, 2) }] } }
    catch { return { contents: [{ uri, mimeType: 'text/plain', text: '[]' }] } }
  }
  if (uri === 'dasheng://skills/marketplace') {
    try { const r = await fetch('http://127.0.0.1:8000/api/v1/skills/marketplace'); const d = await r.json(); return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(d, null, 2) }] } }
    catch { return { contents: [{ uri, mimeType: 'text/plain', text: '{"skills":[]}' }] } }
  }
  throw { code: -32602, message: 'Unknown resource: ' + uri }
}

async function handleJSONRPC(request: JSONRPCRequest, userId: string, sessionId?: string): Promise<JSONRPCResponse> {
  const { id, method, params } = request
  try {
    switch (method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: { protocolVersion: SERVER_INFO.protocolVersion, capabilities: SERVER_CAPABILITIES, serverInfo: SERVER_INFO } }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list': {
        const tools = getToolsForLLM()
        const mcpTools = tools.map(dashengToolToMCP).filter(Boolean)
        return { jsonrpc: '2.0', id, result: { tools: mcpTools } }
      }
      case 'tools/call': {
        const toolName = params?.name as string
        const toolArgs = (params?.arguments as Record<string, any>) || {}
        if (!toolName) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } }
        const ctx: ExecutionContext = { userId, sessionId, workspaceDir: '/Users/apple/Desktop/ai-workbench-v2', maxTimeout: 30000 }
        const result = await executeTool({ name: toolName, args: toolArgs }, ctx)
        return { jsonrpc: '2.0', id, result: dashengToolToMCPResult(result) }
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: getServerResources(), resourceTemplates: getResourceTemplates() } }
      case 'resources/read': {
        const uri = params?.uri as string
        if (!uri) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing uri' } }
        return { jsonrpc: '2.0', id, result: await readResource(uri) }
      }
      case 'resources/templates/list':
        return { jsonrpc: '2.0', id, result: { resourceTemplates: getResourceTemplates() } }
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: getServerPrompts() } }
      case 'prompts/get': {
        const promptName = params?.name as string
        const promptArgs = (params?.arguments as Record<string, string>) || {}
        const prompt = getServerPrompts().find(p => p.name === promptName)
        if (!prompt) return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown prompt: ' + promptName } }
        let mt = ''
        if (promptName === 'dasheng-analyze') mt = 'Please analyze: ' + (promptArgs.task || 'N/A') + (promptArgs.context ? '\nContext: ' + promptArgs.context : '')
        else if (promptName === 'dasheng-execute') mt = 'Execute workflow: ' + (promptArgs.workflow || 'N/A')
        return { jsonrpc: '2.0', id, result: { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: mt } }] } }
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return { jsonrpc: '2.0', id, result: {} }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } }
    }
  } catch (e: any) {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error: ' + e.message } }
  }
}

export async function mcpServerHostRoutes(app: FastifyInstance) {
  app.get('/mcp/health', async () => ({ status: 'ok', server: SERVER_INFO.name, version: SERVER_INFO.version }))
  app.post('/mcp/jsonrpc', async (request, reply) => {
    const body = request.body as JSONRPCRequest
    if (!body || body.jsonrpc !== '2.0') {
      return reply.status(400).send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: must be JSON-RPC 2.0' } } as JSONRPCResponse)
    }
    const userId = (request as any).userId || 'mcp-anonymous'
    const sessionId = (request as any).sessionId || undefined
    const response = await handleJSONRPC(body, userId, sessionId)
    if (body.id === undefined || body.id === null) return reply.status(204).send()
    return reply.send(response)
  })
  app.get('/mcp/sse', async (request, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
    reply.raw.write('data: ' + JSON.stringify({ endpoint: 'http://127.0.0.1:' + (process.env.BACKEND_PORT || '8000') + '/mcp/jsonrpc' }) + '\n\n')
    const ping = setInterval(() => { reply.raw.write(': ping ' + Date.now() + '\n\n') }, 15000)
    request.raw.on('close', () => clearInterval(ping))
  })
}

console.log('[MCPServerHost] MCP Server Host ready')
