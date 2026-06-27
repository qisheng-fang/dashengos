// Output Gateway — Types (per user's design doc)
// 所有 Agent 输出的统一入口类型

export type AgentRawOutput =
  | { kind: "message"; content: string }
  | { kind: "tool_call"; tool: string; args: unknown }
  | { kind: "patch"; path: string; content: string; reason?: string }
  | { kind: "command"; command: string; cwd?: string; reason?: string }
  | { kind: "final_report"; content: string }

export interface Redaction {
  type: "api_key" | "token" | "password" | "private_key" | "connection_string" | "filesystem_path" | "unknown_secret"
  location: string
  replacement: string
}

export interface ApprovalRequest {
  tool: string
  args: unknown
  reason: string
  risk: "low" | "medium" | "high"
  impacts: string[]
}

export interface FilteredOutput {
  status: "allow" | "ask" | "deny" | "rewrite"
  risk: "low" | "medium" | "high"
  outputType: "message" | "tool_call" | "command" | "patch" | "final_report" | "audit_event"
  safeContent?: unknown
  redactions?: Redaction[]
  warnings?: string[]
  approvalRequest?: ApprovalRequest
  denyReason?: string
}

export interface SessionContext {
  userId: string
  sessionId: string
  workspaceDir: string
}

export interface GatewayContext {
  session: SessionContext
  policy: { approvalMode: "yolo" | "ask" | "safe" }
  registry?: { tools: Map<string, { risk: string; category: string }> }
}
