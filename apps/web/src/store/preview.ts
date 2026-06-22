// apps/web/src/store/preview.ts · 2026-06-20
// 预览面板状态 — 任何组件可以推送内容到右侧预览面板

import { create } from 'zustand'

export interface PreviewItem {
  id: string
  type: 'text' | 'markdown' | 'image' | 'code' | 'html' | 'json'
  title: string
  content: string
  language?: string   // code 类型时指定语言
  timestamp: number
  source?: string     // 来源（如 'ima知识库', '工具调用', 'Agent输出'）
}

interface PreviewState {
  items: PreviewItem[]
  activeId: string | null
  push: (item: Omit<PreviewItem, 'id' | 'timestamp'>) => string
  clear: () => void
  remove: (id: string) => void
  setActive: (id: string | null) => void
}

let _counter = 0

export const usePreviewStore = create<PreviewState>((set, _get) => ({
  items: [],
  activeId: null,

  push: (item) => {
    const id = `prev_${Date.now()}_${++_counter}`
    const newItem: PreviewItem = { ...item, id, timestamp: Date.now() }
    set((s) => {
      const next = [newItem, ...s.items].slice(0, 20)
      return { items: next, activeId: id }
    })
    return id
  },

  clear: () => set({ items: [], activeId: null }),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id), activeId: s.activeId === id ? null : s.activeId })),
  setActive: (id) => set({ activeId: id }),
}))
