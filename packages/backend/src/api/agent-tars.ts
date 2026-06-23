// packages/backend/src/api/agent-tars.ts
// DaShengOS v6.0 — Agent TARS 集成 API
// 启动/停止 Electron 应用 + 注册 MCP 工具

import type { FastifyInstance } from 'fastify'
import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { sqlite } from '../storage/db.js'

const TARS_DIR = '/Users/apple/WorkBuddy/2026-06-22-08-37-30/AgentTARS'
const TARS_APP_DIR = `${TARS_DIR}/apps/agent-tars`

let tarsProcess: ReturnType<typeof spawn> | null = null

function isElectronRunning(): boolean {
  try {
    const out = execSync('pgrep -f "Agent.TARS.app" 2>/dev/null || pgrep -fl "agent-tars-app" 2>/dev/null | grep -v grep || echo ""', { encoding: 'utf-8' }).trim()
    return out.length > 0
  } catch {
    return false
  }
}

function getTARSMCPTools() {
  // Agent TARS 自带的 3 个 MCP 服务器
  return [
    {
      serverName: 'agent-tars-browser',
      command: 'node',
      args: [`${TARS_APP_DIR}/node_modules/@agent-infra/mcp-server-browser/dist/index.js`],
      description: '浏览器控制 — 视觉解析网页并执行操作',
      tools: [
        { name: 'browser_navigate', description: '导航到指定 URL', riskLevel: 'NETWORK' },
        { name: 'browser_click', description: '点击页面元素', riskLevel: 'WRITE' },
        { name: 'browser_type', description: '在输入框输入文本', riskLevel: 'WRITE' },
        { name: 'browser_screenshot', description: '截取页面截图', riskLevel: 'READ' },
        { name: 'browser_get_content', description: '获取页面内容', riskLevel: 'READ' },
      ]
    },
    {
      serverName: 'agent-tars-commands',
      command: 'node',
      args: [`${TARS_APP_DIR}/node_modules/@agent-infra/mcp-server-commands/dist/index.js`],
      description: '命令执行 — 运行终端命令',
      tools: [
        { name: 'run_command', description: '执行终端命令', riskLevel: 'EXEC' },
      ]
    },
    {
      serverName: 'agent-tars-filesystem',
      command: 'node',
      args: [`${TARS_APP_DIR}/node_modules/@agent-infra/mcp-server-filesystem/dist/index.js`],
      description: '文件系统 — 读写本地文件',
      tools: [
        { name: 'read_file', description: '读取文件内容', riskLevel: 'READ' },
        { name: 'write_file', description: '写入文件', riskLevel: 'WRITE' },
        { name: 'list_directory', description: '列出目录内容', riskLevel: 'READ' },
      ]
    }
  ]
}

export async function agentTarsRoutes(app: FastifyInstance) {

  // GET /api/v1/agent-tars/status
  app.get('/status', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const running = isElectronRunning()
    const isBuilt = existsSync(`${TARS_APP_DIR}/dist/main/index.js`)
    return reply.send({
      running,
      isBuilt,
      message: running ? 'Agent TARS Electron 应用运行中' : isBuilt ? '已构建，待启动' : '未构建，请先安装依赖',
      tools: running ? getTARSMCPTools().flatMap(s => s.tools.map(t => ({ ...t, serverName: s.serverName }))) : [],
    })
  })

  // POST /api/v1/agent-tars/launch
  app.post('/launch', { preHandler: [app.authenticate] }, async (_req, reply) => {
    if (isElectronRunning()) {
      return reply.send({ success: true, message: 'Agent TARS 已在运行' })
    }

    const isBuilt = existsSync(`${TARS_APP_DIR}/dist/main/index.js`)
    if (!isBuilt) {
      // Try to build
      try {
        execSync(`cd ${TARS_APP_DIR} && npx electron-vite build 2>&1`, { 
          timeout: 120000, 
          env: { ...process.env, PATH: `/usr/local/Homebrew/bin:${process.env.PATH}` }
        })
      } catch (e: any) {
        return reply.code(500).send({ 
          success: false, 
          error: `构建失败: ${e.message?.slice(0, 200)}` 
        })
      }
    }

    // Launch Electron app
    try {
      tarsProcess = spawn('npx', ['electron', '.'], {
        cwd: TARS_APP_DIR,
        stdio: 'ignore',
        detached: true,
        env: { ...process.env, PATH: `/usr/local/Homebrew/bin:${process.env.PATH}` }
      })
      tarsProcess.unref()
      
      return reply.send({ 
        success: true, 
        message: 'Agent TARS 已启动',
        tools: getTARSMCPTools().flatMap(s => s.tools.map(t => ({ ...t, serverName: s.serverName })))
      })
    } catch (e: any) {
      return reply.code(500).send({ 
        success: false, 
        error: `启动失败: ${e.message?.slice(0, 200)}` 
      })
    }
  })

  // POST /api/v1/agent-tars/register-mcp
  app.post('/register-mcp', { preHandler: [app.authenticate] }, async (_req, reply) => {
    const servers = getTARSMCPTools()
    let registered = 0

    for (const server of servers) {
      const serverId = `agent-tars-${server.serverName}`
      const exists = sqlite.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(serverId)
      
      if (!exists) {
        sqlite.prepare(`INSERT INTO mcp_servers (id, name, command, args_json, env_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, 'STOPPED', ?)`)
          .run(serverId, server.serverName, server.command, JSON.stringify(server.args), '{}', Date.now())
      }

      for (const tool of server.tools) {
        const toolId = `${serverId}-${tool.name}`
        const toolExists = sqlite.prepare('SELECT id FROM mcp_tools WHERE id = ?').get(toolId)
        if (!toolExists) {
          sqlite.prepare(`INSERT INTO mcp_tools (id, server_id, name, description, inputSchema, risk_level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(toolId, serverId, tool.name, tool.description, JSON.stringify({}), tool.riskLevel, Date.now())
          registered++
        }
      }
    }

    return reply.send({ 
      success: true, 
      count: registered,
      message: `已注册 ${registered} 个 Agent TARS MCP 工具到数据库。重启后端以连接 MCP 服务器。`
    })
  })
}
