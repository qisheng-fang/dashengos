// apps/web/src/lib/agent-client.ts · 2026-06-18 (D7-fix)
// DaShengOS · Agent Bridge Client
// ----------------------------------------------------------------------
// 双模式:
//   ① agentChat()    → :8001 DeerFlow AG-UI GraphQL (原 Python daemon, 暂未启用)
//   ② backendChat()  → :8000 /api/v1/chat REST (当前主用, Fastify + LLM providers)
//
// 2026-06-18 D7-fix: 前端报 "agent bridge unreachable :8001"
//   根因: :8001 Python DeerFlow HTTP 服务未启动
//   修复: 新增 backendChat() 走 :8000 后端, Chat.tsx default agent 切换到此函数
// ----------------------------------------------------------------------

const BACKEND_BASE =
  (typeof window !== 'undefined' && (window as any).__DASHE_BACKEND_URL__) ||
  (import.meta.env?.VITE_BACKEND_URL as string) ||
  ''  // 空串 = 走 Vite proxy, 避免浏览器走系统 http_proxy

const AGENT_BASE =
  (typeof window !== 'undefined' && (window as any).__DASHE_AGENT_URL__) ||
  (import.meta.env?.VITE_AGENT_URL as string) ||
  'http://127.0.0.1:8001'

const CHAT_URL = `${BACKEND_BASE}/api/v1/chat`
const GRAPHQL_URL = `${AGENT_BASE}/api/agent`

const GENERATE_RESPONSE_QUERY = `
  mutation generateCopilotResponse($data: GenerateCopilotResponseInput!) {
    generateCopilotResponse(data: $data) {
      threadId
      runId
      status { code reason }
      messages {
        __typename
        ... on TextMessageOutput {
          id
          createdAt
          status { __typename code }
          content
          role
          parentMessageId
        }
      }
      metaEvents { __typename }
    }
  }
`.trim()

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  parentMessageId?: string | null
}

export interface AgentChatResponse {
  threadId: string
  runId: string
  status: { code: 'success' | 'failed' | 'pending'; reason?: string }
  assistantMessage: AgentMessage | null
  rawMessages: unknown[]
  latencyMs: number
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export async function agentChat(opts: {
  threadId: string
  messages: AgentMessage[]
  agentId?: string
  signal?: AbortSignal
  onStatus?: (status: string) => void
}): Promise<AgentChatResponse> {
  const t0 = performance.now()
  const runId = newId('r')

  const aguiMessages = opts.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    parentMessageId: m.parentMessageId ?? null,
  }))

  const body = {
    operationName: 'generateCopilotResponse',
    variables: {
      data: {
        threadId: opts.threadId,
        runId,
        agentId: opts.agentId ?? 'default',
        messages: aguiMessages,
      },
    },
    query: GENERATE_RESPONSE_QUERY,
  }

  let res: Response
  try {
    res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })
  } catch (e) {
    throw new Error(`agent bridge unreachable at ${GRAPHQL_URL}: ${(e as Error).message}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`agent bridge HTTP ${res.status}: ${text.slice(0, 200)}`)
  }

  const json = (await res.json()) as {
    data?: {
      generateCopilotResponse?: {
        threadId: string
        runId: string
        status: { code: 'success' | 'failed' | 'pending'; reason?: string }
        messages: Array<{
          __typename: string
          id: string
          content: string[] | string
          role: string
          status?: { __typename: string; code: string }
          parentMessageId?: string | null
        }>
        metaEvents: unknown[]
      }
    }
    errors?: Array<{ message: string }>
  }

  if (json.errors?.length) {
    throw new Error(`agent runtime: ${json.errors[0].message}`)
  }

  const result = json.data?.generateCopilotResponse
  if (!result) {
    throw new Error('agent bridge: empty response (no generateCopilotResponse in data)')
  }

  const assistantRaw = result.messages.find(
    (m) => m.__typename === 'TextMessageOutput' && (m.role === 'assistant' || !m.role),
  )
  const assistantMessage: AgentMessage | null = assistantRaw
    ? {
        id: assistantRaw.id,
        role: 'assistant',
        content: Array.isArray(assistantRaw.content) ? assistantRaw.content.join('') : assistantRaw.content,
        parentMessageId: assistantRaw.parentMessageId ?? null,
      }
    : null

  return {
    threadId: result.threadId,
    runId: result.runId,
    status: result.status,
    assistantMessage,
    rawMessages: result.messages,
    latencyMs: Math.round(performance.now() - t0),
  }
}

export async function agentHealth(): Promise<{
  ok: boolean
  brain?: { backend: string; model: string; active_runs: number }
  error?: string
}> {
  try {
    const res = await fetch(`${AGENT_BASE}/health`)
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    const data = (await res.json()) as {
      status: string
      brain?: { backend: string; model: string; active_runs: number }
    }
    return { ok: data.status === 'ok', brain: data.brain }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ===== backendChat() — 走 :8000 后端 /api/v1/chat (D7-fix) =====
// 替代 agentChat() 作为 default agent 的主聊天入口。
// 协议: REST POST { message, threadId?, history? } → { threadId, status, report, sources }

export interface BackendChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
}

export interface BackendChatResponse {
  threadId: string
  status: string
  report: string
  sources: string[]
  artifacts?: Array<{
    type: string
    format: string
    fileName: string
    size?: number
    downloadUrl?: string
    error?: string
  }>
}

export async function backendChat(opts: {
  message: string
  threadId: string
  history?: BackendChatMessage[]
  token: string
  signal?: AbortSignal
}): Promise<BackendChatResponse> {
  const t0 = performance.now()

  const body = {
    message: opts.message,
    threadId: opts.threadId,
    history: (opts.history || []).map((m) => ({ role: m.role, content: m.content })),
  }

  const res = await fetch(CHAT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`backend chat HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as BackendChatResponse
  ;(json as any).latencyMs = Math.round(performance.now() - t0)
  return json
}

export async function backendHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_BASE}/api/v1/status`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
