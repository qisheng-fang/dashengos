// packages/backend/src/api/browser.ts · Phase A.3 (2026-06-17)
// 浏览器自动化 REST API
// 前缀: /api/v1/browser
//
// 端点:
//   POST /navigate    — 导航到页面，返回 HTML + 文本
//   POST /screenshot  — 截图返回 base64 PNG
//   POST /extract     — 提取页面文本
//   POST /fill-form   — 填充表单并提交
//   GET  /status      — 检查 Playwright 是否可用

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  navigate,
  screenshot,
  extract,
  fillForm,
  getStatus,
  autoInjectCookies,
} from '../core/browser.js'

// ─── 请求体 Zod Schemas ─────────────────────────────────────────

const NavigateSchema = z.object({
  url: z.string().url().max(2048),
  cookies: z.string().max(8192).optional(),
  waitFor: z.string().max(256).optional(),
  timeout: z.number().min(1000).max(120_000).optional(),
  // Phase A.3: autoInject cookies from social_cookies table
  autoInjectSocial: z.boolean().default(false),
})

const ScreenshotSchema = z.object({
  url: z.string().url().max(2048),
  fullPage: z.boolean().default(true),
})

const ExtractSchema = z.object({
  url: z.string().url().max(2048),
  selector: z.string().max(512).optional(),
})

const FillFormSchema = z.object({
  url: z.string().url().max(2048),
  fields: z.record(z.string(), z.string()).refine(
    (obj) => Object.keys(obj).length > 0,
    { message: 'fields must not be empty' },
  ),
  submitSelector: z.string().max(256).optional(),
})

// ─── Routes ──────────────────────────────────────────────────────

export async function browserRoutes(app: FastifyInstance) {
  // POST /navigate — 导航到页面
  app.post('/navigate', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = NavigateSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
        details: parsed.error.issues,
      })
    }

    const { url, cookies, waitFor, timeout, autoInjectSocial } = parsed.data

    // 自动注入社媒 Cookie（从 social_cookies 表解密）
    let resolvedCookies = cookies
    if (autoInjectSocial && !resolvedCookies) {
      try {
        const { decrypt, getCookieEncryptionKey } = await import('../core/crypto.js')
        const row = (app as any).sqlite
          ?.prepare(
            'SELECT encrypted_value, platform FROM social_cookies WHERE user_id = ? ORDER BY updated_at DESC',
          )
          ?.all(req.user!.id) as Array<{ encrypted_value: string; platform: string }> | undefined
        if (row && row.length > 0) {
          const cookieMap: Record<string, string> = {}
          for (const r of row) {
            try {
              cookieMap[r.platform] = decrypt(r.encrypted_value, getCookieEncryptionKey())
            } catch { /* skip unreadable */ }
          }
          const match = autoInjectCookies(url, cookieMap)
          if (match) resolvedCookies = match
        }
      } catch {
        // Cookie 注入失败不阻塞请求
      }
    }

    try {
      const result = await navigate(url, {
        cookies: resolvedCookies,
        waitFor,
        timeout,
      })
      return reply.send(result)
    } catch (err: any) {
      return reply.code(503).send({
        code: 'BROWSER_ERROR',
        message: err.message ?? 'Browser operation failed',
      })
    }
  })

  // POST /screenshot — 截图
  app.post('/screenshot', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ScreenshotSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      })
    }

    try {
      const { buffer, mimeType } = await screenshot(parsed.data.url, {
        fullPage: parsed.data.fullPage,
      })
      return reply
        .header('Content-Type', mimeType)
        .send(buffer)
    } catch (err: any) {
      return reply.code(503).send({
        code: 'BROWSER_ERROR',
        message: err.message ?? 'Screenshot failed',
      })
    }
  })

  // POST /screenshot/base64 — 截图返回 base64
  app.post('/screenshot/base64', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ScreenshotSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      })
    }

    try {
      const { buffer } = await screenshot(parsed.data.url, {
        fullPage: parsed.data.fullPage,
      })
      return reply.send({
        url: parsed.data.url,
        mimeType: 'image/png',
        base64: buffer.toString('base64'),
        size: buffer.length,
      })
    } catch (err: any) {
      return reply.code(503).send({
        code: 'BROWSER_ERROR',
        message: err.message ?? 'Screenshot failed',
      })
    }
  })

  // POST /extract — 提取文本
  app.post('/extract', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = ExtractSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
      })
    }

    try {
      const text = await extract(parsed.data.url, parsed.data.selector)
      return reply.send({
        url: parsed.data.url,
        text,
        textLength: text.length,
      })
    } catch (err: any) {
      return reply.code(503).send({
        code: 'BROWSER_ERROR',
        message: err.message ?? 'Extract failed',
      })
    }
  })

  // POST /fill-form — 填充表单并提交
  app.post('/fill-form', { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = FillFormSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: parsed.error.issues[0]?.message ?? 'Invalid request',
        details: parsed.error.issues,
      })
    }

    try {
      const result = await fillForm(
        parsed.data.url,
        parsed.data.fields,
        parsed.data.submitSelector,
      )
      return reply.send(result)
    } catch (err: any) {
      return reply.code(503).send({
        code: 'BROWSER_ERROR',
        message: err.message ?? 'Form fill failed',
      })
    }
  })

  // GET /status — 检查浏览器可用性
  app.get('/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const status = getStatus()
    return reply.send(status)
  })
}
