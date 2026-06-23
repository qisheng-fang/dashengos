#!/usr/bin/env node
// packages/cli/src/run.ts · DaShengOS CLI 入口 (Hermes 全量对齐)
import { Command } from 'commander'
import chalk from 'chalk'
import { showLogo } from './logo.js'
import { ensureAuth, logout } from './auth.js'
import { getConfig } from './config.js'
import { chatCommand } from './commands/chat.js'
import { modelCommand } from './commands/model.js'
import { providerCommand } from './commands/provider.js'
import { sessionsCommand } from './commands/sessions.js'
import { mcpCommand } from './commands/mcp.js'
import { skillsCommand } from './commands/skills.js'
import { memoryCommand } from './commands/memory.js'
import { configCommand } from './commands/config.js'
import { doctorCommand } from './commands/doctor.js'
import { logsCommand } from './commands/logs.js'
import { toolsCommand } from './commands/tools.js'
import { agentsCommand } from './commands/agents.js'
import { settingsCommand } from './commands/settings.js'
import { generateCompletion } from './completion.js'

const program = new Command()

program
  .name('dasheng')
  .description('DaShengOS v6.0 · OMNI-BRAIN EDITION · 私有 AI 工作台 CLI')
  .version('6.0.0')

// ═══════════════════════════════════════════════════
// 默认: 交互对话
// ═══════════════════════════════════════════════════
program
  .action(async () => {
    await chatCommand({})
  })

// ═══════════════════════════════════════════════════
// chat — 增强对话 (Hermes 对齐)
// ═══════════════════════════════════════════════════
program
  .command('chat')
  .description('交互式对话 / 单次查询')
  .option('-q, --query <text>', '单次查询 (非交互)')
  .option('--image <path>', '附加图片')
  .option('-m, --model <name>', '模型覆盖')
  .option('--provider <name>', 'Provider 覆盖')
  .option('-r, --resume <id>', '恢复会话')
  .option('-c, --continue [name]', '继续最近的会话')
  .option('--max-turns <n>', '最大工具迭代次数', '25')
  .option('-s, --skills <list>', '预加载技能 (逗号分隔)')
  .option('-t, --toolsets <list>', '工具集选择 (逗号分隔)')
  .option('-v, --verbose', '详细输出')
  .option('-Q, --quiet', '静默模式')
  .option('--tui', '现代 TUI 模式')
  .option('--yolo', '自动批准危险命令')
  .option('-w, --worktree', 'Git worktree 隔离模式')
  .action(async (opts) => {
    await chatCommand({
      model: opts.model,
      provider: opts.provider,
      resume: opts.resume,
      continueSession: opts.continue,
      maxTurns: parseInt(opts.maxTurns, 10) || 25,
      skills: opts.skills,
      toolsets: opts.toolsets,
      verbose: opts.verbose,
      quiet: opts.quiet,
      tui: opts.tui,
      yolo: opts.yolo,
      worktree: opts.worktree,
      query: opts.query,
      image: opts.image,
    })
  })

// ═══════════════════════════════════════════════════
// ask — 单次查询 (快捷命令)
// ═══════════════════════════════════════════════════
program
  .command('ask [query...]')
  .description('单次查询，返回结果后退出')
  .option('-m, --model <name>', '指定模型')
  .option('--provider <name>', '指定 Provider')
  .option('-Q, --quiet', '静默模式 (只输出回答)')
  .action(async (query: string[], opts) => {
    const msg = query?.join(' ') || ''
    if (!msg) { console.log(chalk.red('请提供查询内容')); process.exit(1); }
    await chatCommand({
      query: msg,
      model: opts.model,
      provider: opts.provider,
      quiet: opts.quiet ?? true,
    })
  })

// ═══════════════════════════════════════════════════
// model — 模型选择器
// ═══════════════════════════════════════════════════
program
  .command('model')
  .description('查看/选择默认模型')
  .option('-s, --set <name>', '设置默认模型')
  .option('-l, --list', '列出所有可用模型')
  .option('--provider <name>', '按 Provider 过滤')
  .action(async (opts) => {
    await modelCommand({ set: opts.set, list: opts.list, provider: opts.provider })
  })

