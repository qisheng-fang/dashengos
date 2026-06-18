// apps/web/src/routes/_workspace.skills.$id.tsx · v0.3 spec §32.6 (Skill 详情)
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SkillDetail } from '@/screens/SkillDetail'

export const Route = createFileRoute('/_workspace/skills/$id')({
  parseParams: (params) => ({ id: z.string().min(1).parse(params.id) }),
  stringifyParams: ({ id }) => ({ id }),
  component: SkillDetail,
})
