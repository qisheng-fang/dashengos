// packages/backend/src/oauth/shopify.ts · D4-E Shopify Custom App 激活 (2026-06-18)
//  Shopify 不是标准 OAuth, 是 Custom App 模式:
//   1. 老板在 Shopify 后台 → Settings → Apps and sales channels → Develop apps
//   2. 创建 Custom App, 勾 Admin API access scopes (read_products, read_orders, read_inventory 等)
//   3. Install app → 拿到 Admin API access token (shpat_xxx 开头)
//   4. 在 DaShengOS 后台填 shop domain + token, 落到凭证池
//
//  凭证格式: { shop: "xxx.myshopify.com", access_token: "shpat_...", scopes: "read_products,..." }
//  测活: GET /admin/api/2024-04/shop.json

import type { PlatformAdapter, OAuthCredential } from './base.js'
import { saveState, saveCredential } from './base.js'
import { randomBytes } from 'node:crypto'

// 模拟 authorize 流程 - 实际不需要, 老板手动填 token
export const shopifyAdapter: PlatformAdapter = {
  platform: 'shopify',
  displayName: 'Shopify (爱尤趣)',

  start({ userId, redirectUri: _redirectUri }) {
    // Shopify 不走浏览器跳转, 跳到一个"输入 token"的页面
    const state = randomBytes(16).toString('hex')
    saveState({ state, userId, platform: 'shopify', redirectUri: '/settings/oauth', createdAt: Date.now() })
    return { url: `/settings/oauth?platform=shopify&state=${state}`, state }
  },

  async callback({ code, state, userId }) {
    // code 实际是 "shop:token" 格式, 由前端表单提交
    // 例: "aiyouqu.myshopify.com:shpat_xxxxx"
    const [shop, token] = code.split(':')
    if (!shop || !token) {
      throw new Error('shopify code 格式错误, 期望 shop:token')
    }
    if (!token.startsWith('shpat_') && !token.startsWith('shpca_') && !token.startsWith('shppa_')) {
      throw new Error('shopify access token 格式错误, 应以 shpat_/shpca_/shppa_ 开头')
    }
    const now = Date.now()
    return {
      platform: 'shopify',
      user_id: userId,
      access_token: token,
      openid: shop,                // 用 shop domain 当 openid
      scope: '',
      expires_at: 0,               // Custom App token 不过期
      raw: { shop, scopes: state },  // state 里暂存勾选的 scopes (前端传)
      created_at: now,
      updated_at: now,
    }
  },

  async test(cred) {
    if (!cred.openid || !cred.access_token) {
      return { ok: false, info: '缺少 shop domain 或 access token' }
    }
    try {
      const resp = await fetch(`https://${cred.openid}/admin/api/2024-04/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': cred.access_token,
          'Content-Type': 'application/json',
        },
      })
      if (!resp.ok) {
        const body = await resp.text()
        return { ok: false, info: `HTTP ${resp.status}: ${body.slice(0, 100)}` }
      }
      const data = (await resp.json()) as { shop?: { name?: string; domain?: string; plan_name?: string } }
      return {
        ok: true,
        info: `shop=${data.shop?.name ?? '?'}, domain=${data.shop?.domain}, plan=${data.shop?.plan_name}`,
      }
    } catch (e: any) {
      return { ok: false, info: e.message?.slice(0, 100) }
    }
  },
}

// 安装入口: 老板直接 POST token (不经过 state/callback 流程)
export async function installShopifyCustomApp(opts: {
  userId: string
  shop: string
  accessToken: string
  scopes?: string
}): Promise<OAuthCredential> {
  if (!opts.shop.endsWith('.myshopify.com')) {
    throw new Error('shop 必须是 xxx.myshopify.com 格式')
  }
  if (!opts.accessToken.startsWith('shpat_') && !opts.accessToken.startsWith('shpca_') && !opts.accessToken.startsWith('shppa_')) {
    throw new Error('access token 格式错误, 应以 shpat_/shpca_/shppa_ 开头')
  }
  const now = Date.now()
  const cred: OAuthCredential = {
    platform: 'shopify',
    user_id: opts.userId,
    access_token: opts.accessToken,
    openid: opts.shop,
    scope: opts.scopes ?? '',
    expires_at: 0,
    raw: { install_method: 'custom_app', shop: opts.shop },
    created_at: now,
    updated_at: now,
  }
  saveCredential(cred)
  return cred
}
