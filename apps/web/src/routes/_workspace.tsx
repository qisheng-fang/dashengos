// apps/web/src/routes/_workspace.tsx
// Shell 提供 h-screen flex flex-col → 内容区 flex-1
// 这里只需填满父容器高度
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_workspace')({
  component: () => <Outlet />,
})
