// packages/backend/src/api/config.ts · DaShengOS v6.1
// 配置热重载 —— PUT /api/config 仿 Hermes 不重启改配置
import type { FastifyInstance } from 'fastify'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execSync } from 'node:child_process'

const DASHENG_HOME = process.env.DASHENG_HOME || join(homedir(), '.dasheng')
const CONFIG_PATH = join(DASHENG_HOME, 'config.yaml')
const ENV_PATH = join(DASHENG_HOME, '.env')

function ensureDir() {
  if (!existsSync(DASHENG_HOME)) mkdirSync(DASHENG_HOME, { recursive: true })
}

function readConfig(): Record<string, any> {
  ensureDir()
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    // Simple key=value parser for now (yaml package optional)
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const config: Record<string, any> = {}
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf(':')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value: any = trimmed.slice(eq + 1).trim()
      if (value === 'true') value = true
      else if (value === 'false') value = false
      else if (/^\d+$/.test(value)) value = parseInt(value)
      config[key] = value
    }
    return config
  } catch {
    return {}
  }
}

function writeConfig(config: Record<string, any>) {
  ensureDir()
  const lines = ['# DaShengOS Configuration', `# Generated: ${new Date().toISOString()}`, '']
  for (const [key, value] of Object.entries(config)) {
    lines.push(`${key}: ${value}`)
  }
  writeFileSync(CONFIG_PATH, lines.join('\n') + '\n')
}

function reloadEnvFromFile() {
  if (!existsSync(ENV_PATH)) return
  try {
    const raw = readFileSync(ENV_PATH, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      process.env[key] = value
    }
  } catch {}
}

export async function configRoutes(app: FastifyInstance) {
  // GET /api/config — 读取当前配置
  app.get('/api/config', async () => {
    const config = readConfig()
    const providers = {
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      qwen: !!process.env.DASHSCOPE_API_KEY,
      deepseek: !!process.env.DEEPSEEK_API_KEY,
      siliconflow: !!process.env.SILICONFLOW_API_KEY,
      ollama: !!process.env.OLLAMA_HOST,
      groq: !!process.env.GROQ_API_KEY,
      google: !!process.env.GOOGLE_API_KEY,
    }
    return {
      config_path: CONFIG_PATH,
      env_path: ENV_PATH,
      dasheng_home: DASHENG_HOME,
      config,
      providers,
      process_env_keys: Object.keys(process.env).filter(k =>
        k.endsWith('_API_KEY') || k.endsWith('_KEY') || k.startsWith('DASHENG_')
      ).reduce((acc, k) => { acc[k] = process.env[k] ? '***set***' : '(not set)'; return acc }, {} as Record<string, string>),
    }
  })

  // PUT /api/config — 热更新配置（不需要重启）
  app.put('/api/config', async (req, reply) => {
    const body = req.body as Record<string, any>
    if (!body || Object.keys(body).length === 0) {
      return reply.code(400).send({ error: 'empty body' })
    }

    const changes: string[] = []

    // 写入 yaml 配置
    if (body.config) {
      const existing = readConfig()
      const merged = { ...existing, ...body.config }
      writeConfig(merged)
      changes.push(`config.yaml updated (${Object.keys(body.config).join(', ')})`)
    }

    // 写入 .env secrets
    if (body.env) {
      ensureDir()
      const lines = ['# DaShengOS Environment Secrets', `# Updated: ${new Date().toISOString()}`, '']
      for (const [key, value] of Object.entries(body.env)) {
        lines.push(`${key}=${value}`)
        process.env[key] = String(value)
      }
      writeFileSync(ENV_PATH, lines.join('\n') + '\n')
      changes.push(`.env updated (${Object.keys(body.env).join(', ')})`)
    }

    // 如果传了 provider 配置，直接设到 process.env
    if (body.providers) {
      for (const [name, key] of Object.entries(body.providers)) {
        if (typeof key === 'string' && key.length > 0) {
          const envKey = `${name.toUpperCase()}_API_KEY`
          process.env[envKey] = key
          changes.push(`${name} provider key set`)
        }
      }
    }

    return {
      ok: true,
      changes,
      message: '配置已热更新，无需重启',
      reloaded_env: !!body.env,
    }
  })

  // POST /api/config/reload — 从磁盘重新加载 .env
  app.post('/api/config/reload', async () => {
    reloadEnvFromFile()
    return {
      ok: true,
      message: '已从磁盘重新加载 .env',
      providers: {
        openai: !!process.env.OPENAI_API_KEY,
        deepseek: !!process.env.DEEPSEEK_API_KEY,
        siliconflow: !!process.env.SILICONFLOW_API_KEY,
      },
    }
  })

  // GET /api/config/doctor — 检查配置健康度
  app.get('/api/config/doctor', async () => {
    const issues: string[] = []
    const config = readConfig()

    if (!existsSync(CONFIG_PATH)) issues.push('config.yaml 不存在，运行 PUT /api/config 创建')
    if (!existsSync(ENV_PATH)) issues.push('.env 不存在，运行 PUT /api/config 创建')
    if (!process.env.DEEPSEEK_API_KEY && !process.env.SILICONFLOW_API_KEY && !process.env.OPENAI_API_KEY) {
      issues.push('⚠️ 未配置任何 LLM Provider API Key，AI 功能无法使用')
    }

    return {
      config_path: CONFIG_PATH,
      env_path: ENV_PATH,
      config_exists: existsSync(CONFIG_PATH),
      env_exists: existsSync(ENV_PATH),
      issues,
      hint: issues.length === 0 ? '配置完整 ✅' : '运行 PUT /api/config 修复',
    }
  })
}
