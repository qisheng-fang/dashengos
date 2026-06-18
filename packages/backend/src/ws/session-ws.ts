// packages/backend/src/ws/session-ws.ts · v0.3 spec §11
// WebSocket /ws/sessions/:id · Phase 2 stub → Phase B.4 真鉴权
//
// Phase B.4 (2026-06-16) 安全修:
//   旧版 3 大漏洞: 1) token 在 URL (access_log 泄露)
//                   2) 无 jwt.verify (任何字符串当 token 都能连)
//                   3) 无 user↔session 绑定 (User A 可订阅 User B session)
//
//   新版: token 走 first message (浏览器可发, URL 不带)
//
// 协议:
//   client → server  connect
//   server → client  { type: 'auth_required' }
//   client → server  { type: 'auth', token: '<jwt>' }  (必须在 5s 内)
//   server → client  { type: 'auth_ok', user_id: '...' }  OR close(4401)
//   client → server  { type: 'session.ping' }  ← 心跳 (任意时刻)
//   client → server  { type: 'message.send', content: '...' }  ← Phase 3 接 LLM
//   server → client  { type: 'session.opened' | 'message.start' | 'content.delta' | '... }

import type { FastifyInstance } from 'fastify'
import websocket from '@fastify/websocket'
import jwt from 'jsonwebtoken'
import { sqlite } from '../storage/db.js'
import { config } from '../config.js'

const AUTH_TIMEOUT_MS = 5_000

interface JwtPayload {
  sub: string
  role?: string
  scope?: string
  iat?: number
  exp?: number
}

interface SessionRow {
  id: string
  user_id: string
  [k: string]: unknown
}

export async function sessionWSS(app: FastifyInstance) {
  await app.register(websocket)
  app.get('/ws/sessions/:id', { websocket: true }, (connection, req) => {
    const { id } = req.params as { id: string }

    // 1. 验证 session 存在 (提前查, 没 session 直接拒)
    const session = sqlite
      .prepare('SELECT id, user_id FROM sessions WHERE id = ?')
      .get(id) as SessionRow | undefined
    if (!session) {
      connection.socket.send(JSON.stringify({ type: 'error', code: 'SESSION_NOT_FOUND' }))
      connection.socket.close(4404, 'session not found')
      return
    }

    // 2. 立即要求 auth (发 auth_required 头, 等客户端 5s 内回 token)
    connection.socket.send(JSON.stringify({ type: 'auth_required', session_id: id }))

    let authenticated = false
    const authTimer = setTimeout(() => {
      if (!authenticated) {
        connection.socket.send(JSON.stringify({ type: 'error', code: 'AUTH_TIMEOUT' }))
        connection.socket.close(4401, 'auth timeout')
      }
    }, AUTH_TIMEOUT_MS)

    // 3. 心跳
    const ping = setInterval(() => {
      if (connection.socket.readyState === 1) {
        connection.socket.send(JSON.stringify({ type: 'session.pong', t: Date.now() }))
      } else {
        clearInterval(ping)
      }
    }, 30_000)

    // 4. 收消息
    connection.socket.on('message', (data: Buffer) => {
      let msg: { type: string; token?: string; content?: string }
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return // 静默丢非 JSON
      }

      // 4a. 第一步鉴权
      if (!authenticated) {
        if (msg.type !== 'auth' || !msg.token) {
          connection.socket.send(JSON.stringify({ type: 'error', code: 'AUTH_REQUIRED' }))
          connection.socket.close(4401, 'auth required')
          return
        }
        // jwt.verify
        let payload: JwtPayload
        try {
          payload = jwt.verify(msg.token, config.DASHENG_JWT_SECRET) as JwtPayload
        } catch {
          connection.socket.send(JSON.stringify({ type: 'error', code: 'AUTH_INVALID' }))
          connection.socket.close(4401, 'invalid token')
          return
        }
        // user↔session 绑定
        if (payload.sub !== session.user_id) {
          connection.socket.send(JSON.stringify({ type: 'error', code: 'AUTH_SESSION_MISMATCH' }))
          connection.socket.close(4403, 'token does not own this session')
          return
        }
        // 通过
        authenticated = true
        clearTimeout(authTimer)
        connection.socket.send(
          JSON.stringify({ type: 'auth_ok', user_id: payload.sub, session_id: id }),
        )
        return
      }

      // 4b. 已鉴权, 处理业务消息
      try {
        if (msg.type === 'session.ping') {
          connection.socket.send(JSON.stringify({ type: 'session.pong', t: Date.now() }))
        } else if (msg.type === 'message.send') {
          // Phase 2 stub: 回显
          const messageId = 'msg_' + Date.now()
          connection.socket.send(
            JSON.stringify({ type: 'message.start', message_id: messageId, role: 'assistant' }),
          )
          connection.socket.send(
            JSON.stringify({
              type: 'content.delta',
              message_id: messageId,
              delta: '(mock) Phase 3 接 DeerFlow 流式返回',
            }),
          )
        }
      } catch {
        /* silent */
      }
    })

    connection.socket.on('close', () => {
      clearTimeout(authTimer)
      clearInterval(ping)
    })
  })
}
