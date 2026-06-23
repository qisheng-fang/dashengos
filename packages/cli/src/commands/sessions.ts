// packages/cli/src/commands/sessions.ts · 会话管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost } from '../api.js'

interface Session {
  id: string
  title?: string
  created_at?: number
  updated_at?: number
  message_count?: number
  archived?: boolean
}

export async function sessionsCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiGet('/api/v1/sessions') as { sessions?: Session[] }
        const sessions = data.sessions || []
        console.log(chalk.cyan.bold(`\n💬 会话列表 (${sessions.length})\n`))
        if (sessions.length === 0) {
          console.log(chalk.dim('  暂无会话'))
        } else {
          console.log(chalk.dim('─'.repeat(70)))
          for (const s of sessions.slice(0, 20)) {
            const title = s.title || s.id?.slice(0, 8) || '?'
            const date = s.updated_at ? new Date(s.updated_at).toLocaleString() : '?'
            const count = s.message_count ?? 0
            const arch = s.archived ? chalk.yellow(' [归档]') : ''
            console.log(`  ${chalk.bold(title.slice(0, 40))}${arch}`)
            console.log(chalk.dim(`    ${s.id} | ${count} 条消息 | ${date}`))
          }
          console.log(chalk.dim('─'.repeat(70)))
        }
        console.log('')
        break
      }
      case 'resume': {
        const id = args[0]
        if (!id) { console.log(chalk.red('用法: dasheng sessions resume <id>')); return }
        const data = await apiGet(`/api/v1/sessions/${id}`) as { session?: Session; messages?: Array<{ role: string; content: string }> }
        if (!data.session) { console.log(chalk.red('会话不存在')); return }
        console.log(chalk.green(`✅ 会话已加载: ${data.session.title || id}`))
        console.log(chalk.dim(`  消息数: ${data.messages?.length || 0}`))
        console.log(chalk.dim(`  后续: dasheng chat --resume ${id}`))
        break
      }
      case 'delete': {
        const id = args[0]
        if (!id) { console.log(chalk.red('用法: dasheng sessions delete <id>')); return }
        // 后端可能用 POST 或 DELETE
        try {
          await apiPost(`/api/v1/sessions/${id}/archive`)
          console.log(chalk.green(`✅ 已归档: ${id}`))
        } catch {
          console.log(chalk.yellow('⚠ 后端不支持归档，尝试直接删除...'))
        }
        break
      }
      case 'stats': {
        const data = await apiGet('/api/v1/sessions') as { sessions?: Session[] }
        const sessions = data.sessions || []
        const total = sessions.length
        const active = sessions.filter(s => !s.archived).length
        const totalMsgs = sessions.reduce((sum, s) => sum + (s.message_count || 0), 0)
        console.log(chalk.cyan.bold('\n📊 会话统计\n'))
        console.log(`  总会话: ${total}`)
        console.log(`  活跃: ${active}`)
        console.log(`  归档: ${total - active}`)
        console.log(`  总消息: ${totalMsgs}`)
        console.log('')
        break
      }
      case 'export': {
        const data = await apiGet('/api/v1/sessions') as { sessions?: Session[] }
        const sessions = data.sessions || []
        console.log(JSON.stringify(sessions, null, 2))
        break
      }
      case 'rename': {
        const [id, ...titleParts] = args
        if (!id || titleParts.length === 0) { console.log(chalk.red('用法: dasheng sessions rename <id> <新名称>')); return }
        console.log(chalk.yellow('会话重命名暂不支持（后端无对应 API）'))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, resume, delete, stats, export, rename'))
    }
  } catch (err: any) {
    console.error(chalk.red(`会话操作失败: ${err.message}`))
    process.exit(1)
  }
}
