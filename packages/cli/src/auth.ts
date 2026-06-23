// packages/cli/src/auth.ts · DaShengOS CLI 认证
import fs from 'node:fs'
import path from 'node:path'
import { getConfig, DASHENG_DIR, TOKEN_FILE } from './config.js'
import chalk from 'chalk'

interface TokenData {
  access_token: string
  refresh_token: string
  expires_at: number // epoch ms
  user: { id: string; username: string; role: string }
}

let cachedToken: TokenData | null = null

export function getCachedToken(): TokenData | null {
  return cachedToken
}

function saveToken(data: TokenData) {
  if (!fs.existsSync(DASHENG_DIR)) {
    fs.mkdirSync(DASHENG_DIR, { recursive: true })
  }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 })
  cachedToken = data
}

function loadToken(): TokenData | null {
  if (cachedToken) {
    if (Date.now() < cachedToken.expires_at) return cachedToken
    cachedToken = null
  }
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null
    const raw = fs.readFileSync(TOKEN_FILE, 'utf-8')
    const data = JSON.parse(raw) as TokenData
    if (Date.now() < data.expires_at) {
      cachedToken = data
      return data
    }
  } catch {
    // corrupt token file
  }
  return null
}

async function doLogin(password: string): Promise<TokenData> {
  const cfg = getConfig()
  const resp = await fetch(`${cfg.backendUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: cfg.username, password }),
  })

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>
    throw new Error(body.message as string || `登录失败: HTTP ${resp.status}`)
  }

  const body = await resp.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
    user: { id: string; username: string; role: string }
  }

  const token: TokenData = {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_at: Date.now() + (body.expires_in - 60) * 1000, // 提前 60s 过期
    user: body.user,
  }
  saveToken(token)
  return token
}

async function refreshToken(token: TokenData): Promise<TokenData> {
  const cfg = getConfig()
  const resp = await fetch(`${cfg.backendUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: token.refresh_token }),
  })

  if (!resp.ok) {
    // refresh 失败，清除缓存重新登录
    cachedToken = null
    try { fs.unlinkSync(TOKEN_FILE) } catch { /* ok */ }
    throw new Error('token 已过期，请重新登录')
  }

  const body = await resp.json() as {
    access_token: string
    expires_in: number
  }

  token.access_token = body.access_token
  token.expires_at = Date.now() + (body.expires_in - 60) * 1000
  saveToken(token)
  return token
}

export async function ensureAuth(password?: string): Promise<TokenData> {
  // 1. 尝试加载缓存
  let token = loadToken()
  if (token) return token

  // 2. 需要登录
  if (password) {
    return doLogin(password)
  }

  // 3. 交互式密码输入
  const pw = await promptPassword()
  return doLogin(pw)
}

export async function getValidToken(): Promise<string> {
  let token = loadToken()
  if (!token) {
    throw new Error('未登录，请运行: dasheng login')
  }

  // 快过期则刷新
  if (Date.now() + 60_000 > token.expires_at) {
    try {
      token = await refreshToken(token)
    } catch {
      throw new Error('token 刷新失败，请重新登录: dasheng login')
    }
  }

  return token.access_token
}

async function promptPassword(): Promise<string> {
  // 从 stdin 读密码（隐藏回显）
  const { stdin, stdout } = process
  stdout.write(chalk.dim('请输入密码: '))

  // 用 tty 模式隐藏输入
  const prev = stdin.isRaw
  stdin.setRawMode?.(true)
  stdin.resume()

  return new Promise<string>((resolve) => {
    let buf = ''
    const onData = (chunk: Buffer) => {
      const c = chunk[0]
      if (c === 13 || c === 10) {
        // Enter
        stdin.removeListener('data', onData)
        if (typeof prev === 'boolean') stdin.setRawMode?.(prev)
        stdout.write('\n')
        resolve(buf)
      } else if (c === 127 || c === 8) {
        // Backspace
        if (buf.length > 0) {
          buf = buf.slice(0, -1)
          stdout.write('\b \b')
        }
      } else if (chunk.length === 1 && c === 3) {
        // Ctrl+C
        stdin.removeListener('data', onData)
        if (typeof prev === 'boolean') stdin.setRawMode?.(prev)
        stdout.write('\n')
        process.exit(0)
      } else if (c >= 32 && c <= 126) {
        buf += chunk.toString()
        stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })
}

export function logout() {
  cachedToken = null
  try { fs.unlinkSync(TOKEN_FILE) } catch { /* ok */ }
  console.log(chalk.green('✅ 已登出'))
}
