import chalk from 'chalk'
import { apiGet, apiPut, apiPublicGet } from '../api.js'

interface ProviderInfo {
  name: string; displayName: string; configured: boolean; defaultModel?: string
}

export async function modelCommand(opts: { set?: string; list?: boolean; provider?: string }) {
  try {
    const providers = await apiPublicGet('/api/providers') as { providers: ProviderInfo[] }
    const activeData = await apiGet('/api/v1/models') as { active?: string }

    if (!opts.set && !opts.list) {
      console.log(chalk.cyan.bold('\n📋 可用模型\n'))
      console.log(chalk.dim('─'.repeat(60)))
      for (const p of providers.providers) {
        const status = p.configured ? chalk.green('✅') : chalk.red('❌')
        console.log(`  ${status} ${chalk.bold(p.displayName)} (${p.name})`)
        if (p.configured) {
          try {
            const data = (await apiPublicGet(`/api/providers/${p.name}/models`)) as { models: string[] }
            const models: string[] = data.models || []
            for (const m of models.slice(0, 10)) {
              const isActive = activeData.active === m
              const marker = isActive ? chalk.green(' ▶') : '  '
              console.log(chalk.dim(`      ${marker} ${m}`))
            }
          } catch { /* skip */ }
        }
      }
      console.log('')
      console.log(chalk.dim('  用法: dasheng model --set deepseek-v4-pro'))
      return
    }

    if (opts.set) {
      await apiPut('/api/v1/models/active', { model: opts.set })
      console.log(chalk.green(`✅ 默认模型已设置为: ${opts.set}`))
      return
    }

    if (opts.list) {
      for (const p of providers.providers) {
        if (!p.configured) continue
        console.log(chalk.bold(`\n${p.displayName} (${p.name})`))
        try {
          const data = (await apiPublicGet(`/api/providers/${p.name}/models`)) as { models: string[] }
          for (const m of (data.models || [])) {
            console.log(chalk.dim(`  - ${m}`))
          }
        } catch { console.log(chalk.dim('  (无法获取模型列表)')) }
      }
    }
  } catch (err: any) {
    console.error(chalk.red(`模型操作失败: ${err.message}`))
    process.exit(1)
  }
}
