// apps/web/src/hooks/useIsMobile.ts · v0.3 Phase 5
// 简化 hook: 当前是不是 mobile (< 768px)
import { useBreakpoint } from './useBreakpoint'

export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile'
}
