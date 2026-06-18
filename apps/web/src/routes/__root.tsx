// apps/web/src/routes/__root.tsx · v0.3 spec §34
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
})
