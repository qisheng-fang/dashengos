import { createFileRoute } from '@tanstack/react-router'
import { SkillsMarket } from '../screens/SkillsMarket'

export const Route = createFileRoute('/_workspace/skills')({
  component: SkillsMarket,
})
