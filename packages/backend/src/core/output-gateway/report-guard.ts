// Report Guard — 最终报告一致性校验 + AI 格式剥离
import type { FilteredOutput, SessionContext } from './types.js'
import { redactSecrets } from './secret-redactor.js'
import { stripAIFlavorText } from './ai-flavor-stripper.js'

export function validateFinalReport(report: string, session: SessionContext): FilteredOutput {
  const { content, redactions } = redactSecrets(report)
  // ★ 剥离 AI 格式: **bold**, # headers, `code`, > blockquote, markdown artifacts
  const stripped = stripAIFlavorText(content)

  const warnings: string[] = []
  if (stripped.length < 10) warnings.push("Report appears too short")
  if (stripped.includes("```html") && !stripped.includes("<!DOCTYPE")) {
    warnings.push("HTML report missing DOCTYPE")
  }

  return {
    status: "allow",
    risk: "low",
    outputType: "final_report",
    safeContent: stripped,
    redactions,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}
