// packages/backend/src/core/structured-output.ts · DaShengOS v8.0
// 结构化输出约束 — 强制 Agent 间通信遵循 JSON Schema
// 基于 zod，集成到 reflector.ts 验证管道

import { z, ZodType, ZodError } from 'zod'

// Schema Registry Types
interface SchemaEntry {
  schema: ZodType
  description: string
  version: number
}

class OutputSchemaRegistry {
  private schemas = new Map<string, SchemaEntry>()

  register(toolName: string, schema: ZodType, description: string, version = 1): void {
    this.schemas.set(toolName, { schema, description, version })
    console.log('[StructuredOutput] Registered schema for:', toolName, '(v' + version + ')')
  }

  get(toolName: string): SchemaEntry | undefined {
    return this.schemas.get(toolName)
  }

  list(): Array<{ toolName: string; description: string; version: number }> {
    return Array.from(this.schemas.entries()).map(([toolName, entry]) => ({
      toolName, description: entry.description, version: entry.version,
    }))
  }

  has(toolName: string): boolean {
    return this.schemas.has(toolName)
  }
}

// Global registry instance
export const outputSchemas = new OutputSchemaRegistry()

// Validation result
export interface ValidationResult {
  valid: boolean
  data?: unknown
  errors?: Array<{ path: string; message: string }>
}

// Validate tool output against registered schema
export function validateToolOutput(toolName: string, rawOutput: unknown): ValidationResult {
  const entry = outputSchemas.get(toolName)
  if (!entry) {
    // No schema registered — pass through (no constraint)
    return { valid: true, data: rawOutput }
  }

  try {
    const parsed = entry.schema.parse(rawOutput)
    return { valid: true, data: parsed }
  } catch (e) {
    if (e instanceof ZodError) {
      return {
        valid: false,
        errors: e.errors.map(err => ({
          path: err.path.join('.'),
          message: err.message,
        })),
      }
    }
    return { valid: false, errors: [{ path: '', message: String(e) }] }
  }
}

// Validate a plain string output (parse JSON first)
export function validateStringOutput(toolName: string, rawString: string): ValidationResult {
  const entry = outputSchemas.get(toolName)
  if (!entry) return { valid: true, data: rawString }

  // Try JSON parse first
  try {
    const parsed = JSON.parse(rawString)
    return validateToolOutput(toolName, parsed)
  } catch {
    // Not JSON — try as plain value against schema
    try {
      const parsed = entry.schema.parse(rawString)
      return { valid: true, data: parsed }
    } catch (e) {
      if (e instanceof ZodError) {
        return {
          valid: false,
          errors: e.errors.map(err => ({
            path: err.path.join('.'),
            message: err.message,
          })),
        }
      }
      return { valid: false, errors: [{ path: '', message: String(e) }] }
    }
  }
}

// Wrapper for executeTool that adds schema validation
export function enforceOutputWrapper(
  toolName: string,
  execute: () => Promise<{ success: boolean; data?: string; error?: string }>
): () => Promise<{ success: boolean; data?: string; error?: string; schemaValid?: boolean; schemaErrors?: Array<{path: string; message: string}> }> {
  return async () => {
    const result = await execute()
    if (!result.success || !result.data || !outputSchemas.has(toolName)) {
      return result
    }

    const validation = validateStringOutput(toolName, result.data)
    return {
      ...result,
      schemaValid: validation.valid,
      schemaErrors: validation.errors,
    }
  }
}

// ─── Pre-configured schemas for built-in tools ─────────────

// web_search output
export const WebSearchResultSchema = z.object({
  results: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    snippet: z.string(),
  })),
  query: z.string(),
  totalResults: z.number().int().optional(),
})

// read_file output
export const ReadFileResultSchema = z.object({
  path: z.string(),
  content: z.string(),
  lines: z.number().int().positive().optional(),
})

// list_files output
export const ListFilesResultSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    name: z.string(),
    size: z.number().int().optional(),
    type: z.enum(['file', 'directory', 'symlink']),
  })),
  total: z.number().int(),
})

// exec_command output
export const ExecCommandResultSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  duration_ms: z.number().optional(),
})

// Initialize built-in schemas
export function initDefaultSchemas(): void {
  outputSchemas.register('web_search', WebSearchResultSchema, 'Web search result with title/url/snippet list')
  outputSchemas.register('read_file', ReadFileResultSchema, 'File read result with path and content')
  outputSchemas.register('list_files', ListFilesResultSchema, 'Directory listing with file metadata')
  outputSchemas.register('exec_command', ExecCommandResultSchema, 'Command execution output with exit code')
  console.log('[StructuredOutput] Default schemas initialized (4 built-in)')
}

console.log('[StructuredOutput] Module loaded')
