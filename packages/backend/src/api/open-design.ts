import type { FastifyInstance } from 'fastify'
import { getODStatus, startOD, stopOD, listDesignSystems, listCraftCommands, generateDesign, listODOutputs } from '../core/open-design-bridge.js'

export async function openDesignRoutes(app: FastifyInstance) {
  app.get('/status', { preHandler: [app.authenticate] }, async () => getODStatus())
  app.post('/start', { preHandler: [app.authenticate] }, async () => startOD())
  app.post('/stop', { preHandler: [app.authenticate] }, async () => stopOD())
  app.get('/systems', { preHandler: [app.authenticate] }, async () => listDesignSystems())
  app.get('/craft', { preHandler: [app.authenticate] }, async () => listCraftCommands())
  app.post('/generate', { preHandler: [app.authenticate] }, async (req) => {
    const opts = req.body as any
    return generateDesign(opts)
  })
  app.get('/outputs', { preHandler: [app.authenticate] }, async () => {
    return { files: listODOutputs().data }
  })
}
