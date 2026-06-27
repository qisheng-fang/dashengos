// packages/backend/src/core/tool-gateway.ts · DaShengOS v8.4
// 统一工具注册中心 — 动态注册/发现/权限网关
// 对标 OpenClaw MCP 工具热插拔 + Hermes function calling
// 2026-06-28

import { EventEmitter } from 'node:events'
import { sqlite } from '../storage/db.js'

// Types
export type PermissionLevel = 'safe' | 'modify' | 'danger' | 'critical'

export interface ToolRegistration {
  name: string
  description: string
  category: string              // 'file', 'search', 'system', 'code', 'network', 'external'
  permissionLevel: PermissionLevel
  parameters: Record<string, ToolParamDef>
  returns: ToolReturnDef
  execute: (args: Record<string, any>) => Promise<ToolExecResult>
  schema?: Record<string, any>   // JSON Schema (auto-generated)
  metadata?: Record<string, any> // arbitrary metadata
}

export interface ToolParamDef {
  type: string
  description: string
  required: boolean
  default?: any
  enum?: string[]
}

export interface ToolReturnDef {
  type: string
  description: string
}

export interface ToolExecResult {
  success: boolean
  data?: any
  error?: string
  durationMs?: number
}

export interface PermissionRule {
  level: PermissionLevel
  requiresConfirmation: boolean
  requiresDoubleConfirm: boolean
  maxExecPerMinute: number
  allowedInBackground: boolean
  auditLog: boolean
}

// Permission matrix
const PERMISSION_MATRIX: Record<PermissionLevel, PermissionRule> = {
  safe:      { level: 'safe',      requiresConfirmation: false, requiresDoubleConfirm: false, maxExecPerMinute: 60,  allowedInBackground: true,  auditLog: false },
  modify:    { level: 'modify',    requiresConfirmation: true,  requiresDoubleConfirm: false, maxExecPerMinute: 30,  allowedInBackground: true,  auditLog: true },
  danger:    { level: 'danger',    requiresConfirmation: true,  requiresDoubleConfirm: true,  maxExecPerMinute: 10,  allowedInBackground: false, auditLog: true },
  critical:  { level: 'critical',  requiresConfirmation: true,  requiresDoubleConfirm: true,  maxExecPerMinute: 3,   allowedInBackground: false, auditLog: true },
}

// Tool registry
class ToolGateway extends EventEmitter {
  private tools = new Map<string, ToolRegistration>()
  private execCounts = new Map<string, { count: number; windowStart: number }>()
  private auditLog: Array<{ tool: string; args: any; result: string; timestamp: number; userId: string }> = []

