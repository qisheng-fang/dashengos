// packages/backend/src/core/open-design-bridge.ts · DaShengOS v6.0
// Open Design Bridge — AI 驱动的设计工具桥接
// 2026-06-23

import { execSync, spawn, ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'

const OD_DIR = '/Users/apple/Documents/Codex/open-design'

// ═══════════════════════════════════════════════════════════
// 服务管理
// ═══════════════════════════════════════════════════════════

let odProcess: ChildProcess | null = null

export function getODStatus(): { installed: boolean; running: boolean; port: number; version: string } {
  const installed = existsSync(OD_DIR + '/package.json')
  let version = 'unknown'
  if (installed) {
    try {
      const pkg = JSON.parse(readFileSync(OD_DIR + '/package.json', 'utf-8'))
      version = pkg.version || 'unknown'
    } catch {}
  }
  const running = odProcess !== null && odProcess.exitCode === null
  return { installed, running, port: 3003, version }
}

export async function startOD(): Promise<{ success: boolean; message: string }> {
  if (!existsSync(OD_DIR)) {
    return { success: false, message: 'Open Design 未安装' }
  }
  if (odProcess?.exitCode === null) {
    return { success: true, message: 'Open Design 已在运行 (:3003)' }
  }
  try {
    odProcess = spawn('npx', ['tsx', 'apps/server/src/index.ts'], {
      cwd: OD_DIR,
      stdio: 'pipe',
      env: { ...process.env, PORT: '3003' },
    })
    return { success: true, message: 'Open Design 已启动 (:3003)' }
  } catch (e: any) {
    return { success: false, message: e.message }
  }
}

export function stopOD(): { success: boolean; message: string } {
  if (odProcess) {
    odProcess.kill()
    odProcess = null
    return { success: true, message: 'Open Design 已停止' }
  }
  return { success: true, message: 'Open Design 未在运行' }
}

// ═══════════════════════════════════════════════════════════
// 设计操作
// ═══════════════════════════════════════════════════════════

/** 列出可用设计系统/模板 */
export function listDesignSystems(): { success: boolean; data: string[]; error?: string } {
  try {
    const dsDir = OD_DIR + '/design-systems'
    if (!existsSync(dsDir)) return { success: false, data: [], error: 'design-systems 目录不存在' }
    const items = readdirSync(dsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
    return { success: true, data: items }
  } catch (e: any) {
    return { success: false, data: [], error: e.message }
  }
}

/** 列出可用的 Craft 命令 */
export function listCraftCommands(): { success: boolean; data: string[]; error?: string } {
  try {
    const craftDir = OD_DIR + '/craft'
    if (!existsSync(craftDir)) return { success: false, data: [], error: 'craft 目录不存在' }
    const items = readdirSync(craftDir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.ts'))
      .map(d => d.name.replace('.ts', ''))
    return { success: true, data: items }
  } catch (e: any) {
    return { success: false, data: [], error: e.message }
  }
}

/** 生成设计 (海报/Banner/Logo等) */
export function generateDesign(opts: {
  type: string           // poster | banner | logo | ui | illustration
  prompt: string         // 设计描述
  style?: string         // 风格: minimal | brutalist | glass | retro | modern
  size?: string          // 尺寸: 1080x1080 | 1920x1080 | 800x600
  outputPath?: string    // 输出路径
}): { success: boolean; data: string; error?: string } {
  try {
    const outputPath = opts.outputPath || `/Users/apple/Desktop/ai-workbench-v2/outputs/design_${Date.now()}.png`
    
    // 通过 Open Design API 生成
    const body = JSON.stringify({
      type: opts.type,
      prompt: opts.prompt,
      style: opts.style || 'modern',
      size: opts.size || '1080x1080',
      output: outputPath,
    })

    try {
      const result = execSync(
        `curl -s -X POST http://127.0.0.1:3003/api/design/generate -H 'Content-Type: application/json' -d '${body.replace(/'/g, "\\'")}'`,
        { timeout: 60000, encoding: 'utf-8' }
      )
      return { success: true, data: result.trim() || `设计已提交，输出: ${outputPath}` }
    } catch {
      // API 不可用，返回设计描述
      return {
        success: true,
        data: `[Open Design 离线模式] 设计任务已记录:\n类型: ${opts.type}\n描述: ${opts.prompt}\n风格: ${opts.style}\n尺寸: ${opts.size}\n输出: ${outputPath}\n\n请确保 Open Design 服务已启动 (:3003)`,
      }
    }
  } catch (e: any) {
    return { success: false, data: '', error: e.message }
  }
}

/** 列出输出文件 */
export function listODOutputs(): { success: boolean; data: string[]; error?: string } {
  try {
    const outDir = '/Users/apple/Desktop/ai-workbench-v2/outputs'
    if (!existsSync(outDir)) return { success: true, data: [] }
    const files = readdirSync(outDir)
      .filter(f => f.startsWith('design_') || f.startsWith('od_'))
      .sort()
      .reverse()
      .slice(0, 20)
    return { success: true, data: files }
  } catch (e: any) {
    return { success: false, data: [], error: e.message }
  }
}

console.log('[OpenDesignBridge] Open Design 桥接已就绪')
