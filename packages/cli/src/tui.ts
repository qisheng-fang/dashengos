// packages/cli/src/tui.ts · DaShengOS 终端 UI
import * as readline from 'node:readline'
import fs from 'node:fs'
import path from 'node:path'
import chalk from 'chalk'
import { streamChat, type StreamEvent } from './client.js'
import { getConfig, HISTORY_FILE, DASHENG_DIR } from './config.js'
import { showLogo } from './logo.js'

const HISTORY_MAX = 500

class TUI {
  private rl: readline.Interface
  private history: string[] = []
  private conversation: Array<{ role: string; content: string }> = []
  private lastStatusLine = ''

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan.bold('dasheng › '),
      historySize: HISTORY_MAX,
    })
    this.loadHistory()
  }

  private loadHistory() {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const data = fs.readFileSync(HISTORY_FILE, 'utf-8')
        this.history = data.split('\n').filter(Boolean).slice(-HISTORY_MAX)
        for (const h of this.history) {
          (this.rl as any).history?.push(h)
        }
      }
    } catch { /* ok */ }
  }

  private saveHistory(input: string) {
    this.history.push(input)
    if (this.history.length > HISTORY_MAX) {
      this.history = this.history.slice(-HISTORY_MAX)
    }
    if (!fs.existsSync(DASHENG_DIR)) {
      fs.mkdirSync(DASHENG_DIR, { recursive: true })
    }
    fs.writeFileSync(HISTORY_FILE, this.history.join('\n'), { mode: 0o600 })
  }

  private status(msg: string) {
    if (process.stdout.isTTY && this.lastStatusLine) {
      // 清除当前行
      readline.cursorTo(process.stdout, 0)
      readline.clearLine(process.stdout, 0)
    }
    process.stdout.write(chalk.dim(`  ${msg}\r`))
    this.lastStatusLine = msg
  }

  private clearStatus() {
    if (process.stdout.isTTY && this.lastStatusLine) {
      readline.cursorTo(process.stdout, 0)
      readline.clearLine(process.stdout, 0)
      this.lastStatusLine = ''
    }
  }

  private onStreamEvent(evt: StreamEvent) {
    switch (evt.type) {
      case 'status':
        this.status(chalk.blue('🔹 ') + evt.text)
        break
      case 'thinking':
        this.status(chalk.magenta('🧠 思考中... ') + chalk.dim(evt.text?.slice(0, 60)))
        break
      case 'searching':
        this.status(chalk.yellow('🔍 搜索中... ') + chalk.dim(evt.text?.slice(0, 60)))
        break
      case 'tool_start':
        this.clearStatus()
        console.log(chalk.yellow(`  🔧 ${evt.tool || '工具'}`) + chalk.dim(` ${evt.args || ''}`.slice(0, 80)))
        this.status(chalk.yellow('⏳ 执行中...'))
        break
      case 'tool_end':
        this.clearStatus()
        if (evt.error) {
          console.log(chalk.red(`  ❌ ${evt.tool || '工具'} 失败: ${evt.error}`))
        } else {
          const short = (evt.result || '').slice(0, 100)
          console.log(chalk.green(`  ✅ ${evt.tool || '工具'} 完成`) + chalk.dim(` ${short}`))
        }
        break
      case 'token':
        this.clearStatus()
        process.stdout.write(evt.text || '')
        break
      case 'step_log':
        if (evt.step) {
          this.clearStatus()
          console.log(
            chalk.dim(`  [${evt.step.index}] ${evt.step.phase}`) +
            chalk.dim(` ${evt.step.detail}`) +
            chalk.dim(` (${evt.step.elapsed_ms}ms)`)
          )
        }
        break
      case 'usage':
        this.clearStatus()
        if (evt.usage) {
          console.log(
            chalk.dim(`  ⏱ Token: ${evt.usage.total} (提示${evt.usage.prompt}+生成${evt.usage.completion})`)
          )
        }
        break
      case 'done':
        this.clearStatus()
        break
      case 'error':
        this.clearStatus()
        console.log(chalk.red(`  ⚠ 错误: ${evt.error}`))
        break
    }
  }

  async chat(input: string) {
    const trimmed = input.trim()
    if (!trimmed) return

    // 特殊命令
    if (trimmed === '/clear') {
      this.conversation = []
      console.log(chalk.dim('  🗑 对话已清空'))
      return
    }
    if (trimmed === '/history') {
      for (const [i, h] of this.history.entries()) {
        console.log(chalk.dim(`  ${i + 1}. ${h}`))
      }
      return
    }
    if (trimmed === '/model') {
      const cfg = getConfig()
      console.log(chalk.dim(`  当前模型: ${cfg.model || '默认'}`))
      console.log(chalk.dim(`  后端: ${cfg.backendUrl}`))
      return
    }

    this.saveHistory(trimmed)
    this.conversation.push({ role: 'user', content: trimmed })

    console.log('') // 空行分隔

    try {
      const response = await streamChat(trimmed, (evt) => this.onStreamEvent(evt), {
        history: this.conversation.slice(0, -1),
      })
      console.log('') // 空行
      if (response) {
        this.conversation.push({ role: 'assistant', content: response })
      }
    } catch (err: any) {
      this.clearStatus()
      if (err.name === 'AbortError') {
        console.log(chalk.yellow('  ⚡ 已中断'))
      } else {
        console.log(chalk.red(`  ✖ ${err.message}`))
      }
    }
  }

  async start() {
    showLogo()

    // 加载 token
    try {
      const { ensureAuth } = await import('./auth.js')
      await ensureAuth()
      console.log(chalk.green('✅ 已认证'))
    } catch (err: any) {
      console.log(chalk.yellow(`⚠  ${err.message}`))
      console.log(chalk.dim('  运行 dasheng login 登录'))
    }

    console.log('')
    this.rl.prompt()

    this.rl.on('line', async (line: string) => {
      const trimmed = line.trim()
      if (trimmed === '/exit' || trimmed === '/quit') {
        this.rl.close()
        return
      }
      if (trimmed === '/help') {
        console.log(chalk.dim('  命令: /clear /history /model /exit /help'))
        console.log(chalk.dim('  多行: 行尾 \\ 继续输入'))
        this.rl.prompt()
        return
      }

      // 多行续行
      if (trimmed.endsWith('\\')) {
        const cont = await this.multilinePrompt(trimmed.slice(0, -1))
        await this.chat(cont)
        this.rl.prompt()
        return
      }

      await this.chat(trimmed)
      this.rl.prompt()
    })

    this.rl.on('close', () => {
      console.log(chalk.dim('\n  再见 👋'))
      process.exit(0)
    })
  }

  private multilinePrompt(first: string): Promise<string> {
    return new Promise((resolve) => {
      let buf = first
      const multi = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.dim('... '),
      })
      multi.prompt()
      multi.on('line', (line) => {
        if (line.trim().endsWith('\\')) {
          buf += '\n' + line.trim().slice(0, -1)
          multi.prompt()
        } else {
          buf += '\n' + line
          multi.close()
          resolve(buf)
        }
      })
      multi.on('close', () => resolve(buf))
    })
  }
}

export { TUI }
