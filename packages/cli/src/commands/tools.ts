// packages/cli/src/commands/tools.ts · 工具管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet } from '../api.js'

interface Tool {
  name: string; id?: string
  description?: string
  category?: string
  server?: string
  enabled?: boolean
}

export async function toolsCommand(opts: { list?: boolean; enabled?: boolean; server?: string }) {
  try {
    const data = await apiGet('/api/v1/tools') as { tools?: Tool[] }
    let tools = data.tools || []

    // 过滤
    if (opts.server) {
      tools = tools.filter(t => t.server === opts.server)
    }

    console.log(chalk.cyan.bold(`\n🔧 工具列表 (${tools.length})\n`))

    // 按分类分组
    const grouped: Record<string, Tool[]> = {}
    for (const t of tools) {
      const cat = t.category || '其他'
      if (!grouped[cat]) grouped[cat] = []
      grouped[cat].push(t)
    }

    for (const [cat, items] of Object.entries(grouped)) {
      console.log(chalk.bold(`  ${cat} (${items.length})`))
      for (const t of items) {
        const status = t.enabled !== false ? chalk.green(' ✅') : chalk.red(' ❌')
        const desc = t.description ? chalk.dim(` — ${t.description.slice(0, 60)}`) : ''
        console.log(`${status} ${chalk.bold(t.id || t.name)}${desc}`)
      }
      console.log('')
    }
  } catch (err: any) {
    console.error(chalk.red(`工具列表失败: ${err.message}`))
    process.exit(1)
  }
}