  // Initialize tables
  initTables(): void {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS tool_registry (
        name TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        category TEXT NOT NULL,
        permission_level TEXT NOT NULL,
        parameters TEXT DEFAULT '{}',
        returns TEXT DEFAULT '{}',
        schema TEXT DEFAULT '{}',
        metadata TEXT DEFAULT '{}',
        registered_at INTEGER DEFAULT (unixepoch()),
        call_count INTEGER DEFAULT 0,
        last_called INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS tool_audit_log (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        args TEXT DEFAULT '{}',
        result TEXT DEFAULT '',
        success INTEGER DEFAULT 1,
        duration_ms INTEGER DEFAULT 0,
        timestamp INTEGER DEFAULT (unixepoch())
      );
    `)
  }

  // Register a tool dynamically
  register(tool: ToolRegistration): string {
    // Validate
    if (this.tools.has(tool.name)) {
      throw new Error('Tool already registered: ' + tool.name)
    }
    if (!tool.name || !tool.category || !tool.execute) {
      throw new Error('Tool must have name, category, and execute function')
    }

    // Auto-generate JSON Schema if not provided
    if (!tool.schema) {
      tool.schema = generateJSONSchema(tool)
    }

    this.tools.set(tool.name, tool)

    // Persist
    sqlite.prepare(`
      INSERT OR REPLACE INTO tool_registry (name, description, category, permission_level, parameters, returns, schema, metadata, registered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      tool.name, tool.description, tool.category, tool.permissionLevel,
      JSON.stringify(tool.parameters), JSON.stringify(tool.returns),
      JSON.stringify(tool.schema), JSON.stringify(tool.metadata || {})
    )

    this.emit('register', { name: tool.name, category: tool.category })
    console.log('[ToolGateway] Registered: ' + tool.name + ' (' + tool.category + ', ' + tool.permissionLevel + ')')
    return tool.name
  }

  // Unregister a tool
  unregister(name: string): boolean {
    const had = this.tools.delete(name)
    if (had) {
      sqlite.prepare('DELETE FROM tool_registry WHERE name = ?').run(name)
      this.emit('unregister', { name })
    }
    return had
  }

  // Check permission gate before execution
  checkPermission(name: string, autoConfirm: boolean): { allowed: boolean; reason?: string; needsConfirm: boolean; needsDoubleConfirm: boolean } {
    const tool = this.tools.get(name)
    if (!tool) return { allowed: false, reason: 'Tool not registered: ' + name, needsConfirm: false, needsDoubleConfirm: false }

    const rule = PERMISSION_MATRIX[tool.permissionLevel]

    // Rate limiting
    if (!this.checkRateLimit(name, rule.maxExecPerMinute)) {
      return { allowed: false, reason: 'Rate limit exceeded for ' + name, needsConfirm: false, needsDoubleConfirm: false }
    }

    if (autoConfirm) {
      return { allowed: true, needsConfirm: false, needsDoubleConfirm: false }
    }

    return {
      allowed: true,
      needsConfirm: rule.requiresConfirmation,
      needsDoubleConfirm: rule.requiresDoubleConfirm,
    }
  }

  // Execute a tool through the gateway
  async execute(name: string, args: Record<string, any>, userId = 'system', autoConfirm = false): Promise<ToolExecResult> {
    const tool = this.tools.get(name)
    if (!tool) return { success: false, error: 'Tool not registered: ' + name }

    // Permission check
    const perm = this.checkPermission(name, autoConfirm)
    if (!perm.allowed) return { success: false, error: perm.reason }

    // Audit log for modify/danger/critical
    const shouldAudit = PERMISSION_MATRIX[tool.permissionLevel].auditLog

    const t0 = Date.now()
    try {
      const result = await tool.execute(args)
      const duration = Date.now() - t0

      if (shouldAudit) {
        this.logAudit(name, userId, args, result.success ? 'ok' : (result.error || 'unknown'), result.success, duration)
      }

      // Increment call count
      sqlite.prepare('UPDATE tool_registry SET call_count = call_count + 1, last_called = unixepoch() WHERE name = ?').run(name)

      return { ...result, durationMs: duration }
    } catch (e: any) {
      const duration = Date.now() - t0
      if (shouldAudit) {
        this.logAudit(name, userId, args, e.message, false, duration)
      }
      return { success: false, error: e.message, durationMs: duration }
    }
  }

  // Get tool by name
  get(name: string): ToolRegistration | undefined {
    return this.tools.get(name)
  }

  // List all registered tools
  list(category?: string): ToolRegistration[] {
    const all = Array.from(this.tools.values())
    if (category) return all.filter(t => t.category === category)
    return all
  }

  // Discover tools by capability
  discover(capability: string): ToolRegistration[] {
    return Array.from(this.tools.values()).filter(t =>
      t.category === capability ||
      t.description.toLowerCase().includes(capability.toLowerCase()) ||
      Object.keys(t.parameters).some(p => p.includes(capability))
    )
  }

  // Get tools for LLM function calling format
  getToolsForLLM(): Array<{ type: 'function'; function: any }> {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([k, v]) => [k, {
              type: v.type,
              description: v.description,
              ...(v.enum ? { enum: v.enum } : {}),
            }])
          ),
          required: Object.entries(t.parameters)
            .filter(([, v]) => v.required)
            .map(([k]) => k),
        },
        ...(t.schema ? { strict: t.schema } : {}),
      },
    }))
  }

  // Get tool schemas as JSON Schema
  getSchemas(): Record<string, any> {
    const schemas: Record<string, any> = {}
    for (const [name, tool] of this.tools) {
      schemas[name] = tool.schema || generateJSONSchema(tool)
    }
    return schemas
  }

  // Load persisted tools from DB
  loadPersisted(): number {
    const rows = sqlite.prepare('SELECT * FROM tool_registry').all() as any[]
    let count = 0
    for (const row of rows) {
      if (!this.tools.has(row.name)) {
        // Tools loaded from DB need re-registration of execute function
        // They get loaded as schema-only (no execute until re-registered)
        count++
      }
    }
    console.log('[ToolGateway] Loaded ' + rows.length + ' persisted tool schemas')
    return rows.length
  }

  // Rate limiting
  private checkRateLimit(name: string, maxPerMinute: number): boolean {
    const now = Date.now()
    const entry = this.execCounts.get(name)
    if (!entry || now - entry.windowStart > 60000) {
      this.execCounts.set(name, { count: 1, windowStart: now })
      return true
    }
    if (entry.count >= maxPerMinute) return false
    entry.count++
    return true
  }

  // Audit logging
  private logAudit(tool: string, userId: string, args: any, result: string, success: boolean, durationMs: number): void {
    const id = 'audit_' + Date.now().toString(36)
    sqlite.prepare(`
      INSERT INTO tool_audit_log (id, tool_name, user_id, args, result, success, duration_ms, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, tool, userId, JSON.stringify(args), result.slice(0, 500), success ? 1 : 0, durationMs)

    this.auditLog.push({ tool, args, result, timestamp: Date.now(), userId })
    if (this.auditLog.length > 1000) this.auditLog.shift()
  }

  // Get audit history
  getAuditLog(limit = 50): Array<{ tool: string; userId: string; result: string; timestamp: number }> {
    return this.auditLog.slice(-limit)
  }

  // Get registry stats
  getStats(): { total: number; byCategory: Record<string, number>; byPermission: Record<string, number> } {
    const byCategory: Record<string, number> = {}
    const byPermission: Record<string, number> = {}
    for (const tool of this.tools.values()) {
      byCategory[tool.category] = (byCategory[tool.category] || 0) + 1
      byPermission[tool.permissionLevel] = (byPermission[tool.permissionLevel] || 0) + 1
    }
    return { total: this.tools.size, byCategory, byPermission }
  }
}

// Auto-generate JSON Schema from ToolRegistration
function generateJSONSchema(tool: ToolRegistration): Record<string, any> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: tool.name,
    description: tool.description,
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(tool.parameters).map(([name, param]) => [
        name,
        {
          type: param.type,
          description: param.description,
          ...(param.enum ? { enum: param.enum } : {}),
          ...(param.default !== undefined ? { default: param.default } : {}),
        },
      ])
    ),
    required: Object.entries(tool.parameters)
      .filter(([, p]) => p.required)
      .map(([name]) => name),
    returns: {
      type: tool.returns.type,
      description: tool.returns.description,
    },
  }
}

// Global singleton
export const toolGateway = new ToolGateway()

console.log('[ToolGateway] Dynamic tool registry ready')
