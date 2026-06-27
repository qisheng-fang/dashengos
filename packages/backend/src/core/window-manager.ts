// DaShengOS v6.1 — Hermes Window Manager
// Native macOS window control via osascript (AppleScript)
// Aligns with: Hermes desktop window management
import { execSync } from 'node:child_process'

export interface WindowInfo {
  id: number
  name: string
  appName: string
  bounds: { x: number; y: number; w: number; h: number }
  visible: boolean
  frontmost: boolean
}

export interface WindowListResult {
  windows: WindowInfo[]
  frontmostApp: string
  totalVisible: number
}

export interface LayoutPreset {
  name: string
  description: string
  apply: () => boolean
}

// ─── Core ops ────────────────────────────────────────────

function osa(script: string): string {
  return execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf-8',
    timeout: 5000,
    stdio: ['pipe', 'pipe', 'ignore'],
  }).trim()
}

function osaBool(script: string): boolean {
  try {
    return osa(script) === 'true'
  } catch {
    return false
  }
}

// ─── Window enumeration ──────────────────────────────────

export function listWindows(filterApp?: string): WindowListResult {
  try {
    const raw = osa(`
      tell application "System Events"
        set output to ""
        set frontApp to name of first application process whose frontmost is true
        set processList to every application process whose visible is true
        repeat with p in processList
          set appName to name of p
          set isFront to (appName = frontApp)
          repeat with w in windows of p
            set winName to name of w
            set winPos to position of w
            set winSize to size of w
            set output to output & appName & "|" & winName & "|" & (item 1 of winPos) & "," & (item 2 of winPos) & "," & (item 1 of winSize) & "," & (item 2 of winSize) & "|" & isFront & linefeed
          end repeat
        end repeat
        return output
      end tell
    `)

    const lines = raw.split('\n').filter(Boolean)
    const windows: WindowInfo[] = []
    let id = 1

    for (const line of lines) {
      const parts = line.split('|')
      if (parts.length < 4) continue
      const [appName, winName, boundsStr, frontStr] = parts
      const [x, y, w, h] = boundsStr.split(',').map(Number)
      const isFront = frontStr === 'true'

      if (filterApp && !appName.toLowerCase().includes(filterApp.toLowerCase())) continue

      windows.push({
        id: id++,
        name: winName || appName,
        appName,
        bounds: { x, y, w, h },
        visible: true,
        frontmost: isFront,
      })
    }

    const frontmost = windows.find(w => w.frontmost)
    return {
      windows,
      frontmostApp: frontmost?.appName || 'Unknown',
      totalVisible: windows.length,
    }
  } catch (e: any) {
    return { windows: [], frontmostApp: 'Unknown', totalVisible: 0 }
  }
}

// ─── Window control ──────────────────────────────────────

export function focusWindow(appName: string, windowName?: string): { ok: boolean; app: string } {
  try {
    if (windowName) {
      osa(`
        tell application "System Events"
          tell process "${appName}"
            set frontmost to true
            try
              set frontWindow to first window whose name contains "${windowName}"
              set index of frontWindow to 1
            end try
          end tell
        end tell
      `)
    } else {
      osa(`tell application "${appName}" to activate`)
    }
    return { ok: true, app: appName }
  } catch (e: any) {
    return { ok: false, app: appName }
  }
}

export function moveWindow(
  appName: string,
  x: number,
  y: number,
  w?: number,
  h?: number,
): { ok: boolean; bounds: { x: number; y: number; w?: number; h?: number } } {
  try {
    let script = `
      tell application "System Events"
        tell process "${appName}"
          set frontWindow to window 1
          set position of frontWindow to {${x}, ${y}}
    `
    if (w && h) {
      script += `set size of frontWindow to {${w}, ${h}}`
    }
    script += `
        end tell
      end tell
    `
    osa(script)
    return { ok: true, bounds: { x, y, w, h } }
  } catch (e: any) {
    return { ok: false, bounds: { x, y } }
  }
}

