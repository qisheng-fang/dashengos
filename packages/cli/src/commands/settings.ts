// packages/cli/src/commands/settings.ts · 全局设置 (Hermes 对齐)
import chalk from 'chalk'
import { apiGet } from '../api.js'

export async function settingsCommand() {
  try {
    const data = await apiGet('/api/v1/settings') as Record<string, unknown>

    console.log(chalk.cyan.bold('\n⚙ 系统设置\n'))

    const skipKeys = ['jwt_secret', 'password_hash', 'api_key', 'secret']
    for (const [key, value] of Object.entries(data)) {
      const shouldMask = skipKeys.some(sk => key.toLowerCase().includes(sk))
      const display = shouldMask ? '***' : JSON.stringify(value)
      console.log(`  ${chalk.bold(key)}: ${chalk.dim(typeof value === 'object' ? JSON.stringify(value, null, 2).slice(0, 200) : String(value).slice(0, 120))}`)
    }
    console.log('')
  } catch (err: any) {
    console.error(chalk.red(`设置读取失败: ${err.message}`))
    process.exit(1)
  }
}
