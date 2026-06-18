// apps/web/src/store/command.ts · v0.3 spec §33.5
// Cmd+K 命令面板状态 (open + recent items)

import { create } from 'zustand'

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string[] // ['cmd', 'shift', 'o']
  group: 'session' | 'agent' | 'skill' | 'settings' | 'nav'
  onSelect: () => void
  keywords?: string[]
  disabled?: boolean
}

interface CommandState {
  recentIds: string[]
  pushRecent: (id: string) => void
  clearRecent: () => void
}

const MAX_RECENT = 8

export const useCommandStore = create<CommandState>((set, get) => ({
  recentIds: [],
  pushRecent: (id) => {
    const cur = get().recentIds.filter((x) => x !== id)
    set({ recentIds: [id, ...cur].slice(0, MAX_RECENT) })
  },
  clearRecent: () => set({ recentIds: [] }),
}))
