// packages/cli/src/commands/mcp.ts · MCP 管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost } from '../api.js'

interface McpServer {
  id: string
  name: string
  status: 'running' | 'stopped' | 'error'
  toolCount?: number
  latency?: number
}

export async function mcpCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiGet('/api/v1/mcp/servers') as { servers?: McpServer[] }
        const servers = data.servers || []
        console.log(chalk.cyan.bold(`\n🔌 MCP 服务器 (${servers.length})\n`))
        for (const s of servers) {
          const icon = s.status === 'running' ? '🟢' : s.status === 'error' ? '🔴' : '🟡'
          const tools = s.toolCount ? chalk.dim(` (${s.toolCount} tools)`) : ''
          console.log(`  ${icon} ${chalk.bold(s.name)}${tools}`)
        }
        console.log('')
        break
      }
      case 'tools': {
        const data = await apiGet('/api/v1/mcp/tools') as { tools?: Array<{ name: string; server: string; description?: string }> }
        const tools = data.tools || []
        console.log(chalk.cyan.bold(`\n🔧 MCP 工具 (${tools.length})\n`))
        for (const t of tools.slice(0, 30)) {
          console.log(chalk.dim(`  ${t.server ? `[${t.server}]` : ''} ${chalk.bold(t.name)}`))
        }
        if (tools.length > 30) console.log(chalk.dim(`  ... 还有 ${tools.length - 30} 个`))
        console.log('')
        break
      }
      case 'health': {
        const data = await apiGet('/api/v1/mcp/health') as { servers?: Array<{ name: string; alive: boolean; latency?: number }> }
        console.log(chalk.cyan.bold('\n💓 MCP 健康状态\n'))
        for (const s of (data.servers || [])) {
          const icon = s.alive ? chalk.green('✅') : chalk.red('❌')
          const lat = s.latency ? chalk.dim(` (${s.latency}ms)`) : ''
          console.log(`  ${icon} ${chalk.bold(s.name)}${lat}`)
        }
        console.log('')
        break
      }
      case 'add': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng mcp add <server-name>')); return }
        const data = await apiPost('/api/v1/mcp/servers', { name, command: args.slice(1).join(' ') })
        console.log(chalk.green(`✅ MCP 服务器已添加: ${data.id || name}`))
        break
      }
      case 'remove':
      case 'rm': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng mcp remove <name>')); return }
        console.log(chalk.yellow('⚠ 后端暂不支持 MCP 删除 API，请通过 Web UI 操作'))
        break
      }
      case 'start': {
        const id = args[0]
        if (!id) { console.log(chalk.red('用法: dasheng mcp start <server-id>')); return }
        await apiPost(`/api/v1/mcp/servers/${id}/start`)
        console.log(chalk.green(`✅ MCP 服务器已启动: ${id}`))
        break
      }
      case 'stop': {
        const id = args[0]
        if (!id) { console.log(chalk.red('用法: dasheng mcp stop <server-id>')); return }
        await apiPost(`/api/v1/mcp/servers/${id}/stop`)
        console.log(chalk.green(`✅ MCP 服务器已停止: ${id}`))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, tools, health, add, remove, start, stop'))
    }
  } catch (err: any) {
    console.error(chalk.red(`MCP 操作失败: ${err.message}`))
    process.exit(1)
  }
}
