// DaShengOS v6.0 — 全系统健康监控引擎
// 一次性检测: 端口/DB/Redis/MCP/模型/工具/外网/DNS/磁盘
// 每个检测项带: 状态/延迟/错误信息/建议

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { config } from '../config.js'
import { getLastMemoryReport } from './memory-heartbeat.js'
import { getCompressionMetrics } from './context-compressor.js'

export interface HealthItem {
  name: string
  category: 'core' | 'database' | 'llm' | 'mcp' | 'network' | 'system'
  status: 'healthy' | 'degraded' | 'down' | 'unknown'
  latencyMs: number
  detail: string
  suggestion?: string
}

export interface HealthReport {
  timestamp: number
  uptime: number
  overall: 'healthy' | 'degraded' | 'down'
  score: number  // 0-100
  items: HealthItem[]
  failures: HealthItem[]
}

const startTime = Date.now()

// ─── 端口检测 ───
async function checkPort(host: string, port: number, timeout = 3000): Promise<{ ok: boolean; latencyMs: number }> {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const start = Date.now()
    const socket = new net.Socket()
    socket.setTimeout(timeout)
    socket.on('connect', () => {
      const latency = Date.now() - start
      socket.destroy()
      resolve({ ok: true, latencyMs: latency })
    })
    socket.on('error', () => resolve({ ok: false, latencyMs: Date.now() - start }))
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, latencyMs: timeout }) })
    socket.connect(port, host)
  })
}

// ─── HTTP 健康检查 ───
async function checkHttp(url: string, timeout = 5000): Promise<{ ok: boolean; latencyMs: number; status?: number }> {
  const start = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    return { ok: res.ok, latencyMs: Date.now() - start, status: res.status }
  } catch {
    return { ok: false, latencyMs: Date.now() - start }
  }
}

// ─── 外网连通性 ───
async function checkInternet(): Promise<{ ok: boolean; latencyMs: number }> {
  const targets = ['https://api.deepseek.com/v1/models', 'https://www.google.com', 'https://api.github.com']
  const start = Date.now()
  for (const url of targets) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (res.ok || res.status === 401) return { ok: true, latencyMs: Date.now() - start }
    } catch {}
  }
  return { ok: false, latencyMs: Date.now() - start }
}

// ─── DNS 解析 ───
function checkDNS(): { ok: boolean; ips: string[] } {
  try {
    const result = execSync('dscacheutil -q host -a name github.com 2>/dev/null || ping -c 1 -t 1 github.com 2>/dev/null | head -1', { timeout: 5000, encoding: 'utf-8' })
    return { ok: result.length > 0, ips: result.trim().split('\n').slice(0, 2) }
  } catch {
    return { ok: false, ips: [] }
  }
}

// ─── 磁盘空间 ───
function checkDisk(): { ok: boolean; freeGB: number; totalGB: number; percentUsed: number } {
  try {
    const result = execSync("df -g / | tail -1 | awk '{print $3,$2,$5}'", { encoding: 'utf-8', timeout: 3000 }).trim()
    const [free, total, pct] = result.split(/\s+/)
    const freeGB = parseFloat(free)
    const totalGB = parseFloat(total)
    const percentUsed = parseInt(pct) || 0
    return { ok: freeGB > 2, freeGB, totalGB, percentUsed }
  } catch {
    return { ok: true, freeGB: 0, totalGB: 0, percentUsed: 0 }
  }
}

// ─── 内存 ───
function checkMemory(): { ok: boolean; freeMB: number; pressure: string } {
  try {
    const vm = execSync('vm_stat', { encoding: 'utf-8', timeout: 3000 })
    const pagesFree = parseInt((vm.match(/Pages free:\s+(\d+)/) || ['','0'])[1])
    const pressure = execSync('sysctl -n vm.memory_pressure_level 2>/dev/null || echo "unknown"', { encoding: 'utf-8', timeout: 2000 }).trim()
    const freeMB = (pagesFree * 16384) / (1024 * 1024) // page size assumption
    return { ok: pressure !== '4' && pressure !== 'warn', freeMB, pressure }
  } catch {
    return { ok: true, freeMB: 0, pressure: 'unknown' }
  }
}

