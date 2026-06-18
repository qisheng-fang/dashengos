// packages/backend/src/api/oauth.ts · D4 路由 (2026-06-18)
// 5 个端点:
//   GET  /api/v1/oauth/:platform/start      → 302 跳转到平台授权页 (或 shopify 输入页)
//   GET  /api/v1/oauth/:platform/callback   → 处理 code 回调, 落凭证
//   GET  /api/v1/oauth/status                → 列出当前用户已连接平台
//   POST /api/v1/oauth/:platform/test       → 测活某个平台凭证
//   POST /api/v1/oauth/:platform/disconnect  → 断开平台连接
//   POST /api/v1/oauth/shopify/install      → Shopify Custom App 直接安装 (不走 OAuth)
//
// ⚠️  老板当前工作台只有 admin 账号, 不走 user_id 鉴权 (D4-A 暂未接前端, 写死 user_id='admin')

import type { FastifyInstance } from 'fastify'
import {
  getAdapter,
  consumeState,
  saveCredential,
  loadCredential,
  deleteCredential,
  listAllCredentials,
  type OAuthPlatform,
} from '../oauth/base.js'
import { registerAllAdapters } from '../oauth/index.js'
import { installShopifyCustomApp } from '../oauth/shopify.js'
import { bridgeWechatMpToVideo } from '../oauth/video.js'

// 老板单人工作台, 临时写死
const DEFAULT_USER_ID = 'admin'

// 平台名白名单 (URL 路径用)
const PLATFORMS: OAuthPlatform[] = ['wechat_mp', 'feishu', 'wechat_video', 'shopify']

