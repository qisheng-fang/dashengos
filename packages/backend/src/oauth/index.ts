// packages/backend/src/oauth/index.ts · D4 总入口 (2026-06-18)
// 启动时注册 4 个平台适配器

import { registerAdapter } from './base.js'
import { wechatMpAdapter } from './wechat.js'
import { feishuAdapter } from './feishu.js'
import { wechatVideoAdapter } from './video.js'
import { shopifyAdapter } from './shopify.js'

let registered = false

export function registerAllAdapters(): void {
  if (registered) return
  registerAdapter(wechatMpAdapter)
  registerAdapter(feishuAdapter)
  registerAdapter(wechatVideoAdapter)
  registerAdapter(shopifyAdapter)
  registered = true
}
