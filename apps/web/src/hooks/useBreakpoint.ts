// apps/web/src/hooks/useBreakpoint.ts · v0.3 spec §31.3
// 响应式断点 hook · mobile < 768 / tablet 768-1280 / desktop 1280-1920 / wide ≥ 1920
import { useEffect, useState } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide'

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>('desktop')

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w >= 1920) setBp('wide')
      else if (w >= 1280) setBp('desktop')
      else if (w >= 768) setBp('tablet')
      else setBp('mobile')
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return bp
}
