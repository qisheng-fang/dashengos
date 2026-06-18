// packages/backend/src/oauth/video.ts · D4-D 视频号桥 (2026-06-18)
//  视频号目前没有独立 OAuth 流程, 复用 微信公众号 appid
//  用户在视频号助手/微信视频号绑定时, unionid 跟公众号互通
//  本适配器实际是 wechat_mp 的"渠道别名", 不重复请求平台
//
//  工作方式:
//   1. 用户先连接微信公众号 (wechat_mp) → 拿 openid + unionid
//   2. 本适配器把同一条凭证复制到 wechat_video 命名空间, 标识渠道
//   3. 标记 channel=wechat_video, 供后续发布工具区分

import type { PlatformAdapter, OAuthCredential } from './base.js'
import { loadCredential, saveCredential, deleteCredential } from './base.js'

export const wechatVideoAdapter: PlatformAdapter = {
  platform: 'wechat_video',
  displayName: '微信视频号',

  start({ userId }) {
    // 视频号不独立授权, 跳到公众号授权页, callback 时 channel 标记成 video
    return {
      url: `/api/v1/oauth/wechat_mp/start?user_id=${userId}&channel=wechat_video`,
      state: `bridge_${userId}`,
    }
  },

  async callback({ code, state, userId, redirectUri }) {
    // 直接复用 wechat_mp 的 token 流程
    const { wechatMpAdapter } = await import('./wechat.js')
    const cred = await wechatMpAdapter.callback({ code, state, userId, redirectUri })
    // 标记渠道
    return { ...cred, platform: 'wechat_video' }
  },

  async test(cred) {
    if (!cred.access_token || !cred.openid) return { ok: false, info: 'incomplete cred' }
    // 视频号开放 API 测活 (跟 mp 用同一 access_token)
    const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${cred.access_token}&openid=${cred.openid}&lang=zh_CN`
    try {
      const resp = await fetch(url)
      const data = (await resp.json()) as Record<string, any>
      if (data.errcode) return { ok: false, info: `${data.errcode} ${data.errmsg}` }
      return { ok: true, info: `video channel via mp, openid=${cred.openid.slice(0, 8)}..., unionid=${cred.unionid?.slice(0, 8) ?? 'n/a'}` }
    } catch (e: any) {
      return { ok: false, info: e.message?.slice(0, 100) }
    }
  },
}

// 桥接工具: 把已有 wechat_mp 凭证复制到 wechat_video 命名空间
export function bridgeWechatMpToVideo(userId: string): OAuthCredential | null {
  const mp = loadCredential('wechat_mp', userId)
  if (!mp) return null
  const now = Date.now()
  const videoCred: OAuthCredential = {
    ...mp,
    platform: 'wechat_video',
    user_id: userId,
    updated_at: now,
  }
  saveCredential(videoCred)
  return videoCred
}

// 反向桥接: 解除视频号
export function unbridgeWechatVideo(userId: string): boolean {
  return deleteCredential('wechat_video', userId)
}
