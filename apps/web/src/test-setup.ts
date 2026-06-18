// apps/web/src/test-setup.ts · Vitest setup
import '@testing-library/jest-dom/vitest'
import '@/i18n' // 初始化 i18next (screens 用 useTranslation 必须有 i18n 实例)

// jsdom 没实现 ResizeObserver/MatchMedia, Radix UI + 响应式 hooks 依赖
// v0.3 PR7 — axe 测试要能 mount 整个 Shell
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
