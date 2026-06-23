// packages/backend/src/core/tools/astrbot-bridge.ts
// DaShengOS v6.0 — AstrBot 桥接模块
// AstrBot (35K⭐) — 多平台 AI Agent 框架，集成 IM/LLM/插件

import { execSync, spawn, ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'

const ASTRBOT_DIR = '/Users/apple/Desktop/ai-workbench-astrbot'

// ─── Types ───────────────────────────────────────────────

export interface AstrBotStatus {
  installed: boolean
  running: boolean
  version?: string
  plugins?: string[]
  providers?: string[]
  error?: string
}

export interface AstrBotToolDef {
  name: string
  description: string
  parameters: Record<string, any>
}

export const ASTRBOT_TOOLS: AstrBotToolDef[] = [
  {
    name: 'astrbot_chat',
    description: '通过 AstrBot 在任意 IM 平台发送消息',
    parameters: {
      message: { type: 'string', description: '消息内容' },
      platform: { type: 'string', description: '目标平台 (wecom/feishu/dingtalk/telegram/discord)', default: 'wecom' },
      target_id: { type: 'string', description: '目标会话ID' },
    }
  },
  {
    name: 'astrbot_list_plugins',
    description: '列出 AstrBot 已安装的插件',
    parameters: {}
  },
  {
    name: 'astrbot_call_plugin',
    description: '调用 AstrBot 插件',
    parameters: {
      plugin_name: { type: 'string', description: '插件名称' },
      action: { type: 'string', description: '操作名' },
      args: { type: 'object', description: '操作参数' },
    }
  },
  {
    name: 'astrbot_create_agent',
    description: '在 AstrBot 中创建新的 AI Agent',
    parameters: {
      name: { type: 'string', description: 'Agent 名称' },
      system_prompt: { type: 'string', description: '系统提示词' },
      provider: { type: 'string', description: 'LLM provider', default: 'deepseek' },
    }
  },
]

// ─── Status ──────────────────────────────────────────────

export function getAstrBotStatus(): AstrBotStatus {
  const installed = existsSync(ASTRBOT_DIR) && existsSync(`${ASTRBOT_DIR}/main.py`)
  
  if (!installed) {
    return { installed: false, running: false, error: 'AstrBot 未安装' }
  }

  const running = isAstrBotRunning()
  
  let version = 'unknown'
  try {
    const initPy = execSync(`grep "__version__" ${ASTRBOT_DIR}/astrbot/__init__.py 2>/dev/null | head -1`, { encoding: 'utf-8' })
    const m = initPy.match(/[\d.]+(?:\.[\d.]+)+/)
    if (m) version = m[0]
  } catch {}

  const dashboardPort = 6185
  const dashboardUrl = `http://localhost:${dashboardPort}`
  
  // Check desktop app
  const desktopInstalled = existsSync('/Users/apple/Desktop/AstrBot.app') || existsSync('/Applications/AstrBot.app')

  return { installed: true, running, version, dashboardPort, dashboardUrl, desktopInstalled }
}

function isAstrBotRunning(): boolean {
  try {
    const out = execSync('pgrep -f "bot.py" 2>/dev/null || echo ""', { encoding: 'utf-8' }).trim()
    return out.length > 0
  } catch { return false }
}

// ─── Launch ──────────────────────────────────────────────

export async function launchAstrBot(): Promise<{ success: boolean; message: string }> {
  if (!existsSync(ASTRBOT_DIR)) {
    return { success: false, message: 'AstrBot 未安装，请先克隆仓库' }
  }

  if (isAstrBotRunning()) {
    return { success: true, message: 'AstrBot 已在运行' }
  }

  try {
    const proc = spawn('python3', ['main.py'], {
      cwd: ASTRBOT_DIR,
      stdio: 'pipe',
      detached: true,
      env: { ...process.env, DASHBOARD_PORT: '6185' }
    })
    // Log startup output
    proc.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim()
      if (line) console.log('[AstrBot]', line.slice(0, 200))
    })
    proc.stderr?.on('data', (d: Buffer) => {
      console.error('[AstrBot:err]', d.toString().trim().slice(0, 200))
    })
    proc.unref()
    return { success: true, message: 'AstrBot 已启动' }
  } catch (e: any) {
    return { success: false, message: `启动失败: ${e.message}` }
  }
}

// ─── Execute Tool ────────────────────────────────────────

export async function executeAstrBotTool(
  toolName: string,
  args: Record<string, any>
): Promise<{ success: boolean; data?: string; error?: string }> {
  const t0 = Date.now()

  switch (toolName) {
    case 'astrbot_list_plugins': {
      try {
        const pluginsDir = `${ASTRBOT_DIR}/plugins`
        if (!existsSync(pluginsDir)) return { success: false, error: 'plugins 目录不存在' }
        const { readdirSync } = await import('node:fs')
        const plugins = readdirSync(pluginsDir).filter(f => !f.startsWith('_') && !f.startsWith('.'))
        return { success: true, data: JSON.stringify({ plugins, count: plugins.length }) }
      } catch (e: any) {
        return { success: false, error: e.message }
      }
    }

    case 'astrbot_chat': {
      const { message, platform, target_id } = args
      if (!message) return { success: false, error: '缺少 message 参数' }
      // AstrBot HTTP API call (assumes it's configured)
      try {
        const resp = await fetch(`http://127.0.0.1:6188/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, platform, target_id }),
          signal: AbortSignal.timeout(30000),
        })
        const data = await resp.json()
        return { success: true, data: JSON.stringify(data) }
      } catch {
        return { success: false, error: 'AstrBot API 不可达 (端口 6188)' }
      }
    }

    case 'astrbot_call_plugin': {
      const { plugin_name, action, args: pluginArgs } = args
      if (!plugin_name) return { success: false, error: '缺少 plugin_name 参数' }
      try {
        const resp = await fetch(`http://127.0.0.1:6188/api/plugin/${plugin_name}/${action || 'execute'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pluginArgs || {}),
          signal: AbortSignal.timeout(30000),
        })
        const data = await resp.json()
        return { success: true, data: JSON.stringify(data) }
      } catch {
        return { success: false, error: 'AstrBot 插件 API 不可达' }
      }
    }

    case 'astrbot_create_agent': {
      const { name, system_prompt, provider } = args
      if (!name) return { success: false, error: '缺少 name 参数' }
      try {
        const resp = await fetch(`http://127.0.0.1:6188/api/agent/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, system_prompt, provider: provider || 'deepseek' }),
          signal: AbortSignal.timeout(30000),
        })
        const data = await resp.json()
        return { success: true, data: JSON.stringify(data) }
      } catch {
        return { success: false, error: 'AstrBot Agent API 不可达' }
      }
    }

    default:
      return { success: false, error: `未知 AstrBot 工具: ${toolName}` }
  }
}

export function getAstrBotToolsForLLM() {
  return ASTRBOT_TOOLS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: `[AstrBot] ${t.description}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]: [string, any]) => [
            k, 
            v.type === 'object' ? { type: 'object', description: v.description } : { type: v.type, description: v.description, ...(v.default !== undefined ? { default: v.default } : {}) }
          ])
        ),
        required: Object.entries(t.parameters).filter(([, v]: [string, any]) => v.default === undefined).map(([k]) => k),
      },
    },
  }))
}
