// apps/web/src/routes/login.tsx · v0.3 spec §32.2
import { createFileRoute } from '@tanstack/react-router'
import { Login } from '@/screens/Login'

export const Route = createFileRoute('/login')({
  component: Login,
})
