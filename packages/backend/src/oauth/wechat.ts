// packages/backend/src/oauth/wechat.ts · D4-B 微信公众号 OAuth (2026-06-18)
//  授权 URL: https://open.weixin.qq.com/connect/oauth2/authorize
//  scope: snsapi_base (静默, 只拿 openid) / snsapi_userinfo (拿昵称头像, 需关注)
//  token URL: https://api.weixin.qq.com/sns/oauth2/access_token
//
//  必备环境变量: WECHAT_MP_APPID, WECHAT_MP_SECRET, WECHAT_MP_REDIRECT_URI
//  公众号后台 → 开发 → 基本配置 → 公众号开发信息
//  回调域名需要在「授权域名」中配置 (不能带 http://, 只能是域名)

import { randomBytes } from 'node:crypto'
import type { PlatformAdapter, OAuthCredential } from './base.js'
import { saveState } from './base.js'

const APPID = process.env.WECHAT_MP_APPID || ''
const SECRET = process.env.WECHAT_MP_SECRET || ''
const DEFAULT_REDIRECT = process.env.WECHAT_MP_REDIRECT_URI || 'http://127.0.0.1:3000/oauth/callback/wechat_mp'

export const wechatMpAdapter: PlatformAdapter = {
  platform: 'wechat_mp',
  displayName: '微信公众号',

  start({ userId, redirectUri }) {
    if (!APPID) throw new Error('WECHAT_MP_APPID 未配置')
    const state = randomBytes(16).toString('hex')
    const scope = process.env.WECHAT_MP_SCOPE || 'snsapi_base'
    const url =
      `https://open.weixin.qq.com/connect/oauth2/authorize` +
      `?appid=${APPID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri || DEFAULT_REDIRECT)}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&state=${state}` +
      `#wechat_redirect`
    saveState({ state, userId, platform: 'wechat_mp', redirectUri: redirectUri || DEFAULT_REDIRECT, createdAt: Date.now() })
    return { url, state }
  },

  async callback({ code, state: _state, userId, redirectUri: _redirectUri }): Promise<OAuthCredential> {
    if (!APPID || !SECRET) throw new Error('WECHAT_MP_APPID / SECRET 未配置')
    const tokenUrl =
      `https://api.weixin.qq.com/sns/oauth2/access_token` +
      `?appid=${APPID}` +
      `&secret=${SECRET}` +
      `&code=${code}` +
      `&grant_type=authorization_code`
    const resp = await fetch(tokenUrl)
    const data = (await resp.json()) as Record<string, any>
    if (data.errcode) {
      throw new Error(`wechat oauth failed: ${data.errcode} ${data.errmsg}`)
    }
    const now = Date.now()
    return {
      platform: 'wechat_mp',
      user_id: userId,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      openid: data.openid,
      unionid: data.unionid,        // 仅当公众号绑定到开放平台才有
      scope: data.scope,
      expires_at: now + (data.expires_in ?? 7200) * 1000,
      raw: data,
      created_at: now,
      updated_at: now,
    }
  },

  async test(cred) {
    if (!cred.openid) return { ok: false, info: 'no openid' }
    // 拿用户基本信息验证 token 有效
    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${cred.access_token}&openid=${cred.openid}&lang=zh_CN`
    try {
      const resp = await fetch(url)
      const data = (await resp.json()) as Record<string, any>
      if (data.errcode) {
        return { ok: false, info: `${data.errcode} ${data.errmsg}` }
      }
      return { ok: true, info: `nickname=${data.nickname}, openid=${data.openid.slice(0, 8)}...` }
    } catch (e: any) {
      return { ok: false, info: e.message?.slice(0, 100) }
    }
  },
}
