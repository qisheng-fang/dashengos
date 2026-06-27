// Risk Annotator — 风险评分
import type { FilteredOutput } from './types.js'

export function annotateRisk(output: FilteredOutput, toolName: string): FilteredOutput {
  const highRiskTools = ["run_command", "write_file", "db_query", "execute_skill", "web_search"]
  const mediumRiskTools = ["read_file", "list_files", "search_content"]

  if (highRiskTools.includes(toolName)) {
    output.risk = "high"
    if (!output.warnings) output.warnings = []
    output.warnings.push(`Tool "${toolName}" has high-risk capability`)
  } else if (mediumRiskTools.includes(toolName)) {
    if (output.risk !== "high") output.risk = "medium"
  }

  return output
}
