// packages/backend/src/api/astrbot.ts · DaShengOS v6.0
import type { FastifyInstance } from 'fastify'
import { getAstrBotStatus, launchAstrBot, ASTRBOT_TOOLS } from '../core/tools/astrbot-bridge.js'

export async function astrbotRoutes(app: FastifyInstance) {
  app.get('/status', async (_req, reply) => {
    return reply.send(getAstrBotStatus())
  })
  app.post('/launch', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send(await launchAstrBot())
  })
  app.get('/tools', async (_req, reply) => {
    return reply.send({ tools: ASTRBOT_TOOLS })
  })

  // Desktop app status
  app.get('/desktop-status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const { existsSync } = await import('node:fs')
    const installed = existsSync('/Users/apple/Desktop/ai-workbench-astrbot-desktop/src-tauri/Cargo.toml')
      || existsSync('/Users/apple/Desktop/AstrBot.app') || existsSync('/Applications/AstrBot.app')
      || existsSync('/Users/apple/Desktop/AstrBot-desktop-macos.tar.gz')
    return reply.send({ installed })
  })

  // Launch desktop app
  app.post('/launch-desktop', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const { spawn, execSync } = await import('node:child_process')
    const { existsSync } = await import('node:fs')
    
    const appPath = existsSync('/Users/apple/Desktop/AstrBot.app') ? '/Users/apple/Desktop/AstrBot.app' : '/Applications/AstrBot.app'
    if (existsSync(appPath)) {
      spawn('open', [appPath], { detached: true, stdio: 'ignore' }).unref()
      return reply.send({ success: true, message: 'AstrBot Desktop 已启动' })
    }
    
    const dirs = execSync('ls -d /Users/apple/Desktop/ai-workbench-astrbot-desktop/*.app 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim()
    if (dirs) {
      spawn('open', [dirs.split('\n')[0]], { detached: true, stdio: 'ignore' }).unref()
      return reply.send({ success: true, message: 'AstrBot Desktop 已启动' })
    }
    
    return reply.send({ success: false, error: 'AstrBot Desktop 未安装，请先下载' })
  })
}
