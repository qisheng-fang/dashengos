// packages/cli/src/commands/logs.ts · 日志查看 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet } from '../api.js'

interface AuditLog {
  id: string
  action: string
  user_id?: string
  created_at?: number
  detail?: string
}

export async function logsCommand(opts: { n?: string; follow?: boolean }) {
  try {
    const limit = parseInt(opts.n || '20', 10)
    const data = await apiGet(`/api/v1/audit/logs?limit=${limit}`) as { logs?: AuditLog[] }
    const logs = data.logs || []

    console.log(chalk.cyan.bold(`\n📜 最近 ${logs.length} 条日志\n`))
    console.log(chalk.dim('─'.repeat(80)))

    for (const l of logs) {
      const date = l.created_at ? new Date(l.created_at).toLocaleString() : '?'
      const user = l.user_id ? chalk.dim(`[${l.user_id.slice(0, 8)}]`) : ''
      console.log(chalk.dim(`  ${date}`) + ` ${chalk.bold(l.action)} ${user}`)
      if (l.detail) console.log(chalk.dim(`    ${l.detail.slice(0, 100)}`))
    }
    console.log(chalk.dim('─'.repeat(80)))
    console.log('')
  } catch (err: any) {
    console.error(chalk.red(`日志读取失败: ${err.message}`))
    process.exit(1)
  }
}
