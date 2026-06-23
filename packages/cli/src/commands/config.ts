// packages/cli/src/commands/config.ts · 配置管理 (Hermes 对齐)
import chalk from 'chalk'
import fs from 'node:fs'
import path from 'node:path'
import { DASHENG_DIR } from '../config.js'
import { apiGet, apiPut } from '../api.js'

const LOCAL_CONFIG = path.join(DASHENG_DIR, 'config.json')

function loadLocal(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf-8')) } catch { return {} }
}

function saveLocal(data: Record<string, unknown>) {
  if (!fs.existsSync(DASHENG_DIR)) fs.mkdirSync(DASHENG_DIR, { recursive: true })
  fs.writeFileSync(LOCAL_CONFIG, JSON.stringify(data, null, 2), { mode: 0o600 })
}

export async function configCommand(subcommand: string, args: string[]) {
  try {
    switch (subcommand) {
      case 'show': {
        const local = loadLocal()
        let server: Record<string, unknown> = {}
        try { server = await apiGet('/api/v1/settings') } catch { /* offline */ }

        console.log(chalk.cyan.bold('\n⚙ 配置\n'))
        console.log(chalk.bold('本地 (~/.dasheng/config.json):'))
        console.log(JSON.stringify(local, null, 2) || '  (空)')
        console.log(chalk.bold('\n后端 (/api/v1/settings):'))
        console.log(JSON.stringify(server, null, 2) || '  (离线)')
        console.log('')
        break
      }
      case 'set': {
        const key = args[0]
        const value = args[1]
        if (!key || value === undefined) { console.log(chalk.red('用法: dasheng config set <key> <value>')); return }
        const local = loadLocal()
        local[key] = value
        saveLocal(local)
        console.log(chalk.green(`✅ ${key} = ${value}`))
        break
      }
      case 'path':
        console.log(LOCAL_CONFIG)
        break
      case 'edit':
        console.log(chalk.yellow('请手动编辑: ' + LOCAL_CONFIG))
        break
      default:
        console.log(chalk.yellow(`未知子命令: ${subcommand}`))
        console.log(chalk.dim('可用: show, set, path, edit'))
    }
  } catch (err: any) {
    console.error(chalk.red(`配置操作失败: ${err.message}`))
    process.exit(1)
  }
}
