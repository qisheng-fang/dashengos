// packages/backend/src/core/mcp-client.ts · DaShengOS MCP Client
// 2026-06-21 · MCP JSON-RPC 2.0 over stdio — 完整的服务器生命周期管理
// 无需 @modelcontextprotocol/sdk，直接实现 MCP 协议

import { spawn, ChildProcess } from 'node:child_process'
import { sqlite } from '../storage/db.js'

// ─── Types ─────────────────────────────────────────────────

export interface MCPServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface MCPTool {
  id: string
  server_id: string
  name: string
  description: string
  inputSchema: Record<string, any>
  riskLevel: 'READ' | 'WRITE' | 'NETWORK' | 'EXEC'
}

interface JSONRPCRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, any>
}

interface JSONRPCResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: any
  error?: { code: number; message: string; data?: any }
}

// ─── Active server pool ────────────────────────────────────

const activeServers = new Map<string, {
  process: ChildProcess
  config: MCPServerConfig
  tools: MCPTool[]
  client: MCPStdioClient | null  // reusable client for tool calls
}>()

// ─── MCP Protocol Client ───────────────────────────────────

class MCPStdioClient {
  private proc: ChildProcess
  private buffer = ''
  private pending = new Map<string | number, {
    resolve: (value: any) => void
    reject: (reason: any) => void
  }>()
  private msgId = 0

  constructor(command: string, args: string[], env?: Record<string, string>) {
    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })

    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.processBuffer()
    })

    this.proc.stderr!.on('data', (chunk: Buffer) => {
      console.error(`[MCP:${command}] stderr:`, chunk.toString().slice(0, 200))
    })
  }

  private processBuffer() {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as JSONRPCResponse
        const pending = this.pending.get(msg.id)
        if (pending) {
          this.pending.delete(msg.id)
          if (msg.error) pending.reject(new Error(msg.error.message))
          else pending.resolve(msg.result)
        }
      } catch { /* skip non-JSON lines */ }
    }
  }

  async request(method: string, params?: Record<string, any>, timeoutMs = 15000): Promise<any> {
    const id = ++this.msgId
    const req: JSONRPCRequest = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timeout: ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val) },
        reject: (err) => { clearTimeout(timer); reject(err) },
      })

      this.proc.stdin!.write(JSON.stringify(req) + '\n')
    })
  }

  async initialize(): Promise<{ protocolVersion: string; serverInfo: any; capabilities: any }> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'DaShengOS', version: '0.3.1' },
    })
    // Send initialized notification (MCP spec requires this)
    this.proc.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n')
    return result
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, any> }>> {
    const result = await this.request('tools/list')
    return result?.tools || []
  }

  async callTool(name: string, args: Record<string, any>): Promise<any> {
    const result = await this.request('tools/call', { name, arguments: args }, 60000)
    return result
  }

  async shutdown(): Promise<void> {
    try { await this.request('shutdown', {}, 5000) } catch { /* ok */ }
    this.proc.kill('SIGTERM')
    setTimeout(() => { if (!this.proc.killed) this.proc.kill('SIGKILL') }, 3000)
  }
}

// ─── Server lifecycle ──────────────────────────────────────