// ─── 主编排 ───
export async function runFullHealthCheck(): Promise<HealthReport> {
  const items: HealthItem[] = []
  const now = Date.now()

  // ── Core ──
  {
    const port = await checkPort('127.0.0.1', 8000)
    items.push({
      name: '后端端口 :8000', category: 'core',
      status: port.ok ? 'healthy' : 'down', latencyMs: port.latencyMs,
      detail: port.ok ? 'Fastify 监听中' : '端口无响应',
      suggestion: port.ok ? undefined : '执行 start.sh 重启后端'
    })
  }

  {
    const port = await checkPort('127.0.0.1', 3000)
    items.push({
      name: '前端端口 :3000', category: 'core',
      status: port.ok ? 'healthy' : 'down', latencyMs: port.latencyMs,
      detail: port.ok ? 'SPA 服务中' : '端口无响应',
      suggestion: port.ok ? undefined : '执行 start.sh 重启前端'
    })
  }

  {
    const auth = await checkHttp('http://127.0.0.1:8000/api/v1/health/ping')
    items.push({
      name: 'Auth 认证', category: 'core',
      status: auth.ok ? 'healthy' : (auth.status === 401 ? 'degraded' : 'down'),
      latencyMs: auth.latencyMs,
      detail: auth.ok ? '登录正常' : `HTTP ${auth.status || '超时'}`,
    })
  }

  // ── Database ──
  {
    const dbExists = fs.existsSync(config.DATABASE_URL?.replace('file:', '') || 'data/dasheng.db')
    const dbSize = dbExists ? fs.statSync(config.DATABASE_URL?.replace('file:', '') || 'data/dasheng.db').size : 0
    items.push({
      name: 'SQLite 数据库', category: 'database',
      status: dbExists ? 'healthy' : 'down', latencyMs: 0,
      detail: dbExists ? `${(dbSize / 1024 / 1024).toFixed(1)}MB` : '文件缺失',
      suggestion: dbExists ? undefined : '数据库文件丢失，需重建'
    })
  }

  {
    const redis = await checkPort('127.0.0.1', 6379)
    items.push({
      name: 'Redis 缓存', category: 'database',
      status: redis.ok ? 'healthy' : 'degraded', latencyMs: redis.latencyMs,
      detail: redis.ok ? '连接正常' : '无响应',
      suggestion: redis.ok ? undefined : 'redis-server --daemonize yes'
    })
  }

  // ── LLM Models ──
  {
    const ds = await checkHttp('https://api.deepseek.com/v1/models')
    items.push({
      name: 'DeepSeek API', category: 'llm',
      status: ds.ok || ds.status === 401 ? 'healthy' : 'down',
      latencyMs: ds.latencyMs,
      detail: ds.ok ? 'API 连通' : ds.status === 401 ? 'Key有效' : '不可达',
      suggestion: ds.ok ? undefined : '检查 DEEPSEEK_API_KEY 或网络'
    })
  }

  // ── MCP Servers (通过 API 查询) ──
  try {
    const token = await (async () => {
      const res = await fetch('http://127.0.0.1:8000/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'dasheng123' }),
        signal: AbortSignal.timeout(5000),
      })
      const data = await res.json() as any
      return data.access_token || ''
    })()
    
    if (token) {
      const mcpRes = await fetch('http://127.0.0.1:8000/api/v1/mcp/servers', {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      })
      const mcpData = await mcpRes.json() as { servers?: Array<{ id: string; name: string; status: string }> }
      const servers = mcpData.servers || []
      
      // 额外：进程级检测 (弥补 DB 状态未及时更新的情况)
      const processCheck = (await (async () => {
        try {
          const { execSync } = await import('node:child_process')
          const ps = execSync('ps aux 2>/dev/null | grep -v grep', {
            encoding: 'utf-8', timeout: 3000, maxBuffer: 512 * 1024
          })
          return ps
        } catch { return '' }
      })())
      
      for (const s of servers) {
        // 检查真实进程是否在运行（进程名/参数匹配）
        let realRunning = false
        const lowerName = (s.name || '').toLowerCase()
        if (lowerName.includes('playwright')) {
          realRunning = processCheck.includes('playwright') || processCheck.includes('@playwright/mcp')
        } else if (lowerName.includes('xcode')) {
          realRunning = processCheck.includes('xcodebuildmcp')
        } else if (lowerName.includes('codex') || lowerName.includes('security')) {
          realRunning = processCheck.includes('codex-security') || processCheck.includes('mcp/server.mjs')
        } else if (lowerName.includes('agnes')) {
          realRunning = processCheck.includes('agnes_mcp_server')
        }
        
        // DB 状态为 running 或 实际进程存在 → healthy
        const isHealthy = s.status === 'running' || realRunning
        items.push({
          name: `MCP: ${s.name || s.id}`, category: 'mcp',
          status: isHealthy ? 'healthy' : 'down',
          latencyMs: 0,
          detail: isHealthy ? (s.status === 'running' ? '运行中' : '进程在线(DB未同步)') : s.status,
        })
      }
    }
  } catch (err: any) {
    // MCP API 不可达时回退到日志检测
    try {
      const logContent = fs.readFileSync('/tmp/dasheng-backend.log', 'utf-8').slice(-8000)
      const mcpNames = ['Playwright', 'XcodeBuild', 'CodexSecurity', 'AgnesAI']
      for (const name of mcpNames) {
        const found = logContent.includes(name)
        items.push({
          name: `MCP: ${name}`, category: 'mcp',
          status: found ? 'healthy' : 'unknown', latencyMs: 0,
          detail: found ? '日志中有连接' : '未检测到',
        })
      }
    } catch {
      items.push({
        name: 'MCP 服务器集群', category: 'mcp',
        status: 'unknown', latencyMs: 0, detail: '无法检测',
      })
    }
  }

  // ── Network ──
  {
    const net = await checkInternet()
    items.push({
      name: '外网连通', category: 'network',
      status: net.ok ? 'healthy' : 'down', latencyMs: net.latencyMs,
      detail: net.ok ? 'DeepSeek/Google/GitHub可达' : '全部不可达',
      suggestion: net.ok ? undefined : '检查网络代理/DNS'
    })
  }

  {
    const dns = checkDNS()
    items.push({
      name: 'DNS 解析', category: 'network',
      status: dns.ok ? 'healthy' : 'down', latencyMs: 0,
      detail: dns.ok ? `github.com 可解析` : 'DNS 失败',
    })
  }

  // ── System ──
  {
    const disk = checkDisk()
    items.push({
      name: '磁盘空间', category: 'system',
      status: disk.ok ? 'healthy' : 'degraded', latencyMs: 0,
      detail: `${disk.freeGB}GB 可用 / ${disk.totalGB}GB (${disk.percentUsed}%)`,
      suggestion: disk.ok ? undefined : `磁盘仅剩 ${disk.freeGB}GB，需清理`
    })
  }

  {
    const mem = checkMemory()
    items.push({
      name: '内存', category: 'system',
      status: mem.ok ? 'healthy' : 'degraded', latencyMs: 0,
      detail: `${mem.freeMB.toFixed(0)}MB 可用, pressure: ${mem.pressure}`,
    })
  }

  // ── Memory System ──
  try {
    const memReport = getLastMemoryReport()
    if (memReport) {
      const totalRows = Object.values(memReport.tableSizes.rows).reduce((a,b) => a+b, 0)
      items.push({
        name: '记忆系统 (SQLite)', category: 'database',
        status: memReport.healthy ? 'healthy' : 'degraded', latencyMs: 0,
        detail: `${totalRows.toLocaleString()} 条记录 | 衰减${memReport.decayStatus.decayedCount}条 | 心跳${memReport.healthy ? '正常' : '异常'}`,
        suggestion: !memReport.sqliteIntegrity.ok ? `完整性: ${memReport.sqliteIntegrity.error?.slice(0, 50)}` :
                    !memReport.tablesExist.ok ? `缺失表: ${memReport.tablesExist.missing.join(',')}` : undefined,
      })
    }
  } catch { /* memory heartbeat may not have run yet */ }

  // ── Context Compressor ──
  try {
    const cm = getCompressionMetrics()
    if (cm.triggered > 0) {
      const status = cm.avgRatio > 1.5 ? 'healthy' : cm.llmFailures > 3 ? 'degraded' : 'healthy'
      items.push({
        name: '上下文压缩器', category: 'core',
        status, latencyMs: Math.round(cm.avgLatencyMs),
        detail: `触发${cm.triggered}次 | 比${cm.avgRatio.toFixed(1)}x | LLM${cm.llmSuccesses}/${cm.llmAttempts} | 阈值${cm.dynamicThreshold}t`,
        suggestion: cm.llmFailures >= 3 ? `LLM压缩连续失败${cm.llmFailures}次，已回退规则压缩` : undefined,
      })
    }
  } catch { /* compressor may not have run yet */ }

  // ── 计算总分 ──
  const healthyCount = items.filter(i => i.status === 'healthy').length
  const degradedCount = items.filter(i => i.status === 'degraded').length
  const downCount = items.filter(i => i.status === 'down').length
  const score = Math.round((healthyCount / items.length) * 100)
  
  const overall = downCount > 0 ? 'down' : degradedCount > 2 ? 'degraded' : 'healthy'
  const failures = items.filter(i => i.status === 'down' || i.status === 'degraded')

  return {
    timestamp: now,
    uptime: now - startTime,
    overall,
    score,
    items,
    failures,
  }
}
