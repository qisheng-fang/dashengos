// apps/web/src/lib/query.ts · v0.3 spec §34.5
// TanStack Query client 单例 (Phase 1 暂用, Phase 2 接真 backend)

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s 内不重新 fetch
      gcTime: 5 * 60_000, // 5min 后清理
      retry: 1, // 失败重试 1 次
      refetchOnWindowFocus: true, // 切回窗口自动刷新
    },
    mutations: { retry: 0 }, // 写操作不重试
  },
})
