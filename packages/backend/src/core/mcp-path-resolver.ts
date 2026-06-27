// DaShengOS v6.0 · MCP Path Resolver
// 自动扫描插件缓存目录，解析带版本哈希的路径
// 解决: 插件升级后哈希变化导致 MCP 离线

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

interface PathPattern {
  baseDir: string       // 扫描根目录
  glob: string           // 匹配模式 (目录前缀)
  file: string           // 目标文件名
  minDepth?: number      // 最小扫描深度
}

interface ResolvedPath {
  original: string
  resolved: string
  found: boolean
}

// ─── Path Patterns (declarative) ─────────────────────────

const PATH_PATTERNS: Record<string, PathPattern> = {
  'mcp_codex_security': {
    baseDir: resolve(process.env.HOME || '/tmp', '.codex/plugins/cache/openai-api-curated/codex-security'),
    glob: '',
    file: 'mcp/server.mjs',
  },
  'codex-security': {
    baseDir: resolve(process.env.HOME || '/tmp', '.codex/plugins/cache/openai-api-curated/codex-security'),
    glob: '',
    file: 'mcp/server.mjs',
  },
  'mcp_agnes_ai': {
    baseDir: resolve(process.env.HOME || '/tmp', 'WorkBuddy'),
    glob: '20',
    file: 'agnes_mcp_server.py',
    minDepth: 3,
  },
  'workbuddy-python': {
    baseDir: resolve(process.env.HOME || '/tmp', '.workbuddy/binaries/python/versions'),
    glob: '',
    file: 'bin/python3',
    minDepth: 2,
  },
  'workbuddy-project': {
    baseDir: resolve(process.env.HOME || '/tmp', 'WorkBuddy'),
    glob: '20',
    file: 'agnes_mcp_server.py',
    minDepth: 3,
  },
}

// ─── Resolver ─────────────────────────────────────────────

function scanDir(base: string, file: string, minDepth: number = 1, prefix: string = ''): string | null {
  if (!existsSync(base)) return null

  try {
    const entries = readdirSync(base)
    // 优先匹配前缀 (找最新版本)
    const sorted = entries
      .filter(e => !prefix || e.startsWith(prefix))
      .map(e => ({ name: e, mtime: statSync(join(base, e)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)  // 最新在前

    for (const { name } of sorted) {
      const full = join(base, name)
      const target = join(full, file)
      if (existsSync(target)) return target

      // 递归扫描子目录
      if (minDepth > 1 && statSync(full).isDirectory()) {
        const found = scanDir(full, file, minDepth - 1, prefix)
        if (found) return found
      }
    }
  } catch { /* permission denied, etc */ }

  return null
}

export function resolveMCPPath(serverId: string, currentPath: string): ResolvedPath {
  const pattern = PATH_PATTERNS[serverId]
  if (!pattern) return { original: currentPath, resolved: currentPath, found: true }

  // 尝试按模式解析
  const resolved = scanDir(pattern.baseDir, pattern.file, pattern.minDepth ?? 1, pattern.glob)
  if (resolved) {
    return { original: currentPath, resolved, found: true }
  }

  // 回退：检查当前路径是否直接存在
  if (existsSync(currentPath)) {
    return { original: currentPath, resolved: currentPath, found: true }
  }

  return { original: currentPath, resolved: currentPath, found: false }
}

// 从 args_json 中提取实际文件路径（跳过 --flag）
export function extractFilePath(argsJson: string): string | null {
  try {
    const args: string[] = JSON.parse(argsJson)
    for (const arg of args) {
      if (!arg.startsWith('-') && (arg.endsWith('.mjs') || arg.endsWith('.js') || arg.endsWith('.py'))) {
        return arg
      }
    }
  } catch { /* malformed json */ }
  return null
}

// ─── Startup: resolve all + auto-heal DB ──────────────────

export function healAllMCPPaths(db: any): { healed: string[]; broken: string[] } {
  const healed: string[] = []
  const broken: string[] = []

  try {
    const servers = db.prepare('SELECT id, name, command, args_json FROM mcp_servers').all() as any[]

    for (const srv of servers) {
      // Resolve command path
      if (srv.command && (srv.command.includes('.codex/') || srv.command.includes('.workbuddy/'))) {
        const cmdResolved = resolveMCPPath(srv.id, srv.command)
        if (cmdResolved.found && cmdResolved.resolved !== cmdResolved.original) {
          db.prepare('UPDATE mcp_servers SET command = ? WHERE id = ?').run(cmdResolved.resolved, srv.id)
          healed.push(`${srv.name}: command ${srv.command} → ${cmdResolved.resolved}`)
        } else if (!cmdResolved.found) {
          broken.push(`${srv.name}: command not found: ${srv.command}`)
        }
      }

      // Resolve args paths (including placeholders)
      const filePath = extractFilePath(srv.args_json)
      // Handle seed placeholders
      if (!filePath || filePath.startsWith('__')) {
        // Try to resolve from the pattern directly
        const pattern = PATH_PATTERNS[srv.id]
        if (pattern) {
          const resolved = scanDir(pattern.baseDir, pattern.file, pattern.minDepth ?? 1, pattern.glob)
          if (resolved) {
            const existingArgs = JSON.parse(srv.args_json)
            // Replace the placeholder arg with resolved path
            const newArgs = existingArgs.map((a: string) =>
              (a.startsWith('__') && a.endsWith('__')) ? resolved : a
            )
            db.prepare('UPDATE mcp_servers SET args_json = ? WHERE id = ?').run(JSON.stringify(newArgs), srv.id)
            healed.push(`${srv.name}: args placeholder → ${resolved}`)
            continue
          } else {
            broken.push(`${srv.name}: cannot resolve path pattern for ${srv.id}`)
          }
        }
      }
      if (filePath && (filePath.includes('.codex/') || filePath.includes('WorkBuddy/'))) {
        const argResolved = resolveMCPPath(srv.id, filePath)
        if (argResolved.found && argResolved.resolved !== argResolved.original) {
          const newArgs = JSON.parse(srv.args_json).map((a: string) =>
            a === filePath ? argResolved.resolved : a
          )
          db.prepare('UPDATE mcp_servers SET args_json = ? WHERE id = ?').run(JSON.stringify(newArgs), srv.id)
          healed.push(`${srv.name}: args ${filePath} → ${argResolved.resolved}`)
        } else if (!argResolved.found) {
          broken.push(`${srv.name}: args not found: ${filePath}`)
        }
      }
    }
  } catch (e: any) {
    console.error('[MCP-PathResolve] heal error:', e.message)
  }

  return { healed, broken }
}
