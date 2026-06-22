// packages/backend/src/api/preview.ts · 2026-06-20
// 预览代理路由 — 前端 RightPanel 预览 Tab 获取 ima 内容

import type { FastifyInstance } from 'fastify'
import { resolvePreview } from '../core/preview-proxy.js'

export async function previewRoutes(app: FastifyInstance) {
  app.post<{ Body: { type: string; mediaId?: string; noteId?: string } }>(
    '/api/v1/preview/resolve',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['ima_kb_item', 'ima_note'] },
            mediaId: { type: 'string' },
            noteId: { type: 'string' },
          },
          required: ['type'],
        },
      },
    },
    async (request, reply) => {
      const { type, mediaId, noteId } = request.body
      const result = await resolvePreview({ type: type as 'ima_kb_item' | 'ima_note', mediaId, noteId })
      if (!result) {
        return reply.status(404).send({ error: '无法解析预览内容' })
      }
      return reply.send(result)
    },
  )
}
