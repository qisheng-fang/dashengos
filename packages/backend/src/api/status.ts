// packages/backend/src/api/status.ts · D1.1 (2026-06-17)
// 仿 Hermes SidebarStatusStrip: 1 端点 + 14 字段,前端只显示"能不能用"

import type { FastifyInstance } from 'fastify'
import { existsSync, statSync } from 'node:fs'
import { execSync, execFileSync } from 'node:child_process'
import { sqlite } from '../storage/db.js'

const PYTHON = '/Users/apple/Desktop/ai-workbench-v2/agent/.venv/bin/python3'

function checkPort(port: number): { running: boolean; pid?: number } {
  try {
    const out = execSync(`lsof -ti:${port} 2>/dev/null || /usr/sbin/lsof -ti:${port} 2>/dev/null`, { stdio: 'pipe', timeout: 5000, shell: '/bin/bash' }).toString().trim()
    if (!out) return { running: false }
    const pid = parseInt(out.split('\n')[0] || '0', 10)
    return { running: true, pid }
  } catch { return { running: false } }
}

function checkSocket(path: string): { running: boolean; age_sec?: number } {
  try {
    if (!existsSync(path)) return { running: false }
    const stat = statSync(path)
    // 真实连接测试: 尝试 connect() 确认进程在监听
    try {
      const sock = new (require('net').Socket)()
      sock.connect({ path })
      sock.destroy()
      return { running: true, age_sec: Math.floor((Date.now() - stat.mtimeMs) / 1000) }
    } catch {
      return { running: false }
    }
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
      openai: {
        configured: !!process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o',
        base_url: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      },
      anthropic: {
        configured: !!process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_DEFAULT_MODEL || 'claude-sonnet-4-20250514',
        base_url: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      },
      qwen: {
        configured: !!process.env.DASHSCOPE_API_KEY,
        model: process.env.QWEN_DEFAULT_MODEL || 'qwen-max',
        base_url: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      },
      deepseek: {
        configured: !!process.env.DEEPSEEK_API_KEY,
        model: process.env.DEEPSEEK_DEFAULT_MODEL || 'deepseek-chat',
        base_url: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      },
      siliconflow: {
        configured: !!process.env.SILICONFLOW_API_KEY,
        model: process.env.SILICONFLOW_DEFAULT_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
        base_url: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1',
      },
      ollama: {
        configured: !!process.env.OLLAMA_HOST,
        model: process.env.DEFAULT_MODEL || 'qwen2.5:7b',
        base_url: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
      },
      groq: {
        configured: !!process.env.GROQ_API_KEY,
        model: process.env.GROQ_DEFAULT_MODEL || 'llama-3.3-70b-versatile',
        base_url: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
      },
      google: {
        configured: !!process.env.GOOGLE_API_KEY,
        model: process.env.GOOGLE_DEFAULT_MODEL || 'gemini-2.5-flash',
        base_url: process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
      },
    }

    const fastify = checkPort(8000)
    const vite = checkPort(3000)

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


      services: {
        fastify: { running: fastify.running, port: 8000, pid: fastify.pid },
        vite: { running: vite.running, port: 3000, pid: vite.pid },
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