export async function oauthRoutes(app: FastifyInstance) {
  // 启动时注册适配器
  registerAllAdapters()

  // 列出所有已注册平台 (不暴露凭证) — D6-2 鉴权要求
  app.get('/api/v1/oauth/platforms', { preHandler: [app.authenticate] }, async () => {
    const platforms = PLATFORMS.map((p) => {
      const adapter = getAdapter(p)
      return {
        platform: p,
        displayName: adapter?.displayName ?? p,
        // 平台是否配置了 appid/secret
        configured: isPlatformConfigured(p),
      }
    })
    return { platforms, total: platforms.length }
  })

  // 列出当前用户已连接的凭证状态 — D6-2 鉴权
  app.get('/api/v1/oauth/status', { preHandler: [app.authenticate] }, async (req) => {
    // D6-2: 用真实用户, 不再写死
    const userId = req.user?.id ?? DEFAULT_USER_ID
    const all = listAllCredentials().filter((c) => c.user_id === userId)
    const connections = PLATFORMS.map((p) => {
      const cred = all.find((c) => c.platform === p)
      if (!cred) {
        return { platform: p, connected: false }
      }
      return {
        platform: p,
        displayName: getAdapter(p)?.displayName ?? p,
        connected: true,
        openid: cred.openid ? cred.openid.slice(0, 12) + (cred.openid.length > 12 ? '...' : '') : undefined,
        unionid: cred.unionid?.slice(0, 12),
        expires_at: cred.expires_at || undefined,
        updated_at: cred.updated_at,
        // 凭证快过期 (24h 内) 提示
        expiring_soon: cred.expires_at ? cred.expires_at - Date.now() < 24 * 60 * 60 * 1000 : false,
      }
    })
    return {
      user_id: userId,
      connections,
      connected_count: connections.filter((c) => c.connected).length,
      total: PLATFORMS.length,
    }
  })

  // 启动 OAuth 流程 — 公开 (浏览器跳到第三方授权, 拿不到 token)
  //   老板点"连接微信公众号"时浏览器直接 GET 这个 URL, 走微信 OAuth
  //   不强制鉴权: 因为前端 OAuthManager 还没登录就跳了; 真实鉴权在 callback 写凭证时做
  app.get('/api/v1/oauth/:platform/start', async (req, reply) => {
    const { platform } = req.params as { platform: OAuthPlatform }
    if (!PLATFORMS.includes(platform)) {
      return reply.code(400).send({ error: `unknown platform: ${platform}` })
    }
    // D6-2: callback 时拿 token 校验
    // 暂时写死 admin, callback 路由会改
    // 后续: start 时给用户签个临时 token, callback 时校验
    const adapter = getAdapter(platform)
    if (!adapter) {
      return reply.code(500).send({ error: 'adapter not registered' })
    }
    try {
      const { url, state } = adapter.start({
        userId: DEFAULT_USER_ID,
        redirectUri: (req.query as any).redirect_uri,
      })
      app.log.info({ platform, state: state.slice(0, 8) }, '[oauth] start')
      // 视频号桥 - 直接走 302 到 wechat_mp start
      if (url.startsWith('/')) {
        return reply.code(302).redirect(url)
      }
      return reply.code(302).redirect(url)
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  // 回调
  app.get('/api/v1/oauth/:platform/callback', async (req, reply) => {
    const { platform } = req.params as { platform: OAuthPlatform }
    if (!PLATFORMS.includes(platform)) {
      return reply.code(400).send({ error: `unknown platform: ${platform}` })
    }
    const q = req.query as { code?: string; state?: string; shop?: string; error?: string }
    if (q.error) {
      return reply.code(400).send({ error: q.error, description: (q as any).error_description })
    }
    if (!q.code || !q.state) {
      return reply.code(400).send({ error: 'missing code or state' })
    }
    const stateRec = consumeState(q.state)
    if (!stateRec) {
      return reply.code(400).send({ error: 'invalid or expired state (10min TTL)' })
    }
    const adapter = getAdapter(platform)
    if (!adapter) {
      return reply.code(500).send({ error: 'adapter not registered' })
    }
    try {
      const cred = await adapter.callback({
        code: q.code,
        state: q.state,
        userId: stateRec.userId,
        redirectUri: stateRec.redirectUri,
      })
      saveCredential(cred)
      app.log.info({ platform, user: stateRec.userId, openid: cred.openid?.slice(0, 8) }, '[oauth] connected')
      // 视频号桥 - 自动同步 wechat_mp → wechat_video
      if (platform === 'wechat_mp') {
        bridgeWechatMpToVideo(stateRec.userId)
      }
      // 跳回前端成功页
      return reply
        .code(302)
        .redirect(`/settings/oauth?connected=${platform}&ok=1`)
    } catch (e: any) {
      app.log.error({ err: e.message, platform }, '[oauth] callback failed')
      return reply.code(500).send({ error: e.message })
    }
  })

  // Shopify 直接安装 (不走浏览器) — D6-2 鉴权
  app.post('/api/v1/oauth/shopify/install', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = req.user?.id ?? DEFAULT_USER_ID
    const body = (req.body ?? {}) as { shop?: string; access_token?: string; scopes?: string }
    if (!body.shop || !body.access_token) {
      return reply.code(400).send({ error: '缺少 shop 或 access_token', received_keys: Object.keys(body) })
    }
    try {
      const cred = await installShopifyCustomApp({
        userId,  // D6-2: 用真实用户
        shop: body.shop,
        accessToken: body.access_token,
        scopes: body.scopes,
      })
      app.log.info({ shop: body.shop, user: DEFAULT_USER_ID }, '[oauth] shopify installed')
      return {
        ok: true,
        platform: 'shopify',
        shop: cred.openid,
        installed_at: cred.created_at,
        message: 'Custom App token 已保存, 后续 API 调用会自动用此凭证',
      }
    } catch (e: any) {
      return reply.code(400).send({ error: e.message })
    }
  })

  // 测活 — D6-2 鉴权
  app.post('/api/v1/oauth/:platform/test', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { platform } = req.params as { platform: OAuthPlatform }
    if (!PLATFORMS.includes(platform)) {
      return reply.code(400).send({ error: `unknown platform: ${platform}` })
    }
    const userId = req.user?.id ?? DEFAULT_USER_ID
    const cred = loadCredential(platform, userId)
    if (!cred) {
      return reply.code(404).send({ ok: false, error: 'not connected' })
    }
    const adapter = getAdapter(platform)
    if (!adapter) {
      return reply.code(500).send({ error: 'adapter not registered' })
    }
    try {
      const result = await adapter.test(cred)
      return { platform, ...result, tested_at: Date.now() }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // 断开 — D6-2 鉴权
  app.post('/api/v1/oauth/:platform/disconnect', { preHandler: [app.authenticate] }, async (req, reply) => {
    const { platform } = req.params as { platform: OAuthPlatform }
    if (!PLATFORMS.includes(platform)) {
      return reply.code(400).send({ error: `unknown platform: ${platform}` })
    }
    const userId = req.user?.id ?? DEFAULT_USER_ID
    const deleted = deleteCredential(platform, userId)
    app.log.info({ platform, user: DEFAULT_USER_ID, deleted }, '[oauth] disconnect')
    return { ok: true, platform, deleted }
  })
}

// 平台配置检查
function isPlatformConfigured(platform: OAuthPlatform): boolean {
  switch (platform) {
    case 'wechat_mp':
    case 'wechat_video':
      return !!(process.env.WECHAT_MP_APPID && process.env.WECHAT_MP_SECRET)
    case 'feishu':
      return !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
    case 'shopify':
      return true // Shopify 不需要预配, 老板填 token
  }
}
