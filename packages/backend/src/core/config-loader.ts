// DaShengOS v6.1 — 配置分层加载器
// 读取顺序: config.yaml → .env → auth.json
// 支持热重载 (文件变更时自动刷新)
// 优先级: .env 环境变量 > config.yaml > 默认值

import { readFileSync, existsSync, watch } from 'node:fs'
import { resolve } from 'node:path'

// ─── Types ─────────────────────────────────────────────────

export interface AppConfig {
  name: string
  version: string
  env: string
  debug: boolean
  logLevel: string
}

export interface LLMConfig {
  defaultProvider: string
  defaultModel: string
  fallbackProvider: string
  maxRetries: number
  requestTimeoutSec: number
  contextCompressThreshold: number
}

export interface SecurityConfig {
  jwtAccessTtlSec: number
  jwtRefreshTtlSec: number
  rateLimitPerMinute: number
  loginIpLockThreshold: number
  loginIpLockMinutes: number
}

export interface MCPConfig {
  autoStart: boolean
  heartbeatIntervalSec: number
  maxRestartAttempts: number
}

export interface BackupConfig {
  enabled: boolean
  intervalHours: number
  maxRetention: number
}

export interface DashengConfig {
  app: AppConfig
  llm: LLMConfig
  mcp: MCPConfig
  backup: BackupConfig
  security: SecurityConfig
  orchestrator: { langgraphEnabled: boolean; maxAgentSteps: number }
  raw: Record<string, any>
}

// ─── YAML Parser (minimal, no dependency) ──────────────────

function parseSimpleYaml(content: string): Record<string, any> {
  const result: Record<string, any> = {}
  const lines = content.split('\n')
  const stack: Array<{ key: string; obj: Record<string, any> }> = []

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue

    const indent = line.search(/\S/)
    const trimmed = line.trim()
    const colonIdx = trimmed.indexOf(':')

    if (colonIdx === -1) continue

    const key = trimmed.substring(0, colonIdx).trim()
    let value: any = trimmed.substring(colonIdx + 1).trim()

    // Remove quotes
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1)
    }

    // Parse types
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (/^\d+$/.test(value)) value = parseInt(value, 10)
    else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value)
    else if (value === '' || value === '{}' || value === '[]') {
      // Object/array start
      value = value === '[]' ? [] : {}
    }

    // Pop stack to match indent level
    const depth = Math.floor(indent / 2)
    while (stack.length > depth) stack.pop()

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Push new object onto stack
      if (stack.length === 0) {
        result[key] = value
        stack.push({ key, obj: value })
      } else {
        const parent = stack[stack.length - 1].obj
        parent[key] = value
        stack.push({ key, obj: value })
      }
    } else if (Array.isArray(value)) {
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result
      parent[key] = []
      // Read array items (lines starting with '-')
      stack.push({ key, obj: parent[key] })
    } else {
      const parent = stack.length > 0 ? stack[stack.length - 1].obj : result
      // Check if it's an array item
      if (key === '-' && Array.isArray(parent)) {
        parent.push(value)
      } else {
        parent[key] = value
      }
    }
  }

  return result
}

// ─── Loader ────────────────────────────────────────────────

let cachedConfig: DashengConfig | null = null
const ROOT = resolve(process.cwd(), '..')

function loadFromYaml(): Record<string, any> {
  const yamlPath = resolve(ROOT, 'config.yaml')
  if (!existsSync(yamlPath)) return {}
  try {
    return parseSimpleYaml(readFileSync(yamlPath, 'utf-8'))
  } catch (e: any) {
    console.error('[ConfigLoader] YAML parse error:', e.message)
    return {}
  }
}

