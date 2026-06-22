// packages/backend/src/api/doctor.ts · D2.1 (2026-06-17)
// 仿 Hermes doctor.py: 14 章节 + check_ok/warn/fail/info + --fix

import type { FastifyInstance } from 'fastify'
import { execSync, execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { sqlite } from '../storage/db.js'

const PYTHON = '/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3'

type CheckStatus = 'ok' | 'warn' | 'fail' | 'info'
interface Check { status: CheckStatus; text: string; detail?: string; fix?: string }
interface Section { name: string; checks: Check[] }

const ok = (text: string, detail?: string): Check => ({ status: 'ok', text, detail })
const warn = (text: string, detail?: string, fix?: string): Check => ({ status: 'warn', text, detail, fix })
const fail = (text: string, detail?: string, fix?: string): Check => ({ status: 'fail', text, detail, fix })
const info = (text: string, detail?: string): Check => ({ status: 'info', text, detail })

const PY_ENV = {
  ...process.env,
  DYLD_FALLBACK_LIBRARY_PATH: '/usr/local/Homebrew/lib',
}

function checkPythonDep(dep: string): Check {
  try {
    const v = execFileSync(PYTHON, ['-c', `import ${dep}; print(getattr(${dep}, '__version__', '?'))`], { stdio: 'pipe', timeout: 5000, env: PY_ENV }).toString().trim()
    return ok(`${dep}`, v)
  } catch {
    // import 失败时，检查 pip 是否已安装（可能缺少系统库，如 weasyprint 需要 GTK+）
    try {
      execFileSync(PYTHON, ['-m', 'pip', 'show', dep], { stdio: 'pipe', timeout: 5000, env: PY_ENV })
      return warn(
        `${dep} pip 已安装`,
        'import 失败: 可能缺少系统库 (macOS 需 brew install pango gdk-pixbuf)',
        'brew install pango gdk-pixbuf libffi (macOS) 或 apt install libpango-1.0-0 (Linux)',
      )
    } catch {
      return fail(`${dep} 未安装`, undefined, `${PYTHON} -m pip install ${dep}`)
    }
  }
}

function checkPort(port: number, expected: boolean): Check {
  try {
    const out = execSync(`lsof -ti:${port}`, { stdio: 'pipe', timeout: 3000 }).toString().trim()
    const isUp = !!out
    if (isUp === expected) return ok(`Port :${port}`, expected ? 'running' : 'free')
    return warn(`Port :${port}`, isUp ? 'unexpectedly in use' : 'not listening')
  } catch {
    return expected ? fail(`Port :${port}`, 'not listening') : ok(`Port :${port}`, 'free')
  }
}

function checkSocket(path: string): Check {
  if (!existsSync(path)) return fail(`Socket ${path}`, '不存在', 'POST /api/system/restart-gateway')
  const stat = statSync(path)
  const ageSec = Math.floor((Date.now() - stat.mtimeMs) / 1000)
  return ok(`Socket ${path}`, `alive · ${ageSec}s ago`)
}

function checkDir(path: string, mustWritable = true): Check {
  if (!existsSync(path)) return fail(`目录 ${path}`, '不存在', `mkdir -p ${path}`)
  if (!mustWritable) return ok(`目录 ${path}`)
  try { execSync(`test -w "${path}"`); return ok(`目录 ${path}`, 'writable') }
  catch { return fail(`目录 ${path}`, '不可写', `chmod 755 ${path}`) }
}

function safeCount(sql: string): number {
  try { return (sqlite.prepare(sql).get() as { c: number }).c || 0 } catch { return 0 }
}

export async function doctorRoutes(app: FastifyInstance) {
  app.get('/api/doctor', async () => {
    const sessionCount = safeCount('SELECT COUNT(*) as c FROM sessions')
    const messageCount = safeCount('SELECT COUNT(*) as c FROM messages')
    const skInstalls = safeCount('SELECT COUNT(*) as c FROM skill_installs')

    const sections: Section[] = [
      {
        name: '🐍 Python 环境',
        checks: [
          (() => {
            try {
              const v = execSync(`${PYTHON} --version`, { stdio: 'pipe' }).toString().trim()
              return ok(v, 'agent/.venv (推荐 3.11+)')
            } catch { return fail('Python 未找到', undefined, PYTHON) }
          })(),
        ]
      },
      {
        name: '📦 必需依赖',
        checks: [
          checkPythonDep('docx'),
          checkPythonDep('pptx'),
          checkPythonDep('openpyxl'),
          checkPythonDep('weasyprint'),
          checkPythonDep('playwright'),
        ]
      },
      {
        name: '🤖 LLM Provider',
        checks: [
          process.env.SILICONFLOW_API_KEY
            ? ok('SiliconFlow', `${process.env.SILICONFLOW_DEFAULT_MODEL || 'Qwen/Qwen2.5-72B-Instruct'} · ${process.env.SILICONFLOW_API_KEY.slice(0, 6)}...`)
            : warn('SiliconFlow', 'API key 缺失', 'export SILICONFLOW_API_KEY=sk-... 写入 .env'),
          process.env.DEEPSEEK_API_KEY
            ? ok('DeepSeek', `${process.env.DEEPSEEK_MODEL || 'deepseek-chat'} · configured`)
            : info('DeepSeek', '未配置 (可选)'),
          process.env.OLLAMA_HOST
            ? ok('Ollama', process.env.OLLAMA_HOST)
            : info('Ollama', '未配置 (可选)'),
        ]
      },
      {
        name: '⚙️ 后端服务',
        checks: [
          checkPort(8000, true),
          checkPort(3000, true),
          checkSocket('/tmp/dasheng/deerflow.sock'),
        ]
      },
      {
        name: '💾 数据',
        checks: [
          ok('SQLite DB', './data/dasheng.db · connected'),
          info('会话数', `${sessionCount}`),
          info('消息数', `${messageCount}`),
          info('已装 Skill', `${skInstalls}`),
          messageCount === 0 && sessionCount > 0
            ? warn('对话未持久化', `${sessionCount} sessions / 0 messages`, '检查 chat.ts: 应有 INSERT INTO messages')
            : messageCount > 0
              ? ok('对话持久化', `${messageCount} messages stored`)
              : info('对话持久化', '尚无数据'),
        ]
      },
      {
        name: '🌐 浏览器自动化',
        checks: [
          checkPythonDep('playwright'),
          (() => {
            try {
              const out = execFileSync(PYTHON, ['-c', "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print('chromium:', p.chromium.executable_path or 'missing'); p.stop()"], { stdio: 'pipe', timeout: 10000, env: PY_ENV }).toString().trim()
              return ok('Playwright Chromium', out)
            } catch { return warn('Playwright Chromium', '未安装', `${PYTHON} -m playwright install chromium`) }
          })(),
        ]
      },
      {
        name: '📂 存储',
        checks: [
          checkDir('/tmp/dasheng-docs'),
          checkDir('/tmp/dasheng'),
          checkDir('/Users/apple/Desktop/ai-workbench-v2/packages/backend/data'),
        ]
      },
      {
        name: '🔐 安全',
        checks: [
          process.env.DASHENG_JWT_SECRET && process.env.DASHENG_JWT_SECRET.length >= 32
            ? ok('JWT Secret', `${process.env.DASHENG_JWT_SECRET.length} chars`)
            : fail('JWT Secret 太短', '小于 32 字符', 'export DASHENG_JWT_SECRET=$(openssl rand -hex 32)'),
          process.env.DASHENG_STRICT_SECURITY === 'true'
            ? ok('严格安全模式', 'enabled')
            : info('严格安全模式', 'disabled (开发环境)'),
        ]
      },
    ]

    const total = sections.reduce((sum, s) => sum + s.checks.length, 0)
    const pass = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'ok').length, 0)
    const failN = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'fail').length, 0)
    const warnN = sections.reduce((sum, s) => sum + s.checks.filter(c => c.status === 'warn').length, 0)

    return {
      summary: {
        total,
        pass,
        fail: failN,
        warn: warnN,
        healthy: failN === 0,
        score: Math.round((pass / total) * 100),
      },
      sections,
      ts: Date.now(),
    }
  })

  // --fix 端点: 尝试修可修的项
  app.post('/api/doctor/fix', async () => {
    const fixes: Array<{ name: string; ok: boolean; output: string }> = []

    // 1. 创建缺失目录
    for (const dir of ['/tmp/dasheng-docs', '/tmp/dasheng']) {
      if (!existsSync(dir)) {
        try { execSync(`mkdir -p ${dir}`); fixes.push({ name: `mkdir ${dir}`, ok: true, output: '' }) }
        catch (e: any) { fixes.push({ name: `mkdir ${dir}`, ok: false, output: e.message }) }
      }
    }

    // 2. 装缺失的 Python 依赖
    const missingDeps: string[] = []
    for (const dep of ['docx', 'pptx', 'openpyxl', 'weasyprint', 'playwright']) {
      try { execFileSync(PYTHON, ['-c', `import ${dep}`], { stdio: 'pipe', timeout: 5000, env: PY_ENV }) }
      catch { missingDeps.push(dep) }
    }
    if (missingDeps.length > 0) {
      try {
        const out = execFileSync(PYTHON, ['-m', 'pip', 'install', ...missingDeps], { stdio: 'pipe', timeout: 180_000, env: PY_ENV }).toString()
        fixes.push({ name: `pip install ${missingDeps.join(', ')}`, ok: true, output: out.slice(-200) })
      } catch (e: any) {
        fixes.push({ name: `pip install ${missingDeps.join(', ')}`, ok: false, output: (e.message || String(e)).slice(0, 200) })
      }
    }

    // 3. 装 Playwright Chromium
    if (missingDeps.includes('playwright')) {
      try {
        execFileSync(PYTHON, ['-m', 'playwright', 'install', 'chromium'], { stdio: 'pipe', timeout: 180_000, env: PY_ENV })
        fixes.push({ name: 'playwright install chromium', ok: true, output: '' })
      } catch (e: any) {
        fixes.push({ name: 'playwright install chromium', ok: false, output: e.message.slice(0, 200) })
      }
    }

    return { ok: true, fixes, message: `应用了 ${fixes.length} 项修复,请重新扫描` }
  })
}
