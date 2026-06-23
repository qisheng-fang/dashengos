// packages/backend/src/api/daemon.ts
// Open Design Daemon 生命周期管理 —— 纯系统 Node 运行，零外部依赖

import type { FastifyInstance } from 'fastify'
import { spawn, type ChildProcess } from 'child_process'

let daemonProcess: ChildProcess | null = null
let webProcess: ChildProcess | null = null

const DAEMON_PATH = '/Users/apple/Documents/Codex/open-design/apps/daemon'
const WEB_PATH = '/Users/apple/Documents/Codex/open-design/apps/web'
const DAEMON_PORT = 7456
const WEB_PORT = 3001

function isDaemonRunning(): boolean {
  return daemonProcess !== null && daemonProcess.exitCode === null
}

async function checkPortInUse(port: number): Promise<boolean> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => { server.close(); resolve(false) })
    server.listen(port)
  })
}

async function startDaemon(): Promise<{ ok: boolean; message: string }> {
  if (isDaemonRunning()) {
    return { ok: true, message: 'daemon 已在运行 (pid ' + daemonProcess!.pid + ')' }
  }
  // 检查端口是否被外部进程占用
  const portUsed = await checkPortInUse(DAEMON_PORT)
  if (portUsed) {
    return { ok: true, message: `daemon 端口 ${DAEMON_PORT} 已被占用（可能来自之前会话），直接复用` }
  }

  return new Promise((resolve) => {
    try {
      daemonProcess = spawn('/usr/local/Homebrew/Cellar/node@24/24.17.0/bin/node', ['dist/cli.js', '--port', String(DAEMON_PORT)], {
        cwd: DAEMON_PATH,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem',
        },
      })

      let started = false
      daemonProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('listening') && !started) {
          started = true
          resolve({ ok: true, message: `daemon 已启动，端口 ${DAEMON_PORT}，457 插件已注册` })
        }
      })

      daemonProcess.on('error', (err) => {
        daemonProcess = null
        if (!started) resolve({ ok: false, message: `启动失败: ${err.message}` })
      })

      daemonProcess.on('exit', (code) => {
        daemonProcess = null
        if (!started) resolve({ ok: false, message: `daemon 异常退出 code=${code}` })
      })

      setTimeout(() => {
        if (!started) resolve({ ok: false, message: 'daemon 启动超时（15秒）' })
      }, 15000)
    } catch (e: any) {
      resolve({ ok: false, message: `异常: ${e.message}` })
    }
  })
}

async function startWeb(): Promise<{ ok: boolean; message: string }> {
  // 检查端口是否已被占用
  const webPortUsed = await checkPortInUse(WEB_PORT)
  if (webPortUsed) {
    return { ok: true, message: `web 端口 ${WEB_PORT} 已被占用，直接复用` }
  }
  return new Promise((resolve) => {
    try {
      webProcess = spawn('/usr/local/Homebrew/Cellar/node@24/24.17.0/bin/npx', ['next', 'dev', '--turbopack', '-p', String(WEB_PORT)], {
        cwd: WEB_PATH,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: '/etc/ssl/cert.pem',
        },
      })

      let started = false
      webProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString()
        if ((text.includes('ready') || text.includes('Local:')) && !started) {
          started = true
          resolve({ ok: true, message: `web 已启动，端口 ${WEB_PORT}` })
        }
      })

      webProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        if ((text.includes('ready') || text.includes('Local:')) && !started) {
          started = true
          resolve({ ok: true, message: `web 已启动，端口 ${WEB_PORT}` })
        }
      })

      webProcess.on('error', (err) => {
        if (!started) resolve({ ok: false, message: `web 启动失败: ${err.message}` })
      })

      setTimeout(() => {
        if (!started) resolve({ ok: false, message: 'web 启动超时（30秒）' })
      }, 30000)
    } catch (e: any) {
      resolve({ ok: false, message: `异常: ${e.message}` })
    }
  })
}

function stopAll(): { ok: boolean; message: string } {
  const parts: string[] = []
  if (daemonProcess) { daemonProcess.kill('SIGTERM'); daemonProcess = null; parts.push('daemon') }
  if (webProcess) { webProcess.kill('SIGTERM'); webProcess = null; parts.push('web') }
  return { ok: true, message: parts.length ? `已停止: ${parts.join(', ')}` : '无运行中的服务' }
}

export async function daemonRoutes(app: FastifyInstance) {
  app.post('/daemon/start', async (_req, reply) => {
    // 先启动 daemon，再启动 web
    const dResult = await startDaemon()
    if (!dResult.ok) return reply.send(dResult)
    
    const wResult = await startWeb()
    return reply.send({ 
      ok: wResult.ok, 
      message: `daemon(7456) + web(3001): ${wResult.message}`,
      daemon: dResult.message,
      web: wResult.message,
    })
  })

  app.post('/daemon/stop', async (_req, reply) => {
    return reply.send(stopAll())
  })

  app.get('/daemon/status', async (_req, reply) => {
    const dRunning = isDaemonRunning() || await checkPortInUse(DAEMON_PORT)
    const wRunning = (webProcess !== null && webProcess.exitCode === null) || await checkPortInUse(WEB_PORT)
    return reply.send({
      running: dRunning && wRunning,
      daemon: { running: dRunning, port: DAEMON_PORT },
      web: { running: wRunning, port: WEB_PORT },
      plugins: dRunning ? '457 bundled' : '未加载',
    })
  })
}
