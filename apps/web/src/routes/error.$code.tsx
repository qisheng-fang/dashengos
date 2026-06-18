// apps/web/src/routes/error.$code.tsx · v0.3 spec §32.10
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ErrorPage } from '@/screens/ErrorPage'

export const Route = createFileRoute('/error/$code')({
  parseParams: (params) => ({ code: z.string().parse(params.code) }),
  stringifyParams: ({ code }) => ({ code }),
  component: ErrorPage,
})
