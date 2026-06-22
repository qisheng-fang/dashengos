// apps/web/src/store/ui.ts · v0.3 spec §34.1
// UI 状态 (侧栏/右栏/主题/命令面板) · 用 Zustand persist 持久化部分

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type Theme = 'dark' | 'light' | 'system'

interface UIState {
  // 状态
  sidebarOpen: boolean
  rightPanelOpen: boolean
  theme: Theme
  cmdOpen: boolean
  // Actions
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
  setRightPanelOpen: (open: boolean) => void
  toggleRightPanel: () => void
  setTheme: (theme: Theme) => void
  setCmdOpen: (open: boolean) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      rightPanelOpen: false, // 2026-06-20: 默认隐藏，用户可手动打开
      theme: 'dark', // v0.3 spec §30.1 暗色优先
      cmdOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
      setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
      toggleRightPanel: () => set({ rightPanelOpen: !get().rightPanelOpen }),
      setTheme: (theme) => set({ theme }),
      setCmdOpen: (open) => set({ cmdOpen: open }),
    }),
    {
      name: 'dasheng-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, sidebarOpen: s.sidebarOpen }),
    },
  ),
)
