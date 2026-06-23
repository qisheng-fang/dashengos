// packages/cli/src/commands/memory.ts · 记忆管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost, apiDelete } from '../api.js'

interface MemoryEntry {
  id: string
  content: string
  type?: string
  created_at?: number
  session_id?: string
}

export async function memoryCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiGet('/api/v1/memory') as { entries?: MemoryEntry[] }
        const entries = data.entries || []
        console.log(chalk.cyan.bold(`\n🧠 记忆条目 (${entries.length})\n`))
        for (const e of entries.slice(-20)) {
          const date = e.created_at ? new Date(e.created_at).toLocaleString() : '?'
          console.log(chalk.dim(`  [${date}]`))
          console.log(`  ${(e.content || '').slice(0, 120)}`)
          console.log('')
        }
        break
      }
      case 'search': {
        const query = args.join(' ')
        if (!query) { console.log(chalk.red('用法: dasheng memory search <关键词>')); return }
        const data = await apiGet(`/api/v1/memory/search?q=${encodeURIComponent(query)}`) as { results?: MemoryEntry[] }
        const results = data.results || []
        console.log(chalk.cyan.bold(`\n🔍 搜索结果: "${query}" (${results.length})\n`))
        for (const r of results) {
          console.log(`  ${(r.content || '').slice(0, 200)}`)
          console.log('')
        }
        break
      }
      case 'context': {
        const data = await apiGet('/api/v1/memory/context') as { context?: string; tokenCount?: number }
        console.log(chalk.cyan.bold(`\n📋 当前上下文 (${data.tokenCount || 0} tokens)\n`))
        console.log((data.context || '无').slice(0, 500))
        console.log('')
        break
      }
      case 'summarize': {
        const sessionId = args[0]
        if (!sessionId) { console.log(chalk.red('用法: dasheng memory summarize <sessionId>')); return }
        const result = await apiPost(`/api/v1/memory/summarize/${sessionId}`)
        console.log(chalk.green(`✅ 摘要完成: ${sessionId}`))
        console.log(JSON.stringify(result, null, 2))
        break
      }
      case 'delete': {
        const id = args[0]
        if (!id) { console.log(chalk.red('用法: dasheng memory delete <id>')); return }
        await apiDelete(`/api/v1/memory/${id}`)
        console.log(chalk.green(`✅ 已删除: ${id}`))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, search, context, summarize, delete'))
    }
  } catch (err: any) {
    console.error(chalk.red(`记忆操作失败: ${err.message}`))
    process.exit(1)
  }
}
