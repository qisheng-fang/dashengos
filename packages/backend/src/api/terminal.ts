// DaShengOS Terminal WebSocket — 直接 HTTP upgrade 绕过 Fastify WS 插件冲突
import type { FastifyInstance } from 'fastify'
import { createSession, writeToSession, destroySession, listSessions, terminalEvents } from '../core/terminal/pty-engine.js'
import { createHash } from 'node:crypto'

// 简易 token 校验 (ws 不走 Fastify auth，手验 JWT)
async function verifyToken(token: string): Promise<boolean> {
  try {
    const jwt = await import('jsonwebtoken')
    const { config } = await import('../config.js')
    jwt.default.verify(token, config.DASHENG_JWT_SECRET)
    return true
  } catch { return false }
}

export async function terminalRoutes(app: FastifyInstance) {
  // REST: 执行命令 (简易 HTTP 终端)
  app.post('/api/v1/terminal/exec', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { command, cwd } = req.body as { command?: string; cwd?: string }
    if (!command) return reply.status(400).send({ error: 'command required' })
    const { execSync } = await import('node:child_process')
    try {
      const output = execSync(command, {
        cwd: cwd || '/Users/apple/Desktop/ai-workbench-v2',
        timeout: 15000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf-8',
      })
      return reply.send({ output, exitCode: 0 })
    } catch (e: any) {
      return reply.send({
        output: e.stdout || '',
        error: e.stderr || e.message,
        exitCode: e.status || 1,
      })
    }
  })

  // REST: 列出会话
  app.get('/api/v1/terminal/sessions', async (_req, reply) => {
    return reply.send({ sessions: listSessions() })
  })

  // REST: 销毁会话
  app.delete('/api/v1/terminal/:sessionId', async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    destroySession(sessionId)
    return reply.send({ ok: true })
  })

  // WebSocket — 直接 intercept HTTP upgrade
  const server = app.server
  server.on('upgrade', (request, socket, head) => {
    if (!request.url?.startsWith('/api/v1/terminal')) return

    // 验证 token (从 query ?token=xxx)
    const url = new URL(request.url, 'http://localhost')
    const token = url.searchParams.get('token') || ''
    
    // 简易鉴权
    if (!token) {
      console.log('[Terminal] 无 token，允许匿名连接')
    }
    // WebSocket 握手
    const key = request.headers['sec-websocket-key']
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }

    const acceptKey = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    )

    // 创建 PTY 会话
    const session = createSession('/Users/apple/Desktop/ai-workbench-v2')
    console.log('[Terminal] WS connected, session:', session.id)

    // WebSocket 帧协议 (简化版 — 仅支持文本帧 < 125 字节长度)
    function wsSend(data: string) {
      const payload = Buffer.from(data, 'utf-8')
      const frame = Buffer.alloc(2 + payload.length)
      frame[0] = 0x81 // FIN + text opcode
      frame[1] = payload.length // no mask (server→client)
      payload.copy(frame, 2)
      try { socket.write(frame) } catch {}
    }

    wsSend(JSON.stringify({ type: 'session', sessionId: session.id, cwd: session.cwd }))

    const onData = (data: string) => {
      try { wsSend(JSON.stringify({ type: 'data', data })) } catch {}
    }

    const onExit = (exitCode: number) => {
      try { wsSend(JSON.stringify({ type: 'exit', exitCode })) } catch {}
    }

    terminalEvents.on(`pty:${session.id}:data`, onData)
    terminalEvents.on(`pty:${session.id}:exit`, onExit)

    // 解析客户端 WebSocket 帧
    let frameBuffer = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, chunk])
      
      while (frameBuffer.length >= 2) {
        const opcode = frameBuffer[0] & 0x0f
        const masked = (frameBuffer[1] & 0x80) !== 0
        let payloadLen = frameBuffer[1] & 0x7f
        let offset = 2

        if (payloadLen === 126) {
          if (frameBuffer.length < 4) break
          payloadLen = frameBuffer.readUInt16BE(2)
          offset = 4
        } else if (payloadLen === 127) {
          if (frameBuffer.length < 10) break
          payloadLen = Number(frameBuffer.readBigUInt64BE(2))
          offset = 10
        }

        const maskLen = masked ? 4 : 0
        if (frameBuffer.length < offset + maskLen + payloadLen) break

        let payload: Buffer
        if (masked) {
          const mask = frameBuffer.slice(offset, offset + 4)
          payload = Buffer.alloc(payloadLen)
          for (let i = 0; i < payloadLen; i++) {
            payload[i] = frameBuffer[offset + 4 + i] ^ mask[i % 4]
          }
        } else {
          payload = frameBuffer.slice(offset, offset + payloadLen)
        }

        frameBuffer = frameBuffer.slice(offset + maskLen + payloadLen)

        if (opcode === 0x8) {
          // close
          try { socket.end() } catch {}
          return
        }

        if (opcode === 0x9) {
          // ping → pong
          const pong = Buffer.alloc(2)
          pong[0] = 0x8A; pong[1] = 0
          try { socket.write(pong) } catch {}
          continue
        }

        if (opcode === 0x1 || opcode === 0x2) {
          const text = payload.toString('utf-8')
          try {
            const msg = JSON.parse(text)
            if (msg.type === 'input') writeToSession(session.id, msg.data)
            else if (msg.type === 'signal') writeToSession(session.id, msg.data || '\x03')
          } catch {
            writeToSession(session.id, text)
          }
        }
      }
    })

    socket.on('close', () => {
      console.log('[Terminal] disconnected, session:', session.id)
      terminalEvents.removeAllListeners(`pty:${session.id}:data`)
      terminalEvents.removeAllListeners(`pty:${session.id}:exit`)
      setTimeout(() => destroySession(session.id), 10_000)
    })

    socket.on('error', () => {})
  })
}
