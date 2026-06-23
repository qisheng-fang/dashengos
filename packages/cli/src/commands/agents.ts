// packages/cli/src/commands/agents.ts · Agent 管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost } from '../api.js'

interface Agent {
  id: string
  name: string
  type: string
  status?: string
  description?: string
}

export async function agentsCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiGet('/api/v1/agents') as { agents?: Agent[] }
        const agents = data.agents || []
        console.log(chalk.cyan.bold(`\n🤖 Agent 列表 (${agents.length})\n`))
        for (const a of agents) {
          const status = a.status === 'running' ? chalk.green('▶') : chalk.dim('■')
          console.log(`  ${status} ${chalk.bold(a.name)} ${chalk.dim(`[${a.type}]`)}`)
          if (a.description) console.log(chalk.dim(`    ${a.description.slice(0, 80)}`))
        }
        console.log('')
        break
      }
      case 'invoke': {
        const [id, ...rest] = args
        if (!id) { console.log(chalk.red('用法: dasheng agents invoke <id> [参数...]')); return }
        const result = await apiPost(`/api/v1/agents/${id}/invoke`, { params: rest })
        console.log(JSON.stringify(result, null, 2))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, invoke'))
    }
  } catch (err: any) {
    console.error(chalk.red(`Agent 操作失败: ${err.message}`))
    process.exit(1)
  }
}
