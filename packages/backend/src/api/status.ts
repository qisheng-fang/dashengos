// packages/backend/src/api/status.ts · D1.1 (2026-06-17)
// 仿 Hermes SidebarStatusStrip: 1 端点 + 14 字段,前端只显示"能不能用"

import type { FastifyInstance } from 'fastify'
import { existsSync, statSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { sqlite } from '../storage/db.js'

const PYTHON = '/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3'

function checkPort(port: number): { running: boolean; pid?: number } {
  try {
    const out = execSync(`lsof -ti:${port}`, { stdio: 'pipe', timeout: 3000 }).toString().trim()
    if (!out) return { running: false }
    const pid = parseInt(out.split('\n')[0] || '0', 10)
    return { running: true, pid }
  } catch { return { running: false } }
}

function checkSocket(path: string): { running: boolean; age_sec?: number } {
  try {
    if (!existsSync(path)) return { running: false }
    const stat = statSync(path)
    return { running: true, age_sec: Math.floor((Date.now() - stat.mtimeMs) / 1000) }
  } catch { return { running: false } }
}

function checkPythonDep(dep: string): { installed: boolean; version?: string; error?: string } {
  try {
    const v = execFileSync(PYTHON, ['-c', `import ${dep}; print(getattr(${dep}, '__version__', 'unknown'))`], { stdio: 'pipe', timeout: 5000 }).toString().trim()
    return { installed: true, version: v }
  } catch (e: any) {
    return { installed: false, error: e.message?.slice(0, 100) }
  }
}

function safeCount(sql: string): number {
  try { return (sqlite.prepare(sql).get() as { c: number }).c || 0 } catch { return 0 }
}

export async function statusRoutes(app: FastifyInstance) {
  // 核心状态端点 - 仿 Hermes GET /api/status
  app.get('/api/status', async () => {
    const providers = {
      siliconflow: {
        configured: !!process.env.SILICONFLOW_API_KEY,
        model: process.env.SILICONFLOW_DEFAULT_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
        base_url: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
      },
      deepseek: {
        configured: !!process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
        base_url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      },
      ollama: {
        configured: !!process.env.OLLAMA_HOST,
        model: process.env.DEFAULT_MODEL || 'qwen2.5:7b',
        base_url: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      },
    }

    const fastify = checkPort(8000)
    const vite = checkPort(3000)
    const gateway = checkSocket('/tmp/dasheng/deerflow.sock')

    return {
      version: '0.3.0',
      uptime_sec: Math.floor(process.uptime()),
      ts: Date.now(),

      backend: {
        running: fastify.running,
        port: 8000,
        host: '127.0.0.1',
        pid: fastify.pid,
      },

      gateway: {
        running: gateway.running,
        state: gateway.running ? 'running' : 'stopped',
        socket: '/tmp/dasheng/deerflow.sock',
        age_sec: gateway.age_sec,
      },

      services: {
        fastify: { running: fastify.running, port: 8000, pid: fastify.pid },
        vite: { running: vite.running, port: 3000, pid: vite.pid },
        deerflow: { running: gateway.running, socket: '/tmp/dasheng/deerflow.sock' },
      },

      providers,
      provider_summary: {
        configured: Object.values(providers).filter(p => p.configured).length,
        total: Object.keys(providers).length,
      },

      python_deps: {
        'python-docx': checkPythonDep('docx'),
        'python-pptx': checkPythonDep('pptx'),
        openpyxl: checkPythonDep('openpyxl'),
        weasyprint: checkPythonDep('weasyprint'),
        playwright: checkPythonDep('playwright'),
      },

      db: {
        path: './data/dasheng.db',
        sessions: safeCount('SELECT COUNT(*) as c FROM sessions'),
        messages: safeCount('SELECT COUNT(*) as c FROM messages'),
        skills: safeCount('SELECT COUNT(*) as c FROM skill_installs'),
        documents: safeCount('SELECT COUNT(*) as c FROM file_objects'),
        automations: safeCount('SELECT COUNT(*) as c FROM automations'),
      },

      storage: {
        docs_dir: '/tmp/dasheng-docs',
        docs_dir_writable: existsSync('/tmp/dasheng-docs'),
        socket_dir: '/tmp/dasheng',
        socket_dir_writable: existsSync('/tmp/dasheng'),
      },
    }
  })

  // 重启 DeerFlow daemon
  app.post('/api/system/restart-gateway', async () => {
    try {
      // 杀旧进程
      try { execSync('pkill -f "deerflow.daemon" || true', { stdio: 'ignore' }) } catch {}
      await new Promise(r => setTimeout(r, 1500))

      // 启动新进程
      const { spawn } = await import('node:child_process')
      const { openSync } = await import('node:fs')
      const logFd = openSync('/tmp/dasheng/deerflow.log', 'a')
      const child = spawn(PYTHON, ['-m', 'deerflow.daemon'], {
        cwd: '/Users/apple/Desktop/ai-workbench-v2',
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, DEERFLOW_TRACE_SYNC_ENABLED: 'false' },
      })
      child.unref()

      return { ok: true, message: 'DeerFlow daemon 重启中,3 秒后状态会更新' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  // 重启 Fastify 自己 (用 spawn 拉起新进程再退出)
  app.post('/api/system/restart-backend', async () => {
    try {
      const { spawn } = await import('node:child_process')
      // 延迟 500ms 让 reply.send 完成
      setTimeout(() => {
        const child = spawn(process.argv[0], process.argv.slice(1), {
          detached: true,
          stdio: 'inherit',
          env: process.env,
        })
        child.unref()
        process.exit(0)
      }, 500)
      return { ok: true, message: 'Backend 重启中,5 秒后会自动拉起' }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })
}
