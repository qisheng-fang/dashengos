// packages/cli/src/commands/chat.ts · 增强 Chat 命令 (Hermes 对齐)
import chalk from 'chalk'
import { streamChat } from '../client.js'
import { showLogo } from '../logo.js'
import type { StreamEvent } from '../client.js'
import * as readline from 'node:readline'

export interface ChatOptions {
  model?: string
  provider?: string
  resume?: string
  continueSession?: string
  maxTurns?: number
  skills?: string
  toolsets?: string
  verbose?: boolean
  quiet?: boolean
  tui?: boolean
  yolo?: boolean
  worktree?: boolean
  query?: string
  image?: string
}

export async function chatCommand(opts: ChatOptions) {
  if (opts.model) process.env.DASHENG_MODEL = opts.model
  if (opts.provider) process.env.DASHENG_PROVIDER = opts.provider

  // Single query (non-interactive)
  if (opts.query) {
    if (!opts.quiet) showLogo()
    // ★ 即使 quiet 模式也显示工具调用状态，避免用户以为卡死
    const handler = createQueryHandler(opts.quiet ?? false, opts.verbose ?? false)
    const response = await streamChat(opts.query, handler, {
      threadId: opts.resume || opts.continueSession,
    })
    if (opts.quiet) {
      process.stdout.write('\n')
    }
    return
  }

  // Interactive REPL
  if (opts.quiet) {
    console.log(chalk.red('错误: --quiet 需要 -q/--query 参数'))
    process.exit(1)
  }
  await startInteractive(opts)
}

/** 单次查询的事件处理器：静默模式下隐藏思考但显示工具调用 */
function createQueryHandler(quiet: boolean, verbose: boolean): (evt: StreamEvent) => void {
  let firstToken = true
  let activeTools = 0

  return (evt) => {
    switch (evt.type) {
      case 'token':
        if (quiet && firstToken) {
          // 不额外换行，直接开始输出 token
          firstToken = false
        }
        process.stdout.write(evt.text || '')
        break
      case 'tool_start':
        activeTools++
        if (quiet || verbose) {
          console.log(chalk.yellow(`\n  🔧 ${evt.tool}`) + chalk.dim(` ${(evt.args || '').slice(0, 80)}`))
        }
        break
      case 'tool_end':
        activeTools--
        if (quiet || verbose) {
          const icon = evt.ok ? chalk.green('✅') : chalk.red('❌')
          const summary = evt.summary ? chalk.dim(` ${evt.summary.slice(0, 80)}`) : ''
          console.log(`  ${icon} ${evt.tool}${summary}`)
        }
        break
      case 'thinking':
        if (verbose) console.log(chalk.magenta(`  🧠 ${(evt.text || '').slice(0, 60)}`))
        break
      case 'searching':
        if (quiet || verbose) console.log(chalk.yellow(`  🔍 ${(evt.text || '').slice(0, 80)}`))
        break
      case 'status':
        if (verbose) console.log(chalk.dim(`  ${evt.text}`))
        break
      case 'error':
        console.log(chalk.red(`\n  ⚠ ${evt.error}`))
        break
      case 'usage':
        if (evt.usage && evt.usage.total > 0) {
          console.log(chalk.dim(`\n  ⏱ Token: ${evt.usage.total} (提示${evt.usage.prompt}+生成${evt.usage.completion})`))
        }
        break
    }
  }
}

function createEventHandler(verbose: boolean): (evt: StreamEvent) => void {
  return (evt) => {
    switch (evt.type) {
      case 'token':
        process.stdout.write(evt.text || '')
        break
      case 'tool_start':
        if (verbose) console.log(chalk.yellow(`\n  🔧 ${evt.tool || '工具'}`) + chalk.dim(` ${evt.args || ''}`.slice(0, 80)))
        break
      case 'tool_end':
        if (verbose) console.log(chalk.green(`  ✅ ${evt.tool || '工具'}`) + chalk.dim(evt.summary ? ` ${evt.summary.slice(0, 80)}` : ''))
        break
      case 'thinking':
        if (verbose) console.log(chalk.magenta(`  🧠 ${evt.text}`))
        break
      case 'error':
        console.log(chalk.red(`\n  ⚠ ${evt.error}`))
        break
      case 'usage':
        if (evt.usage && evt.usage.total > 0) {
          console.log(chalk.dim(`\n  ⏱ Token: ${evt.usage.total} (提示${evt.usage.prompt}+生成${evt.usage.completion})`))
        }
        break
    }
  }
}

async function startInteractive(opts: ChatOptions) {
  showLogo()
  console.log(chalk.dim(`  模型: ${opts.model || '默认'} | Provider: ${opts.provider || '默认'}`))
  if (opts.resume) console.log(chalk.dim(`  恢复会话: ${opts.resume}`))
  if (opts.skills) console.log(chalk.dim(`  技能: ${opts.skills}`))
  console.log('')

  const conversation: Array<{ role: string; content: string }> = []
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan.bold('dasheng › '),
  })

  rl.prompt()

  rl.on('line', async (line) => {
    const trimmed = line.trim()
    if (!trimmed) { rl.prompt(); return }
    if (trimmed === '/exit' || trimmed === '/quit') { rl.close(); return }
    if (trimmed === '/clear') { conversation.length = 0; console.log(chalk.dim('  🗑 清空')); rl.prompt(); return }
    if (trimmed === '/model') { console.log(chalk.dim(`  ${opts.model || process.env.DASHENG_MODEL || '默认'}`)); rl.prompt(); return }

    conversation.push({ role: 'user', content: trimmed })
    console.log('')

    try {
      const onEvent = createEventHandler(opts.verbose ?? false)
      const response = await streamChat(trimmed, onEvent, {
        history: conversation.slice(0, -1),
        threadId: opts.resume || opts.continueSession,
      })
      console.log('')
      if (response) conversation.push({ role: 'assistant', content: response })
    } catch (err: any) {
      console.log(chalk.red(`  ✖ ${err.message}`))
    }
    rl.prompt()
  })

  rl.on('close', () => {
    console.log(chalk.dim('\n  再见 👋'))
    process.exit(0)
  })
}
