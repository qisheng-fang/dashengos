// packages/backend/src/core/tool-schema.ts · DaShengOS v8.4
// JSON Schema 自动生成 — TypeScript 函数 → JSON Schema
// 对标 Hermes function calling schema 动态生成
// 2026-06-28

// Types for schema generation
export interface FunctionSignature {
  name: string
  description: string
  params: ParamDef[]
  returns: ReturnDef
}

export interface ParamDef {
  name: string
  type: string
  description: string
  required: boolean
  default?: any
  enum?: string[]
  validation?: {
    min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string
  }
}

export interface ReturnDef {
  type: string
  description: string
  items?: { type: string }
}

// TypeScript type → JSON Schema type mapping
const TYPE_MAP: Record<string, string> = {
  string: 'string', number: 'number', boolean: 'boolean',
  object: 'object', array: 'array', null: 'null',
  any: 'string', void: 'null',
}

// Generate JSON Schema from function signature
export function generateToolSchema(sig: FunctionSignature): Record<string, any> {
  const properties: Record<string, any> = {}
  const required: string[] = []

  for (const param of sig.params) {
    const prop: Record<string, any> = {
      type: TYPE_MAP[param.type] || 'string',
      description: param.description,
    }
    if (param.enum) prop.enum = param.enum
    if (param.default !== undefined) prop.default = param.default
    if (param.validation) {
      if (param.validation.min !== undefined) prop.minimum = param.validation.min
      if (param.validation.max !== undefined) prop.maximum = param.validation.max
      if (param.validation.minLength !== undefined) prop.minLength = param.validation.minLength
      if (param.validation.maxLength !== undefined) prop.maxLength = param.validation.maxLength
      if (param.validation.pattern) prop.pattern = param.validation.pattern
    }
    properties[param.name] = prop
    if (param.required) required.push(param.name)
  }

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: sig.name,
    description: sig.description,
    type: 'object',
    properties,
    required,
    returns: {
      type: TYPE_MAP[sig.returns.type] || 'string',
      description: sig.returns.description,
      ...(sig.returns.items ? { items: { type: TYPE_MAP[sig.returns.items.type] || 'string' } } : {}),
    },
  }
}

// Generate OpenAI function calling format from function signature
export function generateOpenAIFunction(sig: FunctionSignature): {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, any> }
} {
  const schema = generateToolSchema(sig)
  return {
    type: 'function',
    function: {
      name: sig.name,
      description: sig.description,
      parameters: {
        type: 'object',
        properties: schema.properties,
        required: schema.required,
      },
    },
  }
}

// Generate Anthropic tool_use format
export function generateAnthropicTool(sig: FunctionSignature): {
  name: string
  description: string
  input_schema: Record<string, any>
} {
  const schema = generateToolSchema(sig)
  return {
    name: sig.name,
    description: sig.description,
    input_schema: {
      type: 'object',
      properties: schema.properties,
      required: schema.required,
    },
  }
}

// Infer signature from runtime function (heuristic)
export function inferSignature(
  name: string,
  description: string,
  fn: (...args: any[]) => any
): FunctionSignature {
  const fnStr = fn.toString()
  const params: ParamDef[] = []

  // Extract parameter names from function string
  const paramMatch = fnStr.match(/\(([^)]*)\)/)
  if (paramMatch && paramMatch[1].trim()) {
    const paramNames = paramMatch[1].split(',').map(p => p.trim().split(':')[0].trim())
    for (const pName of paramNames) {
      params.push({
        name: pName,
        type: 'string',
        description: pName,
        required: true,
      })
    }
  }

  return {
    name,
    description,
    params,
    returns: { type: 'any', description: 'Function return value' },
  }
}

// Batch generate schemas from declaration file
export function generateSchemaRegistry(
  functions: Array<FunctionSignature>
): Map<string, Record<string, any>> {
  const registry = new Map<string, Record<string, any>>()
  for (const sig of functions) {
    registry.set(sig.name, generateToolSchema(sig))
  }
  return registry
}

// Validate against a generated schema
export function validateAgainstSchema(
  schema: Record<string, any>,
  input: Record<string, any>
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check required fields
  for (const req of (schema.required || [])) {
    if (!(req in input)) {
      errors.push('Missing required field: ' + req)
    }
  }

  // Check types
  for (const [key, propDef] of Object.entries(schema.properties || {})) {
    if (input[key] === undefined) continue
    const def = propDef as any

    if (def.type === 'number' && typeof input[key] !== 'number') {
      errors.push(key + ': expected number, got ' + typeof input[key])
    }
    if (def.type === 'boolean' && typeof input[key] !== 'boolean') {
      errors.push(key + ': expected boolean')
    }
    if (def.enum && !def.enum.includes(input[key])) {
      errors.push(key + ': value must be one of: ' + def.enum.join(', '))
    }
    if (def.minLength && String(input[key]).length < def.minLength) {
      errors.push(key + ': min length is ' + def.minLength)
    }
    if (def.maxLength && String(input[key]).length > def.maxLength) {
      errors.push(key + ': max length is ' + def.maxLength)
    }
  }

  return { valid: errors.length === 0, errors }
}

console.log('[ToolSchema] JSON Schema generator ready')
