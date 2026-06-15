// apps/web/src/lib/agent-client.ts · 2026-06-15
// DaShengOS · Agent Bridge (DeerFlow 2.0) client
// ----------------------------------------------------------------------
// 后端是 :8001 FastAPI 服务, 跑 DeerFlow 2.0 backend (底层 LLM engine 是 hermes-agent)
//   - 6/15 之前叫 hermes_brain, 老板拍板改默认 backend 为 deerflow
//   - hermes-backend 还可用: DASHENG_BRAIN_BACKEND=hermes
// 协议: AG-UI (GraphQL mutation generateCopilotResponse)
//   - 6/15 之前路径叫 /api/copilotkit, 老板拍板改名为 /api/agent
//   - 协议是 AG-UI 开源协议, 不绑死 CopilotKit
//
// 老板 2026-06-15 反馈 "前端和后端都是不通的" 根因:
//   apps/web (Vite/TanStack) 调 /api/v1/sessions/:id/messages → :8000 (无 /v1 路由)
//   实际 v0.3 后端是 :8001 Python DeerFlow 2.0 (AG-UI 协议)
// 修法: 这个 client 直接打 :8001, 走同款 AG-UI 协议
// ----------------------------------------------------------------------

const AGENT_BASE =
  (typeof window !== 'undefined' && (window as any).__DASHE_AGENT_URL__) ||
  (import.meta.env?.VITE_AGENT_URL as string) ||
  'http://127.0.0.1:8001'

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
