import { createFileRoute } from '@tanstack/react-router'
import { AstrBot } from '../screens/AstrBot'

export const Route = createFileRoute('/_workspace/astrbot')({
  component: AstrBot,
})
