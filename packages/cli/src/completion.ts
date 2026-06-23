// packages/cli/src/completion.ts · Shell 补全脚本 (Hermes 对齐)
import { Command } from 'commander'

export function generateCompletion(program: Command, shell: string) {
  const cmds = program.commands.map(c => c.name())
  const options = program.options.map(o => o.long?.replace('--', '') || o.short?.replace('-', '') || '').filter(Boolean)

  switch (shell) {
    case 'zsh':
      generateZsh(cmds, options)
      break
    case 'bash':
      generateBash(cmds, options)
      break
    case 'fish':
      generateFish(cmds, options)
      break
    default:
      console.log(`不支持的 shell: ${shell}`)
      process.exit(1)
  }
}

function generateZsh(cmds: string[], options: string[]) {
  const allCmds = ['chat', 'ask', 'login', 'logout', 'status', 'health', 'model', 'provider', 'sessions', 'mcp', 'skills', 'memory', 'config', 'doctor', 'logs', 'tools', 'agents', 'settings', 'completion', 'version']
  console.log(`#compdef dasheng

_dasheng() {
  local -a subcmds
  subcmds=(
    ${allCmds.map(c => `'${c}:${c} command'`).join('\n    ')}
  )

  local curcontext="\$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
    '(-h --help)'{-h,--help}'[显示帮助]' \\
    '(-V --version)'{-V,--version}'[显示版本]' \\
    '1: :->subcmd' \\
    '*:: :->args'

  case \$state in
    subcmd)
      _describe -t commands 'dasheng commands' subcmds
      ;;
  esac
}

_dasheng`)
}

function generateBash(cmds: string[], options: string[]) {
  console.log(`_dasheng_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local prev="\${COMP_WORDS[COMP_CWORD-1]}"

  local cmds="chat ask login logout status health model provider sessions mcp skills memory config doctor logs tools agents settings completion version"

  if [[ \${COMP_CWORD} -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "\${cmds}" -- "\${cur}") )
  fi
}

complete -F _dasheng_completion dasheng`)
}

function generateFish(cmds: string[], options: string[]) {
  console.log(`complete -c dasheng -f
${cmds.map(c => `complete -c dasheng -n "__fish_use_subcommand" -a ${c} -d "${c} 命令"`).join('\n')}`)
}
