// packages/cli/src/commands/provider.ts · Provider 管理 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet, apiPost, apiPublicGet } from '../api.js'

export async function providerCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'list':
      case 'ls': {
        const data = await apiPublicGet('/api/providers') as { providers: Array<{ name: string; displayName: string; configured: boolean; defaultModel?: string }> }
        console.log(chalk.cyan.bold('\n🔌 已配置 Provider\n'))
        for (const p of data.providers) {
          const s = p.configured ? chalk.green('✅') : chalk.red('❌')
          const model = p.defaultModel ? chalk.dim(` (${p.defaultModel})`) : ''
          console.log(`  ${s} ${chalk.bold(p.displayName)} ${chalk.dim(`[${p.name}]`)}${model}`)
        }
        console.log('')
        break
      }
      case 'test': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng provider test <name>')); return }
        const result = await apiPost(`/api/providers/${name}/test`)
        console.log(result.ok ? chalk.green(`✅ ${name} 正常`) : chalk.red(`❌ ${name}: ${result.error || '未知错误'}`))
        break
      }
      case 'set-active': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng provider set-active <name>')); return }
        await apiPost('/api/providers/active', { provider: name })
        console.log(chalk.green(`✅ 已切换 Provider: ${name}`))
        break
      }
      case 'credentials': {
        const name = args[0]
        if (!name) { console.log(chalk.red('用法: dasheng provider credentials <name>')); return }
        const creds = await apiGet(`/api/providers/${name}/credentials`)
        console.log(JSON.stringify(creds, null, 2))
        break
      }
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: list, test, set-active, credentials'))
    }
  } catch (err: any) {
    console.error(chalk.red(`Provider 操作失败: ${err.message}`))
    process.exit(1)
  }
}
