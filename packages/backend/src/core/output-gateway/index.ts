// Output Gateway — 主入口 (per user's design doc §四)
// 管道: Classifier → Parser → Guard → Redactor → Annotator
// 原则: 任何 Agent 输出都不能直接到达用户或执行器

import type { AgentRawOutput, FilteredOutput, SessionContext, GatewayContext } from './types.js'
import { classifyOutput } from './classifier.js'
import { parseStructuredOutput } from './structured-parser.js'
import { redactSecrets, redactObject, redactCommandOutput } from './secret-redactor.js'
import { validateCommand } from './command-guard.js'
import { validatePatch } from './patch-guard.js'
import { validateFinalReport } from './report-guard.js'
import { annotateRisk } from './risk-annotator.js'
import { stripAIFlavorText, cleanHtmlOutput } from './ai-flavor-stripper.js'

export type { AgentRawOutput, FilteredOutput, SessionContext, GatewayContext } from './types.js'
export { redactSecrets, redactObject, redactCommandOutput } from './secret-redactor.js'

// ─── 主管道: processAgentOutput ────────────────────────

export function processAgentOutput(
  raw: AgentRawOutput,
  ctx: GatewayContext,
): FilteredOutput {
  switch (raw.kind) {
    case 'message':
      return processMessage(raw, ctx)

    case 'tool_call':
      return processToolCall(raw, ctx)

    case 'command':
      return processCommand(raw, ctx)

    case 'patch':
      return processPatch(raw, ctx)

    case 'final_report':
      return processFinalReport(raw, ctx)

    default:
      return {
        status: 'allow',
        risk: 'low',
        outputType: 'message',
        safeContent: raw,
      }
  }
}

// ─── 子管道 ──────────────────────────────────────────

/** 纯文本消息: 分类 → 脱敏 */
function processMessage(
  raw: AgentRawOutput & { kind: 'message' },
  ctx: GatewayContext,
): FilteredOutput {
  const parsed = parseStructuredOutput(raw)
  const content = typeof parsed.parsed === 'object' && parsed.parsed !== null
    ? (parsed.parsed as { content: string }).content
    : String(parsed.parsed)
  const redacted = redactSecrets(content)
  const stripped = stripAIFlavorText(redacted.content)
  return {
    status: 'allow',
    risk: 'low',
    outputType: 'message',
    safeContent: stripped,
    redactions: redacted.redactions.length > 0 ? redacted.redactions : undefined,
    warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  }
}

/** 工具调用: 分类 → 解析 → 风险评分 → 审批检查 */
function processToolCall(
  raw: AgentRawOutput & { kind: 'tool_call' },
  ctx: GatewayContext,
): FilteredOutput {
  const parsed = parseStructuredOutput(raw)
  const toolName = raw.tool

  let output: FilteredOutput = {
    status: 'allow',
    risk: 'low',
    outputType: 'tool_call',
    safeContent: parsed.parsed,
    warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  }

  // 风险标注
  output = annotateRisk(output, toolName)

  // 审批模式检查
  if (ctx.policy.approvalMode === 'safe' && output.risk === 'high') {
    return {
      status: 'deny',
      risk: 'high',
      outputType: 'tool_call',
      denyReason: `High-risk tool "${toolName}" blocked in safe mode`,
    }
  }

  if (ctx.policy.approvalMode === 'ask' && output.risk === 'high') {
    output.status = 'ask'
    output.approvalRequest = {
      tool: toolName,
      args: raw.args,
      reason: `Tool "${toolName}" flagged as high-risk`,
      risk: 'high',
      impacts: ['May modify system state', 'May access sensitive resources'],
    }
  }

  // 脱敏 args
  const redacted = redactObject(raw.args)
  output.safeContent = { tool: toolName, args: redacted.cleaned }
  if (redacted.redactions.length > 0) {
    output.redactions = [...(output.redactions || []), ...redacted.redactions]
  }

  return output
}

