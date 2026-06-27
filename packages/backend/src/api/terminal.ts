// DaShengOS Terminal · Hermes 对齐 · 独立 WS Server + node-pty
import type { FastifyInstance } from 'fastify'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { createSession, writeToSession, destroySession, listSessions, terminalEvents, resizeSession, execPTY } from '../core/terminal/pty-engine.js'

// 独立 HTTP server 专用于 WebSocket，避免与 Fastify 升级冲突
let wss: WebSocketServer | null = null

function getWSS(): WebSocketServer {
  if (!wss) {
    const httpServer = createServer((_req, res) => {
      res.writeHead(200)
      res.end('DaShengOS Terminal WS')
    })
    wss = new WebSocketServer({ server: httpServer })
    
    httpServer.listen(8001, '127.0.0.1', () => {
      console.log('[Terminal] WS server on :8001')
    })

    wss.on('connection', (ws) => {
      handleTerminalWS(ws)
    })
  }
  return wss
}

export async function terminalRoutes(app: FastifyInstance) {
  // 确保 WS server 启动
  getWSS()

  // POST /exec — 单次命令
  app.post('/api/v1/terminal/exec', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { command, cwd } = req.body as { command?: string; cwd?: string }
    if (!command) return reply.status(400).send({ error: 'command required' })
    try {
      const result = await execPTY(command, cwd || '/Users/apple/Desktop/ai-workbench-v2', 30000)
      return reply.send({ output: result.output, exitCode: result.exitCode, durationMs: result.durationMs })
    } catch (e: any) {
      return reply.send({ output: '', error: e.message, exitCode: 1 })
    }
  })

  app.get('/api/v1/terminal/sessions', async (_req, reply) => {
    return reply.send({ sessions: listSessions() })
  })

  app.delete('/api/v1/terminal/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    destroySession(sessionId)
    return reply.send({ ok: true })
  })
}

function handleTerminalWS(ws: WebSocket) {
  const session = createSession('/Users/apple/Desktop/ai-workbench-v2')
  console.log('[Terminal] PTY connected, session:', session.id)

  const send = (data: Record<string, any>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  send({ type: 'session', sessionId: session.id, cwd: session.cwd })

  const onData = (data: string) => send({ type: 'data', data })
  const onExit = (exitCode: number) => {
    send({ type: 'exit', exitCode })
    ws.close()
  }

  terminalEvents.on(`pty:${session.id}:data`, onData)
  terminalEvents.on(`pty:${session.id}:exit`, onExit)

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'input') writeToSession(session.id, msg.data)
      else if (msg.type === 'resize') resizeSession(session.id, msg.cols || 120, msg.rows || 40)
    } catch {
      writeToSession(session.id, raw.toString())
    }
  })

  ws.on('close', () => {
    console.log('[Terminal] disconnected, session:', session.id)
    terminalEvents.removeListener(`pty:${session.id}:data`, onData)
    terminalEvents.removeListener(`pty:${session.id}:exit`, onExit)
    setTimeout(() => destroySession(session.id), 10_000)
  })

  ws.on('error', () => {})
}
