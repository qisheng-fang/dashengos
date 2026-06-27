// Command Guard — 命令风险识别与拦截
import type { FilteredOutput, SessionContext, ApprovalRequest } from './types.js'

const BLOCKED_COMMANDS = [
  "rm -rf /", "mkfs.", "dd if=", ":(){ :|:& };:", "chmod 777 /",
  "> /dev/sda", "format c:", "del /f /s",
]

const HIGH_RISK_PATTERNS = [
  /rm\s+-rf\s+(?!.*node_modules|.*\.cache|.*dist|.*build)/i,
  /sudo\s+/i,
  /curl\s+.*\|\s*(?:ba)?sh/i,
  /wget\s+.*-O\s*-\s*\|/i,
  /git\s+push\s+--force/i,
  /npm\s+publish/i,
  /docker\s+rm\s+-f/i,
  /kubectl\s+delete/i,
]

const MEDIUM_RISK_PATTERNS = [
  /npm\s+install\s+-g/i,
  /pip\s+install/i,
  /git\s+clone/i,
  /curl\s+/i,
  /wget\s+/i,
]

export function validateCommand(
  command: string,
  ctx: { session: SessionContext; policy: { approvalMode: string } }
): FilteredOutput {
  const trimmed = command.trim()

  // Block dangerous commands
  for (const blocked of BLOCKED_COMMANDS) {
    if (trimmed.includes(blocked)) {
      return {
        status: "deny",
        risk: "high",
        outputType: "command",
        denyReason: `Blocked dangerous command pattern: ${blocked}`,
      }
    }
  }

  // High risk → ask (in safe/ask mode) or deny (in safe mode)
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (ctx.policy.approvalMode === "safe") {
        return {
          status: "deny",
          risk: "high",
          outputType: "command",
          denyReason: `High-risk command blocked in safe mode: ${pattern}`,
        }
      }
      const approval: ApprovalRequest = {
        tool: "run_command",
        args: { command: trimmed },
        reason: "High-risk command detected",
        risk: "high",
        impacts: ["May modify system state", "May access network", "May delete data"],
      }
      return { status: "ask", risk: "high", outputType: "command", approvalRequest: approval }
    }
  }

  // Medium risk → ask in ask mode, auto-approve in yolo
  for (const pattern of MEDIUM_RISK_PATTERNS) {
    if (pattern.test(trimmed)) {
      if (ctx.policy.approvalMode === "ask") {
        const approval: ApprovalRequest = {
          tool: "run_command",
          args: { command: trimmed },
          reason: "Medium-risk network command",
          risk: "medium",
          impacts: ["Accesses external network"],
        }
        return { status: "ask", risk: "medium", outputType: "command", approvalRequest: approval }
      }
      break
    }
  }

  return { status: "allow", risk: "low", outputType: "command", safeContent: { command: trimmed } }
}
