import { createFileRoute } from '@tanstack/react-router'
import { Transformers } from '../screens/Transformers'

export const Route = createFileRoute('/_workspace/transformers')({
  component: Transformers,
})