// ═══════════════════════════════════════════════════
// provider — Provider 管理
// ═══════════════════════════════════════════════════
program
  .command('provider <subcommand> [args...]')
  .description('Provider 管理: list | test | set-active | credentials')
  .action(async (subcommand: string, args: string[]) => {
    await providerCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// sessions — 会话管理
// ═══════════════════════════════════════════════════
program
  .command('sessions <subcommand> [args...]')
  .description('会话管理: list | resume | delete | stats | export | rename')
  .action(async (subcommand: string, args: string[]) => {
    await sessionsCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// mcp — MCP 管理
// ═══════════════════════════════════════════════════
program
  .command('mcp <subcommand> [args...]')
  .description('MCP 管理: list | tools | health | add | remove | start | stop')
  .action(async (subcommand: string, args: string[]) => {
    await mcpCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// skills — 技能管理
// ═══════════════════════════════════════════════════
program
  .command('skills <subcommand> [args...]')
  .description('技能管理: list | marketplace | install | uninstall | execute')
  .action(async (subcommand: string, args: string[]) => {
    await skillsCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// memory — 记忆管理
// ═══════════════════════════════════════════════════
program
  .command('memory <subcommand> [args...]')
  .description('记忆管理: list | search | context | summarize | delete')
  .action(async (subcommand: string, args: string[]) => {
    await memoryCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// config — 配置管理
// ═══════════════════════════════════════════════════
program
  .command('config <subcommand> [args...]')
  .description('配置管理: show | set | path | edit')
  .action(async (subcommand: string, args: string[]) => {
    await configCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// login / logout
// ═══════════════════════════════════════════════════
program
  .command('login')
  .description('登录到 DaShengOS 后端')
  .option('-p, --password <pw>', '密码')
  .action(async (opts) => {
    try {
      const data = await ensureAuth(opts.password)
      console.log(chalk.green(`✅ 已登录 (${data.user.username}/${data.user.role})`))
      console.log(chalk.dim(`  token: ${new Date(data.expires_at).toLocaleString()}`))
    } catch (err: any) {
      console.error(chalk.red(`登录失败: ${err.message}`))
      process.exit(1)
    }
  })

program
  .command('logout')
  .description('登出并清除 token')
  .action(() => logout())

// ═══════════════════════════════════════════════════
// status / health / doctor
// ═══════════════════════════════════════════════════
program
  .command('status')
  .description('查看后端运行状态')
  .action(async () => {
    try {
      const resp = await fetch(`${getConfig().backendUrl}/api/status`)
      const data = await resp.json()
      console.log(chalk.cyan.bold('\n📊 DaShengOS 状态\n'))
      const d = data as any
      console.log(`  版本: ${d.version}`)
      console.log(`  运行时间: ${Math.floor(d.uptime_sec / 60)} 分钟`)
      console.log(`  Providers: ${d.provider_summary?.configured || 0}/${d.provider_summary?.total || 0}`)
      console.log('')
    } catch (err: any) {
      console.error(chalk.red(`无法连接后端: ${err.message}`))
      process.exit(1)
    }
  })

program
  .command('health')
  .description('后端健康检查')
  .action(async () => {
    try {
      const resp = await fetch(`${getConfig().backendUrl}/api/v1/health/ping`)
      const data = await resp.json()
      console.log(chalk.green('✅ 后端在线'))
      console.log(data)
    } catch (err: any) {
      console.error(chalk.red(`❌ 后端不可达: ${err.message}`))
      process.exit(1)
    }
  })

program
  .command('doctor')
  .description('系统全面诊断')
  .action(async () => {
    await doctorCommand()
  })

// ═══════════════════════════════════════════════════
// logs — 日志查看
// ═══════════════════════════════════════════════════
program
  .command('logs')
  .description('查看审计日志')
  .option('-n <n>', '显示最近 N 条', '20')
  .option('-f, --follow', '持续跟踪')
  .action(async (opts) => {
    await logsCommand({ n: opts.n, follow: opts.follow })
  })

// ═══════════════════════════════════════════════════
// tools — 工具管理
// ═══════════════════════════════════════════════════
program
  .command('tools')
  .description('列出已注册工具')
  .option('-l, --list', '列表模式')
  .option('-e, --enabled', '仅显示启用的')
  .option('--server <name>', '按 MCP 服务器过滤')
  .action(async (opts) => {
    await toolsCommand({ list: opts.list, enabled: opts.enabled, server: opts.server })
  })

// ═══════════════════════════════════════════════════
// agents — Agent 管理
// ═══════════════════════════════════════════════════
program
  .command('agents <subcommand> [args...]')
  .description('Agent 管理: list | invoke')
  .action(async (subcommand: string, args: string[]) => {
    await agentsCommand(subcommand, args)
  })

// ═══════════════════════════════════════════════════
// settings — 全局设置
// ═══════════════════════════════════════════════════
program
  .command('settings')
  .description('查看全局设置')
  .action(async () => {
    await settingsCommand()
  })

// ═══════════════════════════════════════════════════
// completion — Shell 补全
// ═══════════════════════════════════════════════════
program
  .command('completion <shell>')
  .description('生成 Shell 补全脚本 (bash/zsh/fish)')
  .action(async (shell: string) => {
    generateCompletion(program, shell)
  })

// ═══════════════════════════════════════════════════
// version
// ═══════════════════════════════════════════════════
program
  .command('version')
  .description('显示版本信息')
  .action(() => {
    showLogo()
  })

program.parse()
