// apps/web/src/routes/_workspace.chats.$id.tsx · v0.3 spec §32.4 (对话页)
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Chat } from '@/screens/Chat'

export const Route = createFileRoute('/_workspace/chats/$id')({
  parseParams: (params) => ({ id: z.string().min(1).parse(params.id) }),
  stringifyParams: ({ id }) => ({ id }),
  component: Chat,
})
