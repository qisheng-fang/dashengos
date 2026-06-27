// DaShengOS v6.1 — Window Manager API
// Hermes alignment: native macOS window control
import type { FastifyInstance } from 'fastify'
import {
  listWindows, focusWindow, moveWindow,
  minimizeWindow, closeWindow,
  LAYOUT_PRESETS, getScreenInfo, floatDaShengOS,
} from '../core/window-manager.js'

export async function windowRoutes(app: FastifyInstance) {
  // GET /windows — 列出所有可见窗口
  app.get('/windows', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { app } = req.query as { app?: string }
    return reply.send(listWindows(app))
  })

  // POST /windows/focus — 聚焦窗口
  app.post('/windows/focus', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { appName, windowName } = req.body as { appName: string; windowName?: string }
    if (!appName) return reply.code(400).send({ error: 'appName required' })
    return reply.send(focusWindow(appName, windowName))
  })

  // POST /windows/move — 移动/缩放窗口
  app.post('/windows/move', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { appName, x, y, w, h } = req.body as { appName: string; x: number; y: number; w?: number; h?: number }
    if (!appName || x === undefined || y === undefined) {
      return reply.code(400).send({ error: 'appName, x, y required' })
    }
    return reply.send(moveWindow(appName, x, y, w, h))
  })

  // POST /windows/minimize — 最小化
  app.post('/windows/minimize', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { appName } = req.body as { appName: string }
    if (!appName) return reply.code(400).send({ error: 'appName required' })
    return reply.send(minimizeWindow(appName))
  })

  // POST /windows/close — 关闭窗口
  app.post('/windows/close', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { appName, windowName } = req.body as { appName: string; windowName?: string }
    if (!appName) return reply.code(400).send({ error: 'appName required' })
    return reply.send(closeWindow(appName, windowName))
  })

  // GET /windows/layouts — 预设布局
  app.get('/windows/layouts', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send({
      layouts: LAYOUT_PRESETS.map(l => ({ name: l.name, description: l.description })),
    })
  })

  // POST /windows/layouts/:name — 应用布局
  app.post('/windows/layouts/:name', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { name } = req.params as { name: string }
    const layout = LAYOUT_PRESETS.find(l => l.name === name)
    if (!layout) return reply.code(404).send({ error: `Layout '${name}' not found` })
    const ok = layout.apply()
    return reply.send({ ok, layout: name })
  })

  // GET /windows/screen — 屏幕信息
  app.get('/windows/screen', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send(getScreenInfo())
  })

  // POST /windows/float — 浮动 DaShengOS 窗口
  app.post('/windows/float', { preHandler: [app.authenticate] }, async (_req, reply) => {
    return reply.send(floatDaShengOS())
  })
}
