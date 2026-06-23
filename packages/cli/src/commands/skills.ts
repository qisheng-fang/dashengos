// packages/cli/src/commands/skills.ts · 技能管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost } from '../api.js'

interface Skill {
  id: string
  name: string
  description?: string
  category?: string
  installed?: boolean
}

export async function skillsCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiGet('/api/v1/skills') as { skills?: Skill[] }
        const skills = data.skills || []
        console.log(chalk.cyan.bold(`\n🛠 已安装技能 (${skills.length})\n`))
        for (const s of skills.slice(0, 30)) {
          const desc = s.description ? chalk.dim(` — ${s.description.slice(0, 50)}`) : ''
          console.log(`  ${chalk.bold(s.name)}${desc}`)
        }
        if (skills.length > 30) console.log(chalk.dim(`  ... 还有 ${skills.length - 30} 个`))
        console.log('')
        break
      }
      case 'marketplace': {
        const data = await apiGet('/api/v1/skills/marketplace') as { skills?: Skill[]; categories?: string[] }
        console.log(chalk.cyan.bold('\n🏪 技能市场\n'))
        if (data.categories) {
          console.log(chalk.dim('  分类: ' + data.categories.join(', ')) + '\n')
        }
        for (const s of (data.skills || []).slice(0, 30)) {
          const cat = s.category ? chalk.dim(`[${s.category}]`) : ''
          console.log(`  ${chalk.bold(s.name)} ${cat}`)
          if (s.description) console.log(chalk.dim(`    ${s.description.slice(0, 80)}`))
        }
        console.log('')
        break
      }
      case 'install': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng skills install <name>')); return }
        await apiPost('/api/v1/skills/install', { name })
        console.log(chalk.green(`✅ 技能已安装: ${name}`))
        break
      }
      case 'uninstall': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng skills uninstall <name>')); return }
        await apiPost(`/api/v1/skills/${name}/uninstall`)
        console.log(chalk.green(`✅ 技能已卸载: ${name}`))
        break
      }
      case 'execute': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng skills execute <name>')); return }
        const result = await apiPost(`/api/v1/skills/available/${name}/execute`)
        console.log(JSON.stringify(result, null, 2))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, marketplace, install, uninstall, execute'))
    }
  } catch (err: any) {
    console.error(chalk.red(`技能操作失败: ${err.message}`))
    process.exit(1)
  }
}
