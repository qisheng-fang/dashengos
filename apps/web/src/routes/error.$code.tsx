// apps/web/src/routes/error.$code.tsx · v0.3 spec §32.10
import { z } from 'zod'
import { ErrorPage } from '@/screens/ErrorPage'

,
  stringifyParams: ({ code }) => ({ code }),
  component: ErrorPage,
})
