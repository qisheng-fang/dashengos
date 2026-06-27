// DaShengOS v6.0 · Auto Backup System
// 启动时 + 每6小时自动快照: DB + .env + 系统提示词 + MCP配置
// 保留最近30个快照，超过自动清理

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sqlite } from '../storage/db.js'

const BACKUP_DIR = resolve(process.cwd(), '../../backups')
const MAX_BACKUPS = 30
const BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000  // 6 hours

// ─── Core backup logic ────────────────────────────────────

export function createBackup(): { ok: boolean; path: string; size: number; error?: string } {
  const ts = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)
  const backupName = `dasheng-${ts}`
  const backupPath = join(BACKUP_DIR, backupName)

  try {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })

    // 1. DB dump via SQLite .backup command
    const dbPath = sqlite.name  // better-sqlite3 exposes the filename
    if (existsSync(dbPath)) {
      copyFileSync(dbPath, `${backupPath}.db`)
    }

    // 2. .env snapshot
    const envPath = resolve(process.cwd(), '.env')
    if (existsSync(envPath)) {
      copyFileSync(envPath, `${backupPath}.env`)
    }

    // 3. System prompt snapshot (from harness dir)
    const harnessDir = resolve(process.cwd(), 'src/core/harness')
    if (existsSync(harnessDir)) {
      const promptPath = join(harnessDir, 'system-prompt-canon.ts')
      if (existsSync(promptPath)) {
        copyFileSync(promptPath, `${backupPath}.prompt.ts`)
      }
    }

    // 4. MCP config manifest (export from DB)
    const mcpServers = sqlite.prepare(
      'SELECT id, name, command, args_json, status FROM mcp_servers'
    ).all()
    writeFileSync(`${backupPath}.mcp.json`, JSON.stringify(mcpServers, null, 2))

    // 4b. Provider config export (from DB + env)
    const providerConfig = {
      LLM_PROVIDER: process.env.LLM_PROVIDER,
      DEFAULT_MODEL: process.env.DEFAULT_MODEL,
      DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
      SILICONFLOW_DEFAULT_MODEL: process.env.SILICONFLOW_DEFAULT_MODEL,
      env_persist: existsSync(join(resolve(process.cwd(), '..', '..'), '.env.persist')),
    }
    writeFileSync(`${backupPath}.providers.json`, JSON.stringify(providerConfig, null, 2))

    // 5. Manifest
    const manifest = {
      timestamp: new Date().toISOString(),
      version: 'dasheng-os-v6.0',
      files: ['db', 'env', 'prompt.ts', 'mcp.json', 'providers.json'],
      db_size: statSync(`${backupPath}.db`).size,
    }
    writeFileSync(`${backupPath}.manifest.json`, JSON.stringify(manifest, null, 2))

    // 6. Cleanup old backups
    cleanupOldBackups()

    const size = statSync(`${backupPath}.db`).size
    console.log(`[Backup] ✓ Created ${backupName} (${(size / 1024 / 1024).toFixed(1)}MB)`)
    return { ok: true, path: backupPath, size }
  } catch (e: any) {
    console.error(`[Backup] ✗ Failed:`, e.message)
    return { ok: false, path: backupPath, size: 0, error: e.message }
  }
}

function cleanupOldBackups() {
  try {
    const files = readdirSync(BACKUP_DIR)
    const manifests = files
      .filter(f => f.endsWith('.manifest.json'))
      .map(f => ({
        name: f.replace('.manifest.json', ''),
        path: join(BACKUP_DIR, f),
        mtime: statSync(join(BACKUP_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)  // newest first

    // Keep MAX_BACKUPS, delete the rest
    for (const m of manifests.slice(MAX_BACKUPS)) {
      const base = join(BACKUP_DIR, m.name)
      ;['.db', '.env', '.prompt.ts', '.mcp.json', '.manifest.json'].forEach(ext => {
        const f = base + ext
        if (existsSync(f)) unlinkSync(f)
      })
      console.log(`[Backup] Cleaned old backup: ${m.name}`)
    }
  } catch (e: any) {
    console.error('[Backup] Cleanup error:', e.message)
  }
}

// ─── Scheduled backup ─────────────────────────────────────

let backupTimer: ReturnType<typeof setInterval> | null = null

export function startAutoBackup(): void {
  // Initial backup on startup (after a short delay)
  setTimeout(() => {
    createBackup()
  }, 10000)

  // Periodic backups
  backupTimer = setInterval(() => {
    createBackup()
  }, BACKUP_INTERVAL_MS)

  console.log(`[Backup] Auto-backup started (interval: ${BACKUP_INTERVAL_MS / 3600000}h, max: ${MAX_BACKUPS})`)
}

export function stopAutoBackup(): void {
  if (backupTimer) {
    clearInterval(backupTimer)
    backupTimer = null
  }
}

// ─── Manual backup trigger (API endpoint) ─────────────────

export function manualBackup(): ReturnType<typeof createBackup> {
  return createBackup()
}

// ─── Restore from backup ──────────────────────────────────

export function listBackups(): Array<{ name: string; time: string; size: number }> {
  try {
    if (!existsSync(BACKUP_DIR)) return []
    const files = readdirSync(BACKUP_DIR)
    return files
      .filter(f => f.endsWith('.manifest.json'))
      .map(f => {
        const name = f.replace('.manifest.json', '')
        const manifestPath = join(BACKUP_DIR, f)
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
          return { name, time: manifest.timestamp, size: manifest.db_size || 0 }
        } catch {
          return { name, time: '', size: 0 }
        }
      })
      .sort((a, b) => b.time.localeCompare(a.time))
  } catch {
    return []
  }
}
