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

const WELCOME_MSG: ChatMessage = {
  role: 'assistant',
  content:
    '欢迎登录 DaShengOS 指挥中心。\n\n直接告诉我你想做什么，或输入 / 查看快捷指令：\n\n• /模特 — 数字人与视觉资产生成\n• /部署 — S2B2C 跨境架构部署\n• /内容 — 私域内容与 SOP 规划\n\n也可以直接描述需求，我会自动调度。',
  timestamp: Date.now(),
}

/** 从首条用户消息生成标题（截断 + 去空白） */
function autoTitle(msg: string): string {
  const trimmed = msg.trim().replace(/\n/g, ' ').slice(0, 40)
  return trimmed || '新对话'
}

/** 创建新会话 */
function createConversation(): Conversation {
  const id = `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  return {
    id,
    title: '新对话',
    threadId: `cc_${Date.now().toString(36)}`,
    messages: [{ ...WELCOME_MSG }],
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

  // ---- 兼容旧代码的计算属性 ----
  /** 当前会话的消息列表（向后兼容 chatHistory） */
  chatHistory: ChatMessage[]
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

      // ---- 会话操作 ----
      newConversation: () => {
        const conv = createConversation()
        set((state) => ({
          conversations: [conv, ...state.conversations],
          activeConversationId: conv.id,
          activeIntent: 'idle',
        }))
        return conv.id
      },

      switchConversation: (id) => {
        set({ activeConversationId: id, activeIntent: 'idle' })
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
          const id = state.activeConversationId
          if (!id) return state
          const list = state.conversations.map((c) => {
            if (c.id !== id) return c
            const msgs = [...c.messages, { ...msg, timestamp: Date.now() }]
            // 自动从第一条 user 消息更新标题
            const title =
              c.title === '新对话' && msg.role === 'user'
                ? autoTitle(msg.content)
                : c.title
            return { ...c, messages: msgs, updatedAt: Date.now(), title }
          })
          // 按 updated_at 排序
          list.sort((a, b) => b.updatedAt - a.updatedAt)
          return { conversations: list }
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
          const id = state.activeConversationId
          if (!id) return state
          const list = state.conversations.map((c) =>
            c.id === id ? { ...c, messages: [{ ...WELCOME_MSG }] } : c,
          )
          return { conversations: list, activeIntent: 'idle' }
        }),

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
