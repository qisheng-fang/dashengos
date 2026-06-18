// apps/web/src/store/session.ts · v0.3 spec §34.1
// 当前会话状态 (不持久化) · 临时 store, Phase 2 接 backend 时迁到 TanStack Query

import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown>; result?: unknown; status: 'pending' | 'running' | 'success' | 'error' }>
  attachments?: Array<{ id: string; name: string; type: string; size: number }>
  timestamp: number
  model?: string
  latencyMs?: number
}

export interface Agent {
  id: string
  name: string
  description: string
  icon: string
  usage: number
  rating: number
  installed: boolean
  category: 'code' | 'research' | 'design' | 'data' | 'security' | 'custom'
}

interface SessionState {
  sessionId: string | null
  agent: Agent | null
  model: string
  messages: Message[]
  // Actions
  setSession: (s: { id: string; agent?: Agent | null; messages?: Message[] }) => void
  setAgent: (a: Agent | null) => void
  setModel: (m: string) => void
  appendMessage: (m: Message) => void
  updateLastMessage: (patch: Partial<Message>) => void
  clear: () => void
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessionId: null,
  agent: null,
  model: 'ollama:qwen2.5:7b',
  messages: [],
  setSession: (s) =>
    set({
      sessionId: s.id,
      agent: s.agent !== undefined ? s.agent : get().agent,
      messages: s.messages ?? get().messages,
    }),
  setAgent: (a) => set({ agent: a }),
  setModel: (m) => set({ model: m }),
  appendMessage: (m) => set({ messages: [...get().messages, m] }),
  updateLastMessage: (patch) => {
    const msgs = get().messages
    if (msgs.length === 0) return
    set({ messages: [...msgs.slice(0, -1), { ...msgs[msgs.length - 1], ...patch }] })
  },
  clear: () => set({ sessionId: null, messages: [] }),
}))
