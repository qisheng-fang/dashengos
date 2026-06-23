import type { FastifyInstance } from 'fastify'
import { getMultimodalCapability, fileToMultimodalInput, buildMultimodalMessage } from '../core/multimodal-bridge.js'
import { getActiveProvider } from '../providers/index.js'

export async function multimodalRoutes(app: FastifyInstance) {
  app.get('/capability', { preHandler: [app.authenticate] }, async (_req) => {
    const provider = getActiveProvider()
    return getMultimodalCapability(provider?.name || 'deepseek')
  })
  
  app.post('/build-message', { preHandler: [app.authenticate] }, async (req) => {
    const { text, filePaths } = req.body as any
    const provider = getActiveProvider()
    const inputs = (filePaths || []).map((fp: string) => fileToMultimodalInput(fp)).filter(Boolean)
    const cap = getMultimodalCapability(provider?.name || 'deepseek')
    const message = buildMultimodalMessage(text || '', inputs, provider?.name || 'deepseek')
    return { message, capability: cap }
  })
}
