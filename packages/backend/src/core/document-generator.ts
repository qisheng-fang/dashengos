// packages/backend/src/core/document-generator.ts · Phase A.4 (2026-06-17)
// 文档生成核心：通过 Python 子进程调用 python-pptx/docx/weasyprint/openpyxl
//
// 用法:
//   import { generatePPTX, generateDOCX, generatePDF, generateXLSX } from './core/document-generator.js'
//   const path = await generatePPTX({ title: 'Q3 Report', slides: [...] })

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Python 路径优先级:
//   1. 项目级 .venv (如果有)
//   2. WorkBuddy 管理的 Python (macOS)
//   3. 系统 python3
function resolvePython(): string {
  // 项目级 agent venv 优先 (含 python-docx, python-pptx, openpyxl)
  // __dirname = packages/backend/dist/core/
  // 需要 4 级往上到项目根 → agent/.venv/bin/python3
  const projectRoot = path.join(__dirname, '..', '..', '..', '..')
  const candidates = [
    // 项目 agent/.venv (DaShengOS deerflow)
    path.join(projectRoot, 'agent', '.venv', 'bin', 'python3'),
    // WorkBuddy managed Python (macOS)
    path.join(os.homedir(), '.workbuddy', 'binaries', 'python', 'versions', '3.13.12', 'bin', 'python3'),
    // System
    'python3',
  ]

  for (const candidate of candidates) {
    if (candidate) return candidate
  }
  return 'python3'
}

const PYTHON = resolvePython()
const DOCGEN_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'docgen.py')

// ─── Types ────────────────────────────────────────────────

export interface PPTXOptions {
  title: string
  slides: Array<{ title: string; content: string; layout?: string }>
  outputPath?: string
}

export interface DOCXOptions {
  title: string
  sections: Array<{ heading: string; content: string }>
  outputPath?: string
}

export interface PDFOptions {
  title: string
  html: string
  outputPath?: string
}

export interface XLSXOptions {
  sheets: Array<{ name: string; headers: string[]; rows: string[][] }>
  outputPath?: string
}

export interface GenerateResult {
  filePath: string
  fileName: string
  size: number
}

export interface GenerateError {
  error: string
  missingPackage?: string
}

// ─── Core: spawn Python ───────────────────────────────────

async function runPython(input: Record<string, unknown>): Promise<GenerateResult> {
  const jsonInput = JSON.stringify(input)

  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [DOCGEN_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', DYLD_FALLBACK_LIBRARY_PATH: '/usr/local/Homebrew/lib' },
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      if (code !== 0) {
        // Parse JSON error response from stdout if possible
        if (stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim())
            reject(new Error(parsed.error || `Python exited with code ${code}`))
            return
          } catch { /* fall through */ }
        }
        const errMsg = stderr.trim() || `Python process exited with code ${code}`
        reject(new Error(errMsg))
        return
      }

      try {
        const result = JSON.parse(stdout.trim())
        if (result.ok) {
          resolve({
            filePath: result.path,
            fileName: result.file_name,
            size: result.size,
          })
        } else {
          reject(new Error(result.error || 'Unknown error from docgen.py'))
        }
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${stdout.trim().slice(0, 200)}`))
      }
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Python: ${PYTHON} — ${err.message}`))
    })

    // Write JSON to stdin
    child.stdin.write(jsonInput)
    child.stdin.end()
  })
}

// ─── Public API ───────────────────────────────────────────

export async function generatePPTX(options: PPTXOptions): Promise<GenerateResult> {
  return runPython({
    format: 'pptx',
    title: options.title,
    slides: options.slides,
  })
}

export async function generateDOCX(options: DOCXOptions): Promise<GenerateResult> {
  return runPython({
    format: 'docx',
    title: options.title,
    sections: options.sections,
  })
}

export async function generatePDF(options: PDFOptions): Promise<GenerateResult> {
  return runPython({
    format: 'pdf',
    title: options.title,
    html: options.html,
  })
}

export async function generateXLSX(options: XLSXOptions): Promise<GenerateResult> {
  return runPython({
    format: 'xlsx',
    sheets: options.sheets,
  })
}

// ─── Health Check ─────────────────────────────────────────

export async function checkPythonDeps(): Promise<{ python: string; packages: Record<string, boolean> }> {
  // Python module names (may differ from pip package names)
  const moduleNames: Record<string, string> = {
    pptx: 'pptx',          // pip: python-pptx
    docx: 'docx',          // pip: python-docx
    pdf: 'weasyprint',     // pip: weasyprint
    xlsx: 'openpyxl',      // pip: openpyxl
  }

  const result: Record<string, boolean> = {}

  for (const [key, mod] of Object.entries(moduleNames)) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(PYTHON, ['-c', `import ${mod}`], { stdio: 'ignore' })
        child.on('close', (code) => {
          if (code === 0) resolve()
          else reject(new Error(`${mod} not available`))
        })
        child.on('error', reject)
      })
      result[key] = true
    } catch {
      result[key] = false
    }
  }

  return { python: PYTHON, packages: result }
}
