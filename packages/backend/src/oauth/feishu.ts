// packages/backend/src/oauth/feishu.ts · D4-C 飞书 OAuth (2026-06-18)
//  授权 URL: https://open.feishu.cn/open-apis/authen/v1/index
//  scope: 固定 "contact:user.id:readonly" 拿 user_id (必须先在开发者后台勾这个权限)
//  token URL: https://open.feishu.cn/open-apis/authen/v1/access_token
//  refresh URL: https://open.feishu.cn/open-apis/authen/v1/refresh_access_token
//
//  必备环境变量: FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_REDIRECT_URI
//  飞书开放平台 → 开发者后台 → 应用 → 凭证

import { randomBytes } from 'node:crypto'
import type { PlatformAdapter, OAuthCredential } from './base.js'
import { saveState } from './base.js'

const APP_ID = process.env.FEISHU_APP_ID || ''
const APP_SECRET = process.env.FEISHU_APP_SECRET || ''
const DEFAULT_REDIRECT = process.env.FEISHU_REDIRECT_URI || 'http://127.0.0.1:3000/oauth/callback/feishu'

export const feishuAdapter: PlatformAdapter = {
  platform: 'feishu',
  displayName: '飞书',

  start({ userId, redirectUri }) {
    if (!APP_ID) throw new Error('FEISHU_APP_ID 未配置')
    const state = randomBytes(16).toString('hex')
    const url =
      `https://open.feishu.cn/open-apis/authen/v1/index` +
      `?app_id=${APP_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri || DEFAULT_REDIRECT)}` +
      `&state=${state}` +
      `&scope=${encodeURIComponent('contact:user.id:readonly')}`
    saveState({ state, userId, platform: 'feishu', redirectUri: redirectUri || DEFAULT_REDIRECT, createdAt: Date.now() })
    return { url, state }
  },

  async callback({ code, state: _state, userId }): Promise<OAuthCredential> {
    if (!APP_ID || !APP_SECRET) throw new Error('FEISHU_APP_ID / SECRET 未配置')
    // Step 1: code → user_access_token
    const tokenResp = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        client_id: APP_ID,
        client_secret: APP_SECRET,
      }),
    })
    const tokenData = (await tokenResp.json()) as Record<string, any>
    if (tokenData.code !== 0) {
      throw new Error(`feishu token failed: ${tokenData.code} ${tokenData.msg}`)
    }
    const accessToken = tokenData.data.access_token
    const refreshToken = tokenData.data.refresh_token
    const now = Date.now()
    return {
      platform: 'feishu',
      user_id: userId,
      access_token: accessToken,
      refresh_token: refreshToken,
      openid: tokenData.data.user_id,    // 飞书用 user_id 当 openid
      scope: tokenData.data.scope,
      expires_at: now + (tokenData.data.expires_in ?? 7200) * 1000,
      raw: tokenData.data,
      created_at: now,
      updated_at: now,
    }
  },

  async test(cred) {
    if (!cred.access_token) return { ok: false, info: 'no access_token' }
    try {
      const resp = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        method: 'GET',
        headers: { Authorization: `Bearer ${cred.access_token}` },
      })
      const data = (await resp.json()) as Record<string, any>
      if (data.code !== 0) {
        return { ok: false, info: `${data.code} ${data.msg}` }
      }
      return { ok: true, info: `user_id=${data.data.user_id}, name=${data.data.name ?? '(隐藏)'}` }
    } catch (e: any) {
      return { ok: false, info: e.message?.slice(0, 100) }
    }
  },
}
