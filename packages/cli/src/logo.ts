// packages/cli/src/logo.ts · DaShengOS ASCII Logo
import chalk from 'chalk'

export function showLogo() {
  const lines = [
    chalk.cyan('╔══════════════════════════════════════════════════════╗'),
    chalk.cyan('║') + chalk.cyan.bold('  ██████╗   █████╗ ███████╗██╗  ██╗███████╗███╗   ██╗ ██████╗ ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.cyan.bold('  ██╔══██╗ ██╔══██╗██╔════╝██║  ██║██╔════╝████╗  ██║██╔════╝ ') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.cyan.bold('  ██║  ██║ ███████║███████╗███████║█████╗  ██╔██╗ ██║██║  ███╗') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.cyan.bold('  ██║  ██║ ██╔══██║╚════██║██╔══██║██╔══╝  ██║╚██╗██║██║   ██║') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.cyan.bold('  ██████╔╝ ██║  ██║███████║██║  ██║███████╗██║ ╚████║╚██████╔╝') + chalk.cyan('║'),
    chalk.cyan('║') + chalk.cyan.bold('  ╚═════╝  ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝ ╚═════╝ ') + chalk.cyan('║'),
    chalk.cyan('║                                                      ║'),
    chalk.cyan('║  ') + chalk.green.bold('⚡ v6.0 · OMNI-BRAIN EDITION · 私有 AI 工作台 · 全域代理') + chalk.cyan('  ║'),
    chalk.cyan('╚══════════════════════════════════════════════════════╝'),
    '',
    chalk.dim('  $ dasheng // 开始对话'),
    chalk.dim('  $ dasheng --help // 查看命令'),
    '',
  ]
  for (const line of lines) {
    console.log(line)
  }
}