/** 命令: 分类 → 解析 → 命令守卫 → 脱敏 */
function processCommand(
  raw: AgentRawOutput & { kind: 'command' },
  ctx: GatewayContext,
): FilteredOutput {
  const parsed = parseStructuredOutput(raw)

  // 命令守卫
  const guardResult = validateCommand(raw.command, { session: ctx.session, policy: ctx.policy })
  if (guardResult.status !== 'allow') return guardResult

  // 脱敏
  const redacted = redactSecrets(raw.command)
  return {
    status: 'allow',
    risk: 'low',
    outputType: 'command',
    safeContent: { command: redacted.content, cwd: raw.cwd },
    redactions: redacted.redactions.length > 0 ? redacted.redactions : undefined,
    warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  }
}

/** 文件补丁: 分类 → 补丁守卫 → 脱敏 */
function processPatch(
  raw: AgentRawOutput & { kind: 'patch' },
  ctx: GatewayContext,
): FilteredOutput {
  const parsed = parseStructuredOutput(raw)

  // 补丁守卫 (protected path + secrets in content)
  const guardResult = validatePatch(raw.path, raw.content, ctx.session.workspaceDir)
  if (guardResult.status !== 'allow') return guardResult

  // 脱敏内容
  const redacted = redactSecrets(raw.content)
  return {
    status: 'allow',
    risk: 'low',
    outputType: 'patch',
    safeContent: { path: raw.path, content: redacted.content, reason: raw.reason },
    redactions: redacted.redactions.length > 0 ? redacted.redactions : undefined,
    warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined,
  }
}

/** 最终报告: 报告守卫 → 脱敏 */
function processFinalReport(
  raw: AgentRawOutput & { kind: 'final_report' },
  ctx: GatewayContext,
): FilteredOutput {
  return validateFinalReport(raw.content, ctx.session)
}

// ─── 审批流辅助函数 ───────────────────────────────────

/** 将 FilteredOutput 渲染为用户可读的消息 */
export function renderForUser(output: FilteredOutput): string {
  if (output.status === 'deny') {
    return `🚫 操作已阻止: ${output.denyReason || '安全策略禁止此操作'}`
  }
  if (output.status === 'ask') {
    const req = output.approvalRequest
    if (!req) return '⚠️ 需要确认此操作'
    return `⚠️ 需要确认高危操作:\n  工具: ${req.tool}\n  理由: ${req.reason}\n  风险: ${req.risk}\n  影响: ${(req.impacts || []).join(', ')}\n  \n请回复 "允许" 或 "拒绝"`
  }
  if (output.status === 'rewrite') {
    return `✏️ 已修改: ${JSON.stringify(output.safeContent)}`
  }
  // allow
  if (typeof output.safeContent === 'string') return output.safeContent
  if (output.safeContent && typeof output.safeContent === 'object') {
    return JSON.stringify(output.safeContent, null, 2)
  }
  return ''
}

/** 创建默认网关上下文 */
export function createGatewayContext(
  opts: { userId: string; sessionId: string; workspaceDir: string; approvalMode?: 'yolo' | 'ask' | 'safe' },
): GatewayContext {
  return {
    session: {
      userId: opts.userId,
      sessionId: opts.sessionId,
      workspaceDir: opts.workspaceDir,
    },
    policy: {
      approvalMode: opts.approvalMode || 'ask',
    },
  }
}

// ─── 批量处理 ────────────────────────────────────────

/** 处理多个输出项 (用于 Agent 批量返回) */
export function processBatch(
  items: AgentRawOutput[],
  ctx: GatewayContext,
): FilteredOutput[] {
  return items.map(item => processAgentOutput(item, ctx))
}

/** 检查批量输出中是否有需要审批的项 */
export function findPendingApprovals(outputs: FilteredOutput[]): FilteredOutput[] {
  return outputs.filter(o => o.status === 'ask')
}

/** 检查批量输出中是否有被拒绝的项 */
export function findDenied(outputs: FilteredOutput[]): FilteredOutput[] {
  return outputs.filter(o => o.status === 'deny')
}
