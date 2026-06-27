// DaShengOS v6.0 · MCP Seed Data
// 声明式 MCP 服务器默认配置 — 持久化到 DB 的真相源
// 启动时: 1) 自动解析路径  2) 补全缺失记录  3) 愈合过期路径

import { sqlite } from '../storage/db.js'
import { healAllMCPPaths } from './mcp-path-resolver.js'

// ─── Seed manifest (declarative, no hardcoded hashes) ────

export const MCP_SEED = [
  {
    id: 'mcp_playwright',
    name: 'Playwright Browser',
    command: 'npx',
    args: ['@playwright/mcp', '--headless'],
    category: 'browser',
    autoStart: true,
  },
  {
    id: 'mcp_xcodebuild',
    name: 'Xcode Build MCP',
    command: 'npx',
    args: ['-y', 'xcodebuildmcp@latest', 'mcp'],
    category: 'build',
    autoStart: true,
  },
  {
    id: 'mcp_codex_security',
    name: 'Codex Security',
    command: 'node',
    args: ['__CODEX_SECURITY_MCP__', '--stdio'],  // placeholder → resolved on startup
    category: 'security',
    autoStart: true,
  },
  {
    id: 'mcp_agnes_ai',
    name: 'Agnes AI',
    command: '__PYTHON3__',  // placeholder → resolved on startup
    args: ['__AGNES_MCP_SERVER__'],
    category: 'agent',
    autoStart: true,
  },
]

// ─── Seed logic ───────────────────────────────────────────

export function seedMCPServers(): { inserted: string[]; healed: string[]; broken: string[] } {
  const inserted: string[] = []
  const now = Date.now()

  // Step 1: Insert missing servers
  for (const seed of MCP_SEED) {
    const existing = sqlite.prepare('SELECT id FROM mcp_servers WHERE id = ?').get(seed.id)
    if (!existing) {
      try {
        sqlite.prepare(
          `INSERT INTO mcp_servers (id, name, command, args_json, status, created_at)
           VALUES (?, ?, ?, ?, 'REGISTERED', ?)`
        ).run(seed.id, seed.name, seed.command, JSON.stringify(seed.args), now)
        inserted.push(seed.name)
        console.log(`[MCP-Seed] Inserted ${seed.name}`)
      } catch (e: any) {
        console.error(`[MCP-Seed] Failed to insert ${seed.name}:`, e.message)
      }
    }
  }

  // Step 2: Heal paths (resolve placeholders + version hashes)
  const { healed, broken } = healAllMCPPaths(sqlite)

  if (healed.length > 0) {
    console.log(`[MCP-Seed] Healed ${healed.length} paths:`)
    healed.forEach(h => console.log(`  ✓ ${h}`))
  }
  if (broken.length > 0) {
    console.warn(`[MCP-Seed] ${broken.length} broken paths:`)
    broken.forEach(b => console.warn(`  ✗ ${b}`))
  }

  return { inserted, healed, broken }
}

// ─── Auto-start on boot ───────────────────────────────────

export async function autoStartMCPServers(): Promise<number> {
  const servers = sqlite.prepare(
    `SELECT id, name, command, args_json, env_json FROM mcp_servers WHERE status != 'STOPPED'`
  ).all() as Array<{ id: string; name: string; command: string; args_json: string; env_json: string | null }>

  let started = 0
  for (const srv of servers) {
    // Skip placeholder commands (not yet resolved)
    if (srv.command.startsWith('__') && srv.command.endsWith('__')) {
      console.warn(`[MCP-Seed] Skipping ${srv.name}: unresolved placeholder command`)
      continue
    }

    try {
      const { startMCPServer } = await import('./mcp-client.js')
      const config = {
        id: srv.id,
        name: srv.name,
        command: srv.command,
        args: JSON.parse(srv.args_json),
        env: srv.env_json ? JSON.parse(srv.env_json) : undefined,
      }
      const result = await startMCPServer(config)
      if (result.success) {
        started++
        console.log(`[MCP-Seed] Auto-started ${srv.name} (${result.tools.length} tools)`)
      }
    } catch (e: any) {
      console.error(`[MCP-Seed] Failed to auto-start ${srv.name}:`, e.message)
    }
  }

  return started
}
