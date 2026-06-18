// apps/web/src/routes/_workspace.tsx · v0.3 spec §31
// Phase 调试: Shell组件有问题，先绕过测试路由树
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_workspace')({
  component: () => (
    <div className="h-screen bg-neutral-950 text-neutral-100 flex flex-col">
      <header className="h-14 border-b border-neutral-800 flex items-center px-4 flex-shrink-0">
        <span className="font-bold text-brand">DaShengOS v0.3</span>
        <span className="ml-auto text-xs text-neutral-500">workspace</span>
      </header>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  ),
})
