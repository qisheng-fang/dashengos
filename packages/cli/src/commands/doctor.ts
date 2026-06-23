// packages/cli/src/commands/doctor.ts · 详细诊断 (Hermes 对齐)
import chalk from 'chalk'
import { apiPublicGet, apiGet } from '../api.js'

async function check(label: string, fn: () => Promise<boolean>): Promise<{ label: string; ok: boolean; detail: string }> {
  try {
    const ok = await fn()
    return { label, ok, detail: ok ? 'OK' : 'FAILED' }
  } catch (e: any) {
    return { label, ok: false, detail: e.message?.slice(0, 60) || 'error' }
  }
}

export async function doctorCommand() {
  console.log(chalk.cyan.bold('\n🏥 DaShengOS 系统诊断\n'))

  const checks = await Promise.all([
    check('后端 :8000', async () => {
      const r = await apiPublicGet('/api/v1/health/ping')
      return r.status === 'ok'
    }),
    check('前端 :3000', async () => {
      const r = await fetch('http://127.0.0.1:3000')
      return r.ok
    }),
    check('Redis :6379', async () => {
      const status = (await apiPublicGet('/api/status')) as any
      return !!status?.services?.deerflow?.running
    }),
    check('DeepSeek API', async () => {
      const provs = (await apiPublicGet('/api/providers')) as any
      const ds = provs?.providers?.find((p: any) => p.name === 'deepseek')
      return !!ds?.configured
    }),
    check('Ollama :11434', async () => {
      try {
        const r = await fetch('http://127.0.0.1:11434/api/tags')
        return r.ok
      } catch { return false }
    }),
    check('MCP 服务器', async () => {
      const mcp = (await apiGet('/api/v1/mcp/health')) as any
      const alive = mcp?.servers?.filter((s: any) => s.alive).length || 0
      return alive > 0
    }),
    check('SQLite DB', async () => {
      const status = (await apiPublicGet('/api/status')) as any
      return (status?.db?.sessions || 0) >= 0
    }),
    check('Playwright', async () => {
      const status = (await apiPublicGet('/api/status')) as any
      return !!status?.python_deps?.playwright?.installed
    }),
    check('Skills 系统', async () => {
      const skills = (await apiGet('/api/v1/skills')) as any
      return (skills?.skills?.length || 0) >= 0
    }),
    check('记忆系统', async () => {
      const mem = (await apiGet('/api/v1/memory/heartbeat/status')) as any
      return !!mem?.ok || !!mem?.status
    }),
  ])

  let pass = 0
  for (const c of checks) {
    const icon = c.ok ? chalk.green('✅') : chalk.red('❌')
    console.log(`  ${icon} ${chalk.bold(c.label)} ${chalk.dim(c.detail)}`)
    if (c.ok) pass++
  }

  console.log('')
  const score = Math.round((pass / checks.length) * 100)
  const scoreColor = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red
  console.log(scoreColor(`  健康评分: ${score}/100 (${pass}/${checks.length} 项通过)`))
  console.log('')
}
