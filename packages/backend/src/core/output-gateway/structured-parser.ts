// Structured Parser — 把自然语言/JSON 输出解析成结构化对象
import type { AgentRawOutput, FilteredOutput } from './types.js'

interface ParsedOutput {
  outputType: string
  parsed: unknown
  warnings: string[]
}

export function parseStructuredOutput(raw: AgentRawOutput): ParsedOutput {
  const warnings: string[] = []

  switch (raw.kind) {
    case "tool_call": {
      // Validate args is a plain object
      if (typeof raw.args !== "object" || raw.args === null) {
        warnings.push("Tool call args is not a valid object")
        return { outputType: raw.kind, parsed: { tool: raw.tool, args: {} }, warnings }
      }
      return { outputType: raw.kind, parsed: { tool: raw.tool, args: raw.args }, warnings }
    }
    case "command": {
      if (!raw.command || raw.command.trim().length === 0) {
        warnings.push("Empty command")
      }
      return { outputType: raw.kind, parsed: { command: raw.command, cwd: raw.cwd || "/" }, warnings }
    }
    case "patch": {
      if (!raw.path || raw.path.includes("..")) {
        warnings.push("Suspicious patch path")
      }
      return { outputType: raw.kind, parsed: { path: raw.path, content: raw.content, reason: raw.reason }, warnings }
    }
    case "final_report":
    case "message":
    default:
      return { outputType: raw.kind, parsed: { content: raw.content }, warnings }
  }
}
