// packages/backend/src/agents/social/index.ts · Track B (2026-06-15)
// 3 社媒 Agent 注册表 + 工厂函数
//
// 跟 packages/backend/src/api/agents.ts BUILTIN_AGENTS 列表共存
// 6 builtin (code/deep-researcher 等) + 3 social (DouyinAgent/XiaohongshuAgent/WechatAgent) = 9

import { socialWorker, type SocialWorkerClient } from './worker-client.js'
import { SocialAgent } from './base.js'
import { DouyinAgent } from './douyin.js'
import { XiaohongshuAgent } from './xiaohongshu.js'
import { WechatAgent } from './wechat.js'

export { SocialAgent, socialWorker, SocialWorkerClient }
export type { SocialToolDef, SocialExecuteResult } from './base.js'
export { DouyinAgent, XiaohongshuAgent, WechatAgent }

// ============== Singleton registry ==============

let _registry: Record<string, SocialAgent> | null = null

/**
 * 懒加载 social agent registry (单例)
 * 跟 packages/backend/src/api/agents.ts 的 BUILTIN_AGENTS 解耦
 */
export function getSocialAgentRegistry(): Record<string, SocialAgent> {
  if (_registry) return _registry
  _registry = {
    [new DouyinAgent(socialWorker).id]: new DouyinAgent(socialWorker),
    [new XiaohongshuAgent(socialWorker).id]: new XiaohongshuAgent(socialWorker),
    [new WechatAgent(socialWorker).id]: new WechatAgent(socialWorker),
  }
  return _registry
}

export function getSocialAgent(id: string): SocialAgent | undefined {
  return getSocialAgentRegistry()[id]
}

export function listSocialAgents(): SocialAgent[] {
  return Object.values(getSocialAgentRegistry())
}

/**
 * 跟 packages/backend/src/api/agents.ts BUILTIN_AGENTS 格式对齐
 * 给 /api/v1/agents 端点合并用
 */
export function getSocialAgentsAsBuiltin() {
  return listSocialAgents().map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    category: a.category,
    is_builtin: true,
    is_social: true,
    capabilities: a.capabilities,
    tools: a.tools,
  }))
}
