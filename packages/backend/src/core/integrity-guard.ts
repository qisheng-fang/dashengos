// DaShengOS v6.1 — Integrity Guard
// 启动时验证关键文件完整性，防止 AI Agent 删改核心文件
// 当检测到文件缺失/篡改时自动从备份恢复

import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

// ROOT = project root. When running from dist/, cwd is the project root.
// __dirname would be dist/core/, so go up 3 levels from there to reach root.
const ROOT = (() => {
  // Use cwd for tsx runtime; __filename-based resolution unreliable
  const cwd = process.cwd()
  // If cwd is packages/backend/, go up 2 levels to project root
  if (cwd.endsWith('/packages/backend')) return resolve(cwd, '../..')
  // If cwd is already the project root, use it
  return cwd
})()

interface GuardEntry {
  path: string          // 相对于 ROOT
  description: string
  critical: boolean     // true = 缺失时拒绝启动
  hashCheck: boolean    // true = 验证 SHA-256
  backupGlob: string    // backups/ 中的匹配模式
}

const GUARD_REGISTRY: GuardEntry[] = [
  {
    path: '.env',
    description: '环境变量配置',
    critical: true,
    hashCheck: false,
    backupGlob: '.env',
  },
  {
    path: 'packages/backend/data/dasheng.db',
    description: '主数据库',
    critical: true,
    hashCheck: false,
    backupGlob: '.db',
  },
  {
    path: 'start.sh',
    description: '启动脚本',
    critical: true,
    hashCheck: false,
    backupGlob: '',
  },
  {
    path: 'restart.sh',
    description: '重启脚本',
    critical: true,
    hashCheck: false,
    backupGlob: '',
  },
  {
    path: 'packages/backend/src/api/skills.ts',
    description: '技能API',
    critical: false,
    hashCheck: false,
    backupGlob: '',
  },
  {
    path: 'packages/backend/src/api/health.ts',
    description: '健康检查API',
    critical: false,
    hashCheck: false,
    backupGlob: '',
  },
  {
    path: 'packages/backend/src/core/mcp-client.ts',
    description: 'MCP客户端',
    critical: false,
    hashCheck: false,
    backupGlob: '',
  },
  {
    path: 'packages/backend/src/core/marketplace.ts',
    description: '技能市场引擎',
    critical: false,
    hashCheck: false,
    backupGlob: '',
  },
]

interface GuardResult {
  ok: boolean
  checks: Array<{ path: string; ok: boolean; issue: string }>
  recovered: string[]
  blocked: string[]
}

export function runIntegrityCheck(): GuardResult {
  const checks: Array<{ path: string; ok: boolean; issue: string }> = []
  const recovered: string[] = []
  const blocked: string[] = []

  const hashFile = join(ROOT, '.codex-protect-hash')
  let storedHash = ''
  try {
    storedHash = readFileSync(hashFile, 'utf-8').trim()
  } catch { /* no hash file yet */ }

  for (const entry of GUARD_REGISTRY) {
    const fullPath = join(ROOT, entry.path)
    const exists = existsSync(fullPath)

    if (!exists) {
      const issue = `文件缺失: ${entry.path}`
      checks.push({ path: entry.path, ok: false, issue })

      if (entry.critical) {
        // 尝试从备份恢复
        const restored = restoreFromBackup(entry)
        if (restored) {
          recovered.push(entry.path)
          checks.push({ path: entry.path, ok: true, issue: `已从备份恢复` })
        } else {
          blocked.push(entry.path)
        }
      }
      continue
    }

    // Hash check — CRITICAL FILES: restore from backup on mismatch, do NOT auto-heal
    if (entry.hashCheck && storedHash) {
      const content = readFileSync(fullPath, 'utf-8')
      const currentHash = createHash('sha256').update(content).digest('hex')
      if (currentHash !== storedHash) {
        checks.push({
          path: entry.path,
          ok: false,
          issue: `哈希不匹配: 当前=${currentHash.slice(0, 12)}... 存储=${storedHash.slice(0, 12)}...`,
        })
        if (entry.critical) {
          // Critical file tampered — restore from backup, do NOT auto-update hash
          const restored = restoreFromBackup(entry)
          if (restored) {
            recovered.push(entry.path)
            checks.push({ path: entry.path, ok: true, issue: '已从备份恢复 (检测到篡改)' })
          } else {
            blocked.push(entry.path)
          }
        } else {
          // Non-critical: update hash (self-heal)
          writeFileSync(hashFile, currentHash)
          console.log(`[IntegrityGuard] Hash auto-updated for ${entry.path}`)
        }
      } else {
        checks.push({ path: entry.path, ok: true, issue: 'ok' })
      }
    } else {
      checks.push({ path: entry.path, ok: true, issue: 'ok' })
    }
  }

  const ok = blocked.length === 0
  return { ok, checks, recovered, blocked }
}

function restoreFromBackup(entry: GuardEntry): boolean {
  const backupDir = join(ROOT, 'backups')
  if (!existsSync(backupDir)) return false

  try {
    const files = readdirSync(backupDir)
      .filter((f: string) => f.endsWith(entry.backupGlob))
      .map((f: string) => ({ name: f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a: any, b: any) => b.mtime - a.mtime)

    if (files.length === 0) return false

    // Pick the latest DB backup that matches (prefer .db files)
    const dbFile = files.find((f: any) => f.name.endsWith('.db'))
    const latestFile = dbFile || files[0]
    const latest = join(backupDir, latestFile.name)
    const target = join(ROOT, entry.path)
    
    // Ensure target directory exists
    const targetDir = target.substring(0, target.lastIndexOf('/'))
    if (!existsSync(targetDir)) {
      // mkdirSync already imported at top
      mkdirSync(targetDir, { recursive: true })
    }
    
    copyFileSync(latest, target)
    console.log(`[IntegrityGuard] Restored ${entry.path} from ${latestFile.name}`)
    return true
  } catch (e: any) {
    console.error(`[IntegrityGuard] Restore failed for ${entry.path}:`, e.message)
    return false
  }
}

// 创建持久化快照 (.env.persist)
export function snapshotPersistEnv(): void {
  const envPath = join(ROOT, '.env')
  const persistPath = join(ROOT, '.env.persist')
  
  if (!existsSync(envPath)) {
    // Try to restore from backup
    const restored = restoreFromBackup({
      path: '.env',
      description: '环境变量',
      critical: true,
      hashCheck: false,
      backupGlob: '.env',
    })
    if (!restored) {
      console.error('[IntegrityGuard] Cannot snapshot .env — file missing and no backup')
      return
    }
  }

  if (!existsSync(envPath)) return

  try {
    const env = readFileSync(envPath, 'utf-8')
    writeFileSync(persistPath, `# DaShengOS Persistent Env Snapshot\n# Generated: ${new Date().toISOString()}\n# DO NOT DELETE — used for auto-recovery\n\n${env}`)
    console.log('[IntegrityGuard] .env.persist snapshot created')
  } catch (e: any) {
    console.error('[IntegrityGuard] Snapshot failed:', e.message)
  }
}