export async function startMCPServer(config: MCPServerConfig): Promise<{
  success: boolean
  tools: MCPTool[]
  error?: string
}> {
  // Already running?
  if (activeServers.has(config.id)) {
    return { success: true, tools: activeServers.get(config.id)!.tools }
  }

  let client: MCPStdioClient
  try {
    client = new MCPStdioClient(config.command, config.args, config.env)
    const initResult = await client.initialize()
    console.log(`[MCP] ${config.name} connected — protocol ${initResult.protocolVersion}`)

    const tools = await client.listTools()
    console.log(`[MCP] ${config.name} offers ${tools.length} tools`)

    const mcpTools: MCPTool[] = tools.map(t => ({
      id: `mcp_${config.id}_${t.name}`,
      server_id: config.id,
      name: t.name,
      description: t.description || `${t.name} from ${config.name}`,
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
      riskLevel: 'READ' as const,
    }))

    // Register tools in DB
    for (const tool of mcpTools) {
      try {
        sqlite.prepare(
          `INSERT OR REPLACE INTO mcp_tools (id, server_id, name, description, input_schema_json, risk_level, enabled)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        ).run(tool.id, tool.server_id, tool.name, tool.description, JSON.stringify(tool.inputSchema), tool.riskLevel)
      } catch (e: any) {
        console.error(`[MCP] Failed to register tool ${tool.name}:`, e.message)
      }
    }

    // Update server status
    sqlite.prepare(
      `UPDATE mcp_servers SET status = 'STARTED', last_health_check = ? WHERE id = ?`
    ).run(Date.now(), config.id)

    activeServers.set(config.id, { process: client['proc'], config, tools: mcpTools, client })
    return { success: true, tools: mcpTools }
  } catch (e: any) {
    console.error(`[MCP] Failed to start ${config.name}:`, e.message)
    sqlite.prepare(
      `UPDATE mcp_servers SET status = 'ERRORED', last_health_check = ? WHERE id = ?`
    ).run(Date.now(), config.id)
    return { success: false, tools: [], error: e.message }
  }
}

export async function stopMCPServer(serverId: string): Promise<boolean> {
  const active = activeServers.get(serverId)
  if (!active) {
    // Try to find by DB record
    sqlite.prepare(
      `UPDATE mcp_servers SET status = 'STOPPED' WHERE id = ?`
    ).run(serverId)
    return true
  }

  try {
    const client = new MCPStdioClient(active.config.command, active.config.args, active.config.env)
    await client.shutdown()
  } catch { /* process may already be dead */ }

  activeServers.delete(serverId)
  sqlite.prepare(
    `UPDATE mcp_servers SET status = 'STOPPED' WHERE id = ?`
  ).run(serverId)
  sqlite.prepare(`DELETE FROM mcp_tools WHERE server_id = ?`).run(serverId)

  return true
}

// ─── Load all registered servers on startup ─────────────────

export async function loadMCPServersOnStartup(): Promise<number> {
  try {
    const servers = sqlite.prepare(
      `SELECT id, name, command, args_json, env_json FROM mcp_servers WHERE status != 'STOPPED'`
    ).all() as Array<{ id: string; name: string; command: string; args_json: string; env_json: string | null }>

    let loaded = 0
    for (const srv of servers) {
      try {
        const config: MCPServerConfig = {
          id: srv.id,
          name: srv.name,
          command: srv.command,
          args: JSON.parse(srv.args_json),
          env: srv.env_json ? JSON.parse(srv.env_json) : undefined,
        }
        const result = await startMCPServer(config)
        if (result.success) loaded++
      } catch (e: any) {
        console.error(`[MCP] Startup load failed for ${srv.name}:`, e.message)
      }
    }

    console.log(`[MCP] Loaded ${loaded}/${servers.length} servers on startup`)
    return loaded
  } catch (e: any) {
    console.error('[MCP] Startup load error:', e.message)
    return 0
  }
}

// ─── MCP tool list for LLM ──────────────────────────────────

export function getMCPToolsForLLM(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, any> }
}> {
  try {
    const tools = sqlite.prepare(
      `SELECT id, name, description, input_schema_json FROM mcp_tools WHERE enabled = 1`
    ).all() as Array<{ id: string; name: string; description: string; input_schema_json: string }>

    return tools.map(t => {
      let schema: Record<string, any>
      try { schema = JSON.parse(t.input_schema_json) }
      catch { schema = { type: 'object', properties: {} } }

      return {
        type: 'function' as const,
        function: {
          name: `mcp__${t.name}`,
          description: `[MCP] ${t.description}`,
          parameters: { ...schema, type: "object" as const },
        },
      }
    })
  } catch {
    return []
  }
}

// ─── MCP tool execution ─────────────────────────────────────

export async function executeMCPTool(
  toolName: string,
  args: Record<string, any>,
): Promise<{ success: boolean; data?: string; error?: string }> {
  // Strip mcp__ prefix for DB lookup and MCP call
  const dbName = toolName.startsWith('mcp__') ? toolName.slice(5) : toolName;
  
  // Find which MCP server owns this tool
  const mcpTools = sqlite.prepare(
    `SELECT id, server_id, name FROM mcp_tools WHERE name = ? AND enabled = 1`
  ).all(dbName) as Array<{ id: string; server_id: string; name: string }>

  if (mcpTools.length === 0) {
    return { success: false, error: `MCP tool not found: ${toolName}` }
  }

  const tool = mcpTools[0]
  const active = activeServers.get(tool.server_id)

  if (!active) {
    return { success: false, error: `MCP server not running: ${tool.server_id}` }
  }

  try {
    // Reuse the existing client from the active server pool
    const client = active.client
    if (!client) {
      return { success: false, error: `MCP client not initialized for: ${tool.server_id}` }
    }
    const result = await client.callTool(dbName, args)
    return {
      success: true,
      data: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    }
  } catch (e: any) {
    return { success: false, error: `MCP execution failed: ${e.message}` }
  }
}

// ─── Check if tool is an MCP tool ───────────────────────────

export function isMCPTool(toolName: string): boolean {
  try {
    const dbName = toolName.startsWith('mcp__') ? toolName.slice(5) : toolName;
    const row = sqlite.prepare(
      `SELECT 1 FROM mcp_tools WHERE name = ? AND enabled = 1`
    ).get(dbName)
    return !!row
  } catch {
    return false
  }
}
