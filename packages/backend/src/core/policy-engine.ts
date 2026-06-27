// DaShengOS v6.0 · Unified Policy Engine
// 蓝图 §4-6: 统一风险评分 → 网络检测 → 本地/云端路由决策
// 注入点: misc.ts tools/:id/invoke，在 HITL 确认后、沙箱执行前

// ─── Types ────────────────────────────────────────────────

export type ExecutionTarget = 'local_sandbox' | 'cloud_runner' | 'reject'

export interface RiskAssessment {
  score: number              // 0-100 综合风险
  level: 'low' | 'medium' | 'high' | 'critical'
  needsNetwork: boolean       // 是否需要外网
  allowedDomains: string[]    // 白名单域名（空=不限）
  target: ExecutionTarget     // 推荐执行位置
  reasons: string[]           // 风险因素描述
  requiresApproval: boolean   // 是否需要用户确认
}

export interface PolicyDecision {
  allowed: boolean
  target: ExecutionTarget
  risk: RiskAssessment
  message: string
}

// ─── Blacklist Patterns ───────────────────────────────────

const DANGEROUS_PATTERNS = [
  // 系统破坏
  { pattern: /rm\s+-rf\s+\//, level: 'critical' as const, msg: '禁止递归删除根目录' },
  { pattern: /sudo\s/, level: 'critical' as const, msg: '禁止提权操作' },
  { pattern: /su\s/, level: 'critical' as const, msg: '禁止切换用户' },
  { pattern: /mkfs/, level: 'critical' as const, msg: '禁止格式化磁盘' },
  { pattern: /dd\s+if=/, level: 'critical' as const, msg: '禁止直接写磁盘' },
  { pattern: /chmod\s+777/, level: 'critical' as const, msg: '禁止全开放权限' },
  { pattern: /chmod\s+-R\s+777/, level: 'critical' as const, msg: '禁止递归全开放权限' },
  { pattern: /> \/dev\/sd/, level: 'critical' as const, msg: '禁止写块设备' },
  { pattern: /shutdown/, level: 'critical' as const, msg: '禁止关机/重启' },
  { pattern: /reboot/, level: 'critical' as const, msg: '禁止重启' },
  { pattern: /halt/, level: 'critical' as const, msg: '禁止停机' },
  { pattern: /fork\s*bomb|:\(\)\s*\{/, level: 'critical' as const, msg: '禁止 fork 炸弹' },

  // 管道下载执行
  { pattern: /curl.*\|.*sh/, level: 'critical' as const, msg: '禁止 curl|sh 模式' },
  { pattern: /curl.*\|.*bash/, level: 'critical' as const, msg: '禁止 curl|bash 模式' },
  { pattern: /wget.*\|.*sh/, level: 'critical' as const, msg: '禁止 wget|sh 模式' },
  { pattern: /wget.*\|.*bash/, level: 'critical' as const, msg: '禁止 wget|bash 模式' },
  { pattern: /curl.*\|.*sudo/, level: 'critical' as const, msg: '禁止 curl|sudo 模式' },

  // 敏感路径
  { pattern: /\/etc\/shadow/, level: 'critical' as const, msg: '禁止访问密码文件' },
  { pattern: /\/etc\/passwd/, level: 'critical' as const, msg: '禁止访问密码文件' },
  { pattern: /\/etc\/sudoers/, level: 'critical' as const, msg: '禁止修改 sudoers' },

  // 数据库破坏
  { pattern: /DROP\s+TABLE/i, level: 'high' as const, msg: 'DROP TABLE 需云端执行+审批' },
  { pattern: /DELETE\s+FROM/i, level: 'high' as const, msg: 'DELETE FROM 需云端执行+审批' },
  { pattern: /TRUNCATE/i, level: 'high' as const, msg: 'TRUNCATE 需云端执行+审批' },
]

// ─── Network Detection ────────────────────────────────────

const NETWORK_COMMANDS: { cmd: string; needsNetwork: boolean }[] = [
  // Always need network
  { cmd: 'curl', needsNetwork: true }, { cmd: 'wget', needsNetwork: true },
  { cmd: 'npm install', needsNetwork: true }, { cmd: 'pnpm install', needsNetwork: true },
  { cmd: 'yarn install', needsNetwork: true }, { cmd: 'pip install', needsNetwork: true },
  { cmd: 'pip3 install', needsNetwork: true }, { cmd: 'poetry add', needsNetwork: true },
  { cmd: 'poetry install', needsNetwork: true }, { cmd: 'go get', needsNetwork: true },
  { cmd: 'go install', needsNetwork: true }, { cmd: 'cargo install', needsNetwork: true },
  { cmd: 'gem install', needsNetwork: true },
  { cmd: 'git clone', needsNetwork: true }, { cmd: 'git fetch', needsNetwork: true },
  { cmd: 'git pull', needsNetwork: true }, { cmd: 'git push', needsNetwork: true },
  { cmd: 'docker pull', needsNetwork: true }, { cmd: 'docker push', needsNetwork: true },
  { cmd: 'brew install', needsNetwork: true }, { cmd: 'apt-get install', needsNetwork: true },
  { cmd: 'apt install', needsNetwork: true }, { cmd: 'npx', needsNetwork: true },
  { cmd: 'pnpm dlx', needsNetwork: true },
  // May need network (tool queries/version checks)
  { cmd: 'npm ', needsNetwork: true }, { cmd: 'pip ', needsNetwork: true },
  { cmd: 'pip3 ', needsNetwork: true }, { cmd: 'go ', needsNetwork: false },
  { cmd: 'cargo ', needsNetwork: false }, { cmd: 'git ', needsNetwork: false },
]

const NETWORK_DOMAIN_WHITELIST: Record<string, string[]> = {
  // npm
  'npm install': ['registry.npmjs.org', 'registry.yarnpkg.com'],
  'npx': ['registry.npmjs.org'],
  // Python
  'pip install': ['pypi.org', 'files.pythonhosted.org'],
  'pip3 install': ['pypi.org', 'files.pythonhosted.org'],
  'poetry add': ['pypi.org'],
  // Git
  'git clone': ['github.com', 'gitlab.com', 'bitbucket.org'],
  'git fetch': ['github.com', 'gitlab.com', 'bitbucket.org'],
  'git pull': ['github.com', 'gitlab.com', 'bitbucket.org'],
  'git push': ['github.com', 'gitlab.com', 'bitbucket.org'],
  // Go
  'go get': ['proxy.golang.org', 'github.com'],
  'go install': ['proxy.golang.org', 'github.com'],
  // Docker
  'docker pull': ['docker.io', 'registry-1.docker.io'],
  // Brew/macOS
  'brew install': ['formulae.brew.sh', 'ghcr.io'],
  // Generic
  'curl': [],   // empty = needs manual domain approval
  'wget': [],
}

// ─── Risk Calculator ──────────────────────────────────────

function detectNetwork(cmd: string): { needs: boolean; domains: string[] } {
  const lower = cmd.toLowerCase().trim()
  for (const nc of NETWORK_COMMANDS) {
    if (!nc.needsNetwork) continue  // skip non-network command prefixes
    if (lower.startsWith(nc.cmd) || lower.includes(` ${nc.cmd}`)) {
      const base = nc.cmd.split(' ').slice(0, 2).join(' ')
      return {
        needs: true,
        domains: NETWORK_DOMAIN_WHITELIST[nc.cmd] || NETWORK_DOMAIN_WHITELIST[base] || [],
      }
    }
  }
  // Detect generic network usage (curl/wget with URLs)
  if (lower.match(/(curl|wget)\s+https?:\/\//)) {
    return { needs: true, domains: [] } // needs manual approval
  }
  return { needs: false, domains: [] }
}

function detectSensitivePaths(cmd: string): string[] {
  const warnings: string[] = []
  const sensitivePaths = [
    /~\/\.ssh/, /~\/\.aws/, /~\/\.kube/, /~\/\.config\/gh/,
    /\/etc\/ssl/, /\/var\/root/, /\/root\//,
    /\$HOME\/\.ssh/, /\$HOME\/\.aws/, /\$HOME\/\.kube/,
  ]
  for (const sp of sensitivePaths) {
    if (sp.test(cmd)) {
      warnings.push(`检测到敏感路径: ${sp.source}`)
    }
  }
  return warnings
}

function detectFileOutput(cmd: string): boolean {
  // Detect redirects that write outside workspace
  return /[^>]>\s*[/~]/.test(cmd)
}

// ─── Main Risk Assessment ─────────────────────────────────

export function assessRisk(
  toolId: string,
  params: Record<string, any>,
  userId: string,
  role: string,
): RiskAssessment {
  const reasons: string[] = []
  let score = 0
  let level: RiskAssessment['level'] = 'low'

  // Extract the actual command from params
  const command = params.command || ''
  const args = params.args || []
  const fullCmd = typeof command === 'string'
    ? `${command} ${args.join(' ')}`.trim()
    : ''

  // 1. Blacklist check
  for (const dp of DANGEROUS_PATTERNS) {
    if (dp.pattern.test(fullCmd)) {
      return {
        score: 100,
        level: dp.level,
        needsNetwork: false,
        allowedDomains: [],
        target: 'reject',
        reasons: [dp.msg],
        requiresApproval: false,
      }
    }
  }

  // 2. Tool-based baseline risk
  const toolRiskMap: Record<string, number> = {
    'sandbox.exec': 30,
    'file.write': 40,
    'file.read': 5,
    'browser.navigate': 50,
    'browser.extract': 40,
    'secret.read': 90,
    'research.run': 20,
    'agent.run': 60,
  }
  score = toolRiskMap[toolId] || 25

  // 3. Network detection
  const net = detectNetwork(fullCmd)
  if (net.needs) {
    score += 30
    reasons.push('需要外网访问')
    if (net.domains.length === 0) {
      score += 20
      reasons.push('无预授权域名白名单，需手动审批')
    }
  }

  // 4. Sensitive path detection
  const pathWarnings = detectSensitivePaths(fullCmd)
  if (pathWarnings.length > 0) {
    score += 40
    reasons.push(...pathWarnings)
  }

  // 5. File output detection
  if (detectFileOutput(fullCmd)) {
    score += 20
    reasons.push('检测到文件重定向输出')
  }

  // 6. Command complexity (pipes, multiple commands)
  const pipeCount = (fullCmd.match(/\|/g) || []).length
  if (pipeCount > 2) {
    score += 15
    reasons.push(`复杂管道操作 (${pipeCount} 个管道)`)
  }
  const semicolonCount = (fullCmd.match(/;/g) || []).length
  if (semicolonCount > 2) {
    score += 10
    reasons.push(`多命令串联 (${semicolonCount} 个分号)`)
  }

  // 7. Determine level from score
  if (score >= 80) level = 'critical'
  else if (score >= 50) level = 'high'
  else if (score >= 25) level = 'medium'
  else level = 'low'

  // 8. Determine execution target
  // 只拒绝黑名单匹配的命令 (已在步骤1处理)
  // 网络命令 → 云端, 中高风险 → 本地确认, 低风险 → 本地直通
  let target: ExecutionTarget = 'local_sandbox'
  let requiresApproval = false

  if (net.needs) {
    // 网络命令 → 云端沙箱 + 确认
    target = 'cloud_runner'
    requiresApproval = true
    if (net.domains.length > 0) {
      reasons.push(`需网络访问: ${net.domains.join(', ')}`)
    } else {
      reasons.push('无预授权域名白名单，需手动审批域名')
    }
  } else if (score >= 50) {
    // 中高风险本地命令 → 本地 + 确认
    target = 'local_sandbox'
    requiresApproval = true
    reasons.push('中高风险命令，需确认后本地执行')
  } else if (score >= 25) {
    target = 'local_sandbox'
    requiresApproval = true
  } else {
    target = 'local_sandbox'
    requiresApproval = false
  }

  // 9. Admin override
  if (role === 'ADMIN' && score < 80) {
    requiresApproval = false  // admin can skip confirmation for non-critical
  }

  return {
    score,
    level,
    needsNetwork: net.needs,
    allowedDomains: net.domains,
    target,
    reasons,
    requiresApproval,
  }
}

// ─── Policy Decision (entry point for misc.ts) ────────────

export function evaluatePolicy(
  toolId: string,
  params: Record<string, any>,
  userId: string,
  role: string,
): PolicyDecision {
  const risk = assessRisk(toolId, params, userId, role)

  if (risk.target === 'reject') {
    return {
      allowed: false,
      target: 'reject',
      risk,
      message: `🚫 操作被拒绝: ${risk.reasons.join('; ')}`,
    }
  }

  if (risk.target === 'cloud_runner') {
    return {
      allowed: true,
      target: 'cloud_runner',
      risk,
      message: `☁️ 路由到云端执行 (风险: ${risk.score}/100): ${risk.reasons.join('; ')}`,
    }
  }

  return {
    allowed: true,
    target: 'local_sandbox',
    risk,
    message: `🏠 本地沙箱执行 (风险: ${risk.score}/100)`,
  }
}

// ─── Network Whitelist Checker (for sandbox env injection) ─

export function buildNetworkPolicy(risk: RiskAssessment): {
  allowNetwork: boolean
  allowedDomains: string[]
  blockAll: boolean
} {
  if (!risk.needsNetwork) {
    return { allowNetwork: false, allowedDomains: [], blockAll: true }
  }
  if (risk.allowedDomains.length === 0) {
    return { allowNetwork: false, allowedDomains: [], blockAll: true }
  }
  return { allowNetwork: true, allowedDomains: risk.allowedDomains, blockAll: false }
}
