// packages/backend/src/providers/index.ts · D3.2 (2026-06-17)
// 仿 Hermes providers/__init__.py: pkgutil.iter_modules 自动扫描 plugins/

import { readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProviderProfile, ProviderListItem, ChatRequest, ChatResponse } from './base.js'
import { CredentialPool } from './credential-pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PLUGINS_DIR = join(__dirname, 'plugins')

const PROVIDERS = new Map<string, ProviderProfile>()
let loaded = false

/** 自动扫描 plugins/ 目录 */
export async function loadProviders(): Promise<Map<string, ProviderProfile>> {
  if (loaded) return PROVIDERS
  if (!existsSync(PLUGINS_DIR)) {
    console.warn(`[providers] plugins dir not found: ${PLUGINS_DIR}`)
    return PROVIDERS
  }

  for (const name of readdirSync(PLUGINS_DIR)) {
    // Track D6-fix (2026-06-18): 优先 .ts (tsx 跑 src 时), 降级到 .js (编译后)
    //   之前只 import .js, 跑 tsx 时找不到 → 0 provider 加载 → chat 报 "Provider not found"
    const tsPath = join(PLUGINS_DIR, name, 'provider.ts')
    const jsPath = join(PLUGINS_DIR, name, 'provider.js')
    const pluginPath = existsSync(tsPath) ? tsPath : jsPath
    if (!existsSync(pluginPath)) continue
    try {
      const mod = await import(pluginPath)
      const profile: ProviderProfile = mod.default || mod
      profile.pluginPath = name
      PROVIDERS.set(profile.name, profile)
      console.log(`[providers] loaded ${profile.name} from ${name}`)
    } catch (e: any) {
      console.warn(`[providers] failed to load ${name}:`, e.message?.slice(0, 100))
    }
  }
  loaded = true
  return PROVIDERS
}

export function getProvider(name: string): ProviderProfile | undefined {
  return PROVIDERS.get(name)
}

export function listProviders(): ProviderListItem[] {
  return Array.from(PROVIDERS.values()).map(p => ({
    name: p.name,
    displayName: p.displayName,
    description: p.description,
    authType: p.authType,
    configured: p.envVars.every(v => !!process.env[v]),
    envVars: p.envVars,
    model: p.defaultModel,
    signupUrl: p.signupUrl,
  }))
}

/** 取活跃 provider (按 LLM_PROVIDER env) */
export function getProviders(): ProviderProfile[] {
  return Array.from(PROVIDERS.values())
}

export function getActiveProvider(): ProviderProfile {
  const name = process.env.LLM_PROVIDER || 'siliconflow'
  const p = PROVIDERS.get(name)
  if (!p) {
    const available = Array.from(PROVIDERS.keys()).join(', ')
    throw new Error(`Provider not found: ${name}. Available: ${available || 'none (load failed?)'}`)
  }
  return p
}

/** 取 API key (支持多 key 池) */
export function getApiKey(provider: ProviderProfile): string | null {
  // 单 key: 直接读 envVar
  if (provider.envVars.length === 0) return ''
  const envVal = process.env[provider.envVars[0]] || ''
  if (!envVal) return null
  // 已经是单 key,直接返回
  if (!envVal.includes(',')) return envVal
  // 多 key: 用 credential_pool 选一个
  const pool = new CredentialPool(provider.envVars[0], 'round_robin')
  return pool.pick()
}

/** 标记 API key 失败 (用于轮换) */
export function markApiKeyFailed(provider: ProviderProfile, apiKey: string) {
  if (provider.envVars.length === 0) return
  const envVal = process.env[provider.envVars[0]] || ''
  if (!envVal.includes(',')) return
  const pool = new CredentialPool(provider.envVars[0], 'round_robin')
  pool.markFailed(apiKey)
}

/** 便捷调用入口 */
export async function chatViaActiveProvider(
  req: ChatRequest,
): Promise<ChatResponse> {
  const provider = getActiveProvider()
  const apiKey = getApiKey(provider) ?? ''
  if (provider.authType === 'api_key' && !apiKey) {
    throw new Error(`[${provider.name}] ${provider.envVars[0]} 未配置`)
  }
  try {
    const resp = await provider.chat(req, apiKey)
    return resp
  } catch (e: any) {
    markApiKeyFailed(provider, apiKey)
    throw e
  }
}
