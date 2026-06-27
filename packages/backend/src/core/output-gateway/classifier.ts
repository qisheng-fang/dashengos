// Output Classifier — 判断 Agent 输出类型
import type { AgentRawOutput } from './types.js'

interface ClassifiedOutput {
  outputType: AgentRawOutput["kind"]
  target: "user" | "tool" | "runner" | "filesystem"
  raw: AgentRawOutput
}

export function classifyOutput(raw: AgentRawOutput): ClassifiedOutput {
  const targetMap: Record<AgentRawOutput["kind"], ClassifiedOutput["target"]> = {
    message: "user",
    tool_call: "tool",
    command: "runner",
    patch: "filesystem",
    final_report: "user",
  }
  return {
    outputType: raw.kind,
    target: targetMap[raw.kind] || "user",
    raw,
  }
}