function mergeEnv(config: Record<string, any>): Record<string, any> {
  // .env values override config.yaml
  const envMap: Record<string, string> = {}
  const envPath = resolve(ROOT, '.env')
  if (existsSync(envPath)) {
    try {
      const envLines = readFileSync(envPath, 'utf-8').split('\n')
      for (const line of envLines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          envMap[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim()
        }
      }
    } catch { /* ignore */ }
  }

  // Override specific config values from env
  if (envMap.LLM_PROVIDER) {
    if (!config.llm) config.llm = {}
    config.llm.default_provider = envMap.LLM_PROVIDER
  }
  if (envMap.DEFAULT_MODEL || envMap.DEEPSEEK_DEFAULT_MODEL) {
    if (!config.llm) config.llm = {}
    config.llm.default_model = envMap.DEFAULT_MODEL || envMap.DEEPSEEK_DEFAULT_MODEL
  }
  if (envMap.APP_PORT) {
    if (!config.server) config.server = {}
    if (!config.server.backend) config.server.backend = {}
    config.server.backend.port = parseInt(envMap.APP_PORT, 10)
  }
  if (envMap.DASHENG_JWT_ACCESS_TTL_SEC) {
    if (!config.security) config.security = {}
    config.security.jwt_access_ttl_sec = parseInt(envMap.DASHENG_JWT_ACCESS_TTL_SEC, 10)
  }

  return config
}

export function loadConfig(): DashengConfig {
  const raw = mergeEnv(loadFromYaml())

  const config: DashengConfig = {
    app: {
      name: raw.app?.name || 'DaShengOS',
      version: raw.app?.version || '6.1.0',
      env: raw.app?.env || process.env.NODE_ENV || 'production',
      debug: raw.app?.debug ?? false,
      logLevel: raw.app?.log_level || 'info',
    },
    llm: {
      defaultProvider: raw.llm?.default_provider || 'deepseek',
      defaultModel: raw.llm?.default_model || 'deepseek-v4-pro',
      fallbackProvider: raw.llm?.fallback_provider || 'siliconflow',
      maxRetries: raw.llm?.max_retries ?? 3,
      requestTimeoutSec: raw.llm?.request_timeout_sec ?? 120,
      contextCompressThreshold: raw.llm?.context_compress_threshold ?? 60000,
    },
    mcp: {
      autoStart: raw.mcp?.auto_start ?? true,
      heartbeatIntervalSec: raw.mcp?.heartbeat_interval_sec ?? 30,
      maxRestartAttempts: raw.mcp?.max_restart_attempts ?? 3,
    },
    backup: {
      enabled: raw.backup?.enabled ?? true,
      intervalHours: raw.backup?.interval_hours ?? 6,
      maxRetention: raw.backup?.max_retention ?? 30,
    },
    security: {
      jwtAccessTtlSec: raw.security?.jwt_access_ttl_sec ?? 900,
      jwtRefreshTtlSec: raw.security?.jwt_refresh_ttl_sec ?? 604800,
      rateLimitPerMinute: raw.security?.rate_limit_per_minute ?? 60,
      loginIpLockThreshold: raw.security?.login_ip_lock_threshold ?? 5,
      loginIpLockMinutes: raw.security?.login_ip_lock_minutes ?? 15,
    },
    orchestrator: {
      langgraphEnabled: raw.orchestrator?.langgraph_enabled ?? true,
      maxAgentSteps: raw.orchestrator?.max_agent_steps ?? 10,
    },
    raw,
  }

  cachedConfig = config
  return config
}

export function getConfig(): DashengConfig {
  if (!cachedConfig) return loadConfig()
  return cachedConfig
}

// ─── Hot Reload ────────────────────────────────────────────

let watcher: ReturnType<typeof watch> | null = null

export function startConfigWatcher(onChange?: (config: DashengConfig) => void): void {
  const yamlPath = resolve(ROOT, 'config.yaml')
  if (!existsSync(yamlPath)) {
    console.warn('[ConfigLoader] config.yaml not found, hot reload disabled')
    return
  }

  watcher = watch(yamlPath, (eventType) => {
    if (eventType === 'change') {
      console.log('[ConfigLoader] config.yaml changed, reloading...')
      const config = loadConfig()
      if (onChange) onChange(config)
    }
  })

  console.log('[ConfigLoader] Hot reload enabled (watching config.yaml)')
}

export function stopConfigWatcher(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
