// store/useAppStore.ts · CommandCenter 意图 + 对话历史 + 多会话管理
// ----------------------------------------------------------------------
// LUI (左) 驱动 GUI (右) 的核心状态
// 支持多会话：每个会话独立 chatHistory + threadId，自动生成标题
// 持久化到 localStorage (zustand persist)
// ----------------------------------------------------------------------

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppIntent = 'idle' | 'generate_model' | 'deploy_s2b2c' | 'marketing_sop'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: number
  artifacts?: Array<{ type: string; fileName?: string; downloadUrl?: string }>
}

/** 单个对话会话 */
export interface Conversation {
  id: string
  /** 会话标题（从首条用户消息自动提取） */
  title: string
  /** 后端 threadId */
  threadId: string
  /** 消息记录 */
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

const DEFAULT_WELCOME = `欢迎来到 DaShengOS 指挥中心 🧠\n\n告诉我你想做什么，我会自动调度工具和 Agent 来帮你。`

/** 从首条用户消息生成标题（截断 + 去空白） */
function autoTitle(msg: string): string {
  const trimmed = msg.trim().replace(/\n/g, ' ').slice(0, 40)
  return trimmed || '新对话'
}

/** 创建新会话（使用动态欢迎语） */
function createConversation(welcomeText?: string): Conversation {
  const id = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    title: '新对话',
    threadId: `cc_${Date.now().toString(36)}`,
    messages: [{ role: 'assistant', content: welcomeText || DEFAULT_WELCOME, timestamp: Date.now() }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

interface AppState {
  // ---- 意图 ----
  activeIntent: AppIntent
  setActiveIntent: (intent: AppIntent) => void

  // ---- 多会话 ----
  /** 所有会话列表 */
  conversations: Conversation[]
  /** 当前激活的会话 ID（null = 无） */
  activeConversationId: string | null

  // ---- 会话操作 ----
  /** 新建会话并切换过去 */
  newConversation: () => string
  /** 切换到指定会话 */
  switchConversation: (id: string) => void
  /** 删除会话（自动切换到最近一个） */
  deleteConversation: (id: string) => void
  /** 追加消息到当前会话 */
  addChatMessage: (msg: ChatMessage) => void
  /** 替换最后一条 assistant 消息（流式更新） */
  updateLastMessage: (content: string, artifacts?: ChatMessage['artifacts']) => void
  /** 清空当前会话消息（保留欢迎语） */
  clearCurrentChat: () => void
  /** 从后端 API 同步对话列表 */
  syncConversationsFromBackend: () => Promise<void>
  /** 从后端 API 懒加载指定对话的消息 */
  loadMessagesForConversation: (convId: string) => Promise<void>

  // ---- 兼容旧代码的计算属性 ----
  /** 当前会话的消息列表（向后兼容 chatHistory） */
  chatHistory: ChatMessage[]

  // ---- 动态欢迎语 ----
  welcomeMessage: string
  setWelcomeMessage: (msg: string) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ---- 意图 ----
      activeIntent: 'idle',
      setActiveIntent: (intent) => set({ activeIntent: intent }),

      // ---- 多会话 ----
      conversations: [],
      activeConversationId: null,

      // ---- 从后端加载对话历史 ----
      syncConversationsFromBackend: async () => {
        try {
          const { useAuthStore } = await import('@/lib/auth-store')
          const token = useAuthStore.getState()?.accessToken
          if (!token) return
          const res = await fetch('/api/v1/chat/conversations', {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) return
          const data = await res.json()
          const sessions = data.conversations || []
          if (sessions.length === 0) return

          set((state) => {
            const existing = state.conversations
            const merged = [...existing]
            for (const s of sessions) {
              const sessionId = s.id // sessions.id = threadId from SSE
              if (!sessionId || !sessionId.startsWith('cc_')) continue
              const match = merged.find((c) => c.threadId === sessionId)
              if (!match) {
                merged.push({
                  id: sessionId,
                  title: s.title || '历史对话',
                  threadId: sessionId,
                  messages: [],
                  createdAt: s.created_at || Date.now(),
                  updatedAt: s.updated_at || Date.now(),
                })
              } else {
                match.title = s.title || match.title
                match.updatedAt = s.updated_at || match.updatedAt
              }
            }
            merged.sort((a, b) => b.updatedAt - a.updatedAt)
            const activeId = state.activeConversationId
            const nextActive = activeId && merged.some((c) => c.id === activeId) ? activeId : merged[0]?.id || state.activeConversationId
            return { conversations: merged, activeConversationId: nextActive }
          })
        } catch { /* 静默失败，localStorage 是后备 */ }
      },

      // ---- 从后端加载指定对话的消息 ----
      loadMessagesForConversation: async (convId: string) => {
        try {
          const { useAuthStore } = await import('@/lib/auth-store')
          const token = useAuthStore.getState()?.accessToken
          if (!token) return
          const conv = get().conversations.find((c) => c.id === convId || c.threadId === convId)
          if (!conv) return
          const res = await fetch(`/api/v1/chat/conversations/${conv.threadId}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) return
          const data = await res.json()
          const msgs = data.messages || []
          if (msgs.length === 0) return

          set((state) => {
            const list = state.conversations.map((c) => {
              if (c.id !== convId && c.threadId !== convId) return c
              // 只在不覆盖已有消息的情况下加载（不覆盖正在进行的流式回复）
              const existingCount = c.messages.filter(m => m.content).length
              if (existingCount >= msgs.length) return c
              return {
                ...c,
                messages: msgs.map((m: any) => ({
                  role: m.role?.toLowerCase() as 'user' | 'assistant',
                  content: m.content,
                  timestamp: m.created_at || Date.now(),
                })),
              }
            })
            return { conversations: list }
          })
        } catch { /* 静默失败 */ }
      },

      // ---- 会话操作 ----
      newConversation: () => {
        const welcomeText = get().welcomeMessage || DEFAULT_WELCOME
        const conv = createConversation(welcomeText)
        set((state) => ({
          conversations: [conv, ...state.conversations],
          activeConversationId: conv.id,
          activeIntent: 'idle',
        }))
        return conv.id
      },

      switchConversation: (id) => {
        set({ activeConversationId: id, activeIntent: 'idle' })
        // 如果切到的对话没有消息，从后端懒加载
        const state = get()
        const conv = state.conversations.find((c) => c.id === id)
        if (conv && conv.messages.length === 0 && conv.threadId) {
          state.loadMessagesForConversation(id)
        }
      },

      deleteConversation: (id) => {
        set((state) => {
          const next = state.conversations.filter((c) => c.id !== id)
          let activeId = state.activeConversationId
          if (activeId === id) {
            // 切到最近的那个
            activeId = next.length > 0 ? next[0].id : null
            if (!activeId) {
              // 没有会话了，新建一个默认的
              const conv = createConversation()
              next.unshift(conv)
              activeId = conv.id
            }
          }
          return { conversations: next, activeConversationId: activeId }
        })
      },

      addChatMessage: (msg) =>
        set((state) => {
          let id = state.activeConversationId
          let nextConversations = state.conversations
          if (!id || !nextConversations.some((c) => c.id === id)) {
            const conv = createConversation(state.welcomeMessage || DEFAULT_WELCOME)
            nextConversations = [conv, ...nextConversations]
            id = conv.id
          }
          const list = nextConversations.map((c) => {
            if (c.id !== id) return c
            const msgs = [...c.messages, { ...msg, timestamp: Date.now() }]
            const title =
              c.title === '新对话' && msg.role === 'user'
                ? autoTitle(msg.content)
                : c.title
            return { ...c, messages: msgs, updatedAt: Date.now(), title }
          })
          list.sort((a, b) => b.updatedAt - a.updatedAt)
          return { conversations: list, activeConversationId: id }
        }),

      updateLastMessage: (content, artifacts) =>
        set((state) => {
          const id = state.activeConversationId
          if (!id) return state
          const list = state.conversations.map((c) => {
            if (c.id !== id) return c
            const msgs = [...c.messages]
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].role === 'assistant') {
                msgs[i] = { ...msgs[i], content, artifacts, timestamp: Date.now() }
                break
              }
            }
            return { ...c, messages: msgs, updatedAt: Date.now() }
          })
          return { conversations: list }
        }),

      clearCurrentChat: () =>
        set((state) => {
          let id = state.activeConversationId
          let nextConversations = state.conversations
          if (!id || !nextConversations.some((c) => c.id === id)) {
            const conv = createConversation(state.welcomeMessage || DEFAULT_WELCOME)
            nextConversations = [conv, ...nextConversations]
            id = conv.id
          }
          const welcomeContent = state.welcomeMessage || DEFAULT_WELCOME
          const welcomeMsg: ChatMessage = { role: 'assistant', content: welcomeContent, timestamp: Date.now() }
          const list = nextConversations.map((c) =>
            c.id === id ? { ...c, messages: [welcomeMsg], updatedAt: Date.now() } : c,
          )
          return { conversations: list, activeConversationId: id, activeIntent: 'idle' } as Partial<AppState>
        }),

      // ---- 动态欢迎语 ----
      welcomeMessage: DEFAULT_WELCOME,
      setWelcomeMessage: (msg) => set({ welcomeMessage: msg }),

      // ---- 计算属性（向后兼容）----
      get chatHistory() {
        const state = get()
        const conv = state.conversations.find(
          (c) => c.id === state.activeConversationId,
        )
        return conv?.messages ?? []
      },
    }),
    {
      name: 'dasheng-command-center-v2',
      partialize: (s) => ({
        conversations: s.conversations.map((c) => ({
          ...c,
          messages: c.messages.slice(-50), // 每个会话最多存 50 条
        })),
        activeConversationId: s.activeConversationId,
      }),
      // 首次加载时如果没有会话，创建一个默认的
      onRehydrateStorage: () => (state) => {
        // 2026-06-20: 每次加载重置意图，确保默认全宽聊天
        if (state) { (state as AppState).activeIntent = 'idle' }
        if (state) {
          const hasConversations = state.conversations && state.conversations.length > 0
          const hasActiveId = state.activeConversationId && hasConversations && state.conversations.some((c: Conversation) => c.id === state.activeConversationId)
          if (!hasActiveId) {
            // 要么没有会话，要么 activeConversationId 指向不存在的会话 → 创建默认
            const conv = createConversation()
            state.conversations = hasConversations ? [conv, ...state.conversations] : [conv]
            state.activeConversationId = conv.id
          }
        }
      },
    },
  ),
)
