import { createRootRoute, Outlet } from '@tanstack/react-router'
import { NotFound } from '@/components/NotFound'

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <NotFound />,
})
