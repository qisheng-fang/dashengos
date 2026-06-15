// apps/web/src/lib/social-media-client.ts · Track B.3 (2026-06-15)
// 调 v0.3 packages/backend :8000 /api/v1/social/* (3 社媒 agent 路由)
//
// 跟 agent-client.ts 平行:
//   agent-client.ts  → :8001 agent bridge (DeerFlow, LLM chat)
//   social-media-client.ts → :8000 backend (3 social agents, worker call)

import { http, type ApiError } from './api'

export interface SocialToolDef {
  name: string
  description: string
  parameters: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean; description?: string }>
  full_chain?: boolean
}

export interface SocialAgent {
  id: string
  name: string
  description: string
  category: 'social'
  is_builtin: boolean
  is_social: boolean
  capabilities: string[]
  tools: SocialToolDef[]
}

export interface SocialExecuteResult {
  agent_id: string
  tool: string
  ok: boolean
  data?: unknown
  error?: string
  error_human?: string
  is_real: boolean
  duration_ms: number
  content?: string
  cards?: Array<Record<string, unknown>>
}

/**
 * 列 3 social agents
 */
export async function listSocialAgents(): Promise<SocialAgent[]> {
  const data = await http.get<{ agents: SocialAgent[]; count: number }>('/api/v1/social')
  return data.agents
}

/**
 * 列 worker 健康状态 (5 worker)
 */
export async function getSocialWorkersHealth(): Promise<{
  all_ok: boolean
  workers: Record<string, { ok: boolean; service: string; stage?: number; uptime_seconds?: number; note?: string }>
}> {
  return http.get('/api/v1/social/workers/health')
}

/**
 * 调 social agent 的某个 tool (single tool call)
 */
export async function socialExecute(
  agentId: string,
  tool: string,
  params: Record<string, unknown> = {},
): Promise<SocialExecuteResult> {
  return http.post<SocialExecuteResult>(`/api/v1/social/${agentId}/execute`, { tool, params })
}

/**
 * 跑 full_chain (auto) — 顺序执行所有 full_chain: true 的 tool
 * 'auto' 是约定值, 后端识别后跑全链
 */
export async function socialExecuteAuto(
  agentId: string,
  params: Record<string, unknown> = {},
): Promise<SocialExecuteResult> {
  return socialExecute(agentId, 'auto', params)
}

export type { ApiError }