export function minimizeWindow(appName: string): { ok: boolean } {
  try {
    osa(`
      tell application "System Events"
        tell process "${appName}"
          set miniaturized of window 1 to true
        end tell
      end tell
    `)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export function closeWindow(appName: string, windowName?: string): { ok: boolean } {
  try {
    if (windowName) {
      osa(`
        tell application "System Events"
          tell process "${appName}"
            repeat with w in windows
              if name of w contains "${windowName}" then
                click button 1 of w
                exit repeat
              end if
            end repeat
          end tell
        end tell
      `)
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// ─── Layout presets (Hermes-style) ────────────────────────

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    name: 'center',
    description: '将 DaShengOS 居中 (900x700)',
    apply: () => {
      const screenW = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[2] || '1920')
      const screenH = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[3] || '1080')
      const w = 900, h = 700
      return moveWindow('Google Chrome', Math.round((screenW - w) / 2), Math.round((screenH - h) / 2), w, h).ok
    },
  },
  {
    name: 'left-half',
    description: 'DaShengOS 占左半屏 + 浏览器右半屏',
    apply: () => {
      const screenW = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[2] || '1920')
      const halfW = Math.round(screenW / 2)
      const h = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[3] || '1080')
      const a = moveWindow('Google Chrome', 0, 0, halfW, h)
      const b = moveWindow('Code', halfW, 0, halfW, h)
      return a.ok || b.ok
    },
  },
  {
    name: 'right-half',
    description: '编辑器左半屏 + DaShengOS 右半屏',
    apply: () => {
      const screenW = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[2] || '1920')
      const halfW = Math.round(screenW / 2)
      const h = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[3] || '1080')
      const a = moveWindow('Code', 0, 0, halfW, h)
      const b = moveWindow('Google Chrome', halfW, 0, halfW, h)
      return a.ok || b.ok
    },
  },
  {
    name: 'fullscreen',
    description: '最大化 Chrome 窗口',
    apply: () => {
      const screenW = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[2] || '1920')
      const screenH = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[3] || '1080')
      return moveWindow('Google Chrome', 0, 0, screenW, screenH).ok
    },
  },
  {
    name: 'dashboard',
    description: 'DaShengOS 居中 (1100x800) + 终端底部',
    apply: () => {
      const screenW = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[2] || '1920')
      const screenH = Number(osa('tell application "Finder" to get bounds of window of desktop').split(', ')[3] || '1080')
      const a = moveWindow('Google Chrome', Math.round((screenW - 1100) / 2), 0, 1100, screenH - 300)
      const b = moveWindow('Terminal', Math.round((screenW - 1100) / 2), screenH - 300, 1100, 300)
      return a.ok || b.ok
    },
  },
]

// ─── Screen info ──────────────────────────────────────────

export function getScreenInfo(): { width: number; height: number; displays: number } {
  try {
    const bounds = osa('tell application "Finder" to get bounds of window of desktop')
    const parts = bounds.split(', ').map(Number)
    return { width: parts[2] || 1920, height: parts[3] || 1080, displays: 1 }
  } catch {
    return { width: 1920, height: 1080, displays: 1 }
  }
}

// ─── Floating panel (DaShengOS Chrome window) ──────────────

export function floatDaShengOS(): { ok: boolean; url: string } {
  try {
    const url = 'http://localhost:3000'
    osa(`
      tell application "Google Chrome"
        activate
        set found to false
        repeat with w in windows
          repeat with t in tabs of w
            if URL of t starts with "http://localhost:3000" then
              set active tab index of w to index of t
              set index of w to 1
              set found to true
              exit repeat
            end if
          end repeat
          if found then exit repeat
        end repeat
        if not found then
          make new window with properties {URL:"http://localhost:3000"}
        end if
      end tell
    `)
    return { ok: true, url }
  } catch (e: any) {
    return { ok: false, url: 'http://localhost:3000' }
  }
}
