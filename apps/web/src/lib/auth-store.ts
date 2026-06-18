// apps/web/src/lib/auth-store.ts · v0.3 Phase 5+
//
// Zustand store for the current user + JWT tokens. Persists to
// localStorage so the user stays logged in across page reloads.
//
// In Phase 6 this should be encrypted with a short-lived key, but
// for the v0.3 scaffold localStorage is fine (XSS-prevention via
// Content-Security-Policy + strict sandbox iframe).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  username: string
  email?: string
  role: 'ADMIN' | 'USER' | 'GUEST'
  avatar?: string
  provider?: 'local' | 'google' | 'github' | 'microsoft' | 'feishu' | 'dingtalk'
}

export interface AuthTokens {
  access: string
  refresh: string
  expiresAt: number
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  isAuthenticated: () => boolean
  setUser: (u: AuthUser | null) => void
  setTokens: (t: AuthTokens) => void
  setSession: (u: AuthUser, t: AuthTokens) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      isAuthenticated: () => {
        const { accessToken, expiresAt } = get()
        if (!accessToken) return false
        if (expiresAt && Date.now() > expiresAt) return false
        return true
      },
      setUser: (u) => set({ user: u }),
      setTokens: (t) =>
        set({
          accessToken: t.access,
          refreshToken: t.refresh,
          expiresAt: t.expiresAt,
        }),
      setSession: (u, t) =>
        set({
          user: u,
          accessToken: t.access,
          refreshToken: t.refresh,
          expiresAt: t.expiresAt,
        }),
      clear: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
        }),
    }),
    {
      name: 'dasheng-auth',
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        expiresAt: s.expiresAt,
      }),
    },
  ),
)
