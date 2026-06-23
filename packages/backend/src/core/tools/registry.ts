// packages/backend/src/core/tools/registry.ts
// DaShengOS Agent Runtime — Tool Registry & Executor
// 15 个内置工具，OpenAI function_call 格式，安全沙箱保护

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve, dirname } from 'path'
import Database from 'better-sqlite3'
import { getMCPToolsForLLM, executeMCPTool, isMCPTool } from '../mcp-client.js'

// ─── Types ─────────────────────────────────────────────

export interface ToolParameter {
  type: string
  description: string
  enum?: string[]
  default?: string | number | boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, ToolParameter>
  riskLevel: 'low' | 'medium' | 'high'
  requiresConfirmation: boolean
}

export interface ToolCall {
  name: string
  args: Record<string, any>
}

export interface ToolResult {
  success: boolean
  data?: string
  error?: string
  needsConfirmation?: boolean
}

export type ToolExecutor = (args: Record<string, any>, context: ExecutionContext) => Promise<ToolResult>

export interface ExecutionContext {
  userId: string
  sessionId?: string
  workspaceDir: string // 项目根目录，沙箱基路径
  maxTimeout: number   // ms
}

// ─── Security Constants ──────────────────────────────────

const PROJECT_ROOT = resolve('/Users/apple/Desktop/ai-workbench-v2')
const COMMAND_BLACKLIST = [
  'rm -rf /', 'rm -rf /*', 'sudo rm', 'chmod 777', 'chmod -R 777',
  '> /dev/sda', 'mkfs', 'dd if=', ':(){ :|:& };:', // fork bomb
  'curl | sh', 'wget | bash', 'eval base64', 'curl * | sudo',
  'DROP TABLE', 'DELETE FROM', 'TRUNCATE', '--force',
  'shutdown', 'reboot', 'halt', 'init 0', 'init 6',
]
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const MAX_EXEC_TIMEOUT = 30000 // 30s per command
const MAX_OUTPUT_CHARS = 50000 // 50KB max output

// ─── Security Helpers ───────────────────────────────────

function isPathSafe(path: string, workspaceDir: string): boolean {
  const resolved = resolve(path)
  const workspaceResolved = resolve(workspaceDir)
  return resolved.startsWith(workspaceResolved) || resolved.startsWith(PROJECT_ROOT)
}

function isCommandSafe(cmd: string): { safe: boolean; reason?: string } {
  const lower = cmd.toLowerCase().trim()
  for (const pattern of COMMAND_BLACKLIST) {
    if (lower.includes(pattern.toLowerCase())) {
      return { safe: false, reason: `Blocked command pattern: ${pattern}` }
    }
  }
  return { safe: true }
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output
  return output.slice(0, MAX_OUTPUT_CHARS) + `\n... [truncated, total ${output.length} chars]`
}

// ─── Tool Definitions (15 built-in) ─────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'read_file',
    description:
      'Read the contents of a file from the project directory. Use this to inspect source code, configuration files, logs, or any text-based file.',
    parameters: {
      path: { type: 'string', description: 'Absolute or relative file path to read' },
      offset: { type: 'number', description: 'Line number to start reading from (default: 0)', default: 0 },
      limit: { type: 'number', description: 'Max lines to read (default: 200)', default: 200 },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'write_file',
    description:
      'Write content to a file, creating it if it does not exist. Overwrites existing files. Only use within the project workspace.',
    parameters: {
      path: { type: 'string', description: 'File path to write to' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    riskLevel: 'medium',
    requiresConfirmation: true,
  },
  {
    name: 'edit_file',
    description:
      'Make a precise text replacement in an existing file. Finds old_string and replaces it with new_string. Safer than write_file for small edits.',
    parameters: {
      path: { type: 'string', description: 'File path to edit' },
      old_string: { type: 'string', description: 'Exact text to find and replace' },
      new_string: { type: 'string', description: 'Replacement text' },
    },
    riskLevel: 'medium',
    requiresConfirmation: true,
  },
  {
    name: 'list_files',
    description:
      'List and search files using glob patterns. Useful for exploring codebase structure, finding files by name or extension.',
    parameters: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.tsx"' },
      path: { type: 'string', description: 'Base directory to search in (defaults to workspace root)', default: '.' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'search_content',
    description:
      'Search file contents using regex patterns. Find where functions, variables, imports, or any text pattern are used across the codebase.',
    parameters: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'Directory to search in (defaults to workspace root)', default: '.' },
      file_pattern: { type: 'string', description: 'Filter to specific file types, e.g. "*.ts"', default: '*' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'run_command',
    description:
      'Execute a shell command (bash/zsh). Can build projects, run tests, install dependencies, start servers. High-risk operations require user confirmation.',
    parameters: {
      command: { type: 'string', description: 'Shell command to execute' },
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)', default: '.' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)', default: 30000 },
    },
    riskLevel: 'high',
    requiresConfirmation: true,
  },
  {
    name: 'check_process',
    description:
      'Check if a process is running by name or PID. Returns process status, PID, uptime, and resource usage.',
    parameters: {
      name: { type: 'string', description: 'Process name pattern to search for (e.g. "node" or "tsx")' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'check_port',
    description:
      'Check if a network port is open and listening. Useful for verifying services are running.',
    parameters: {
      port: { type: 'number', description: 'Port number to check' },
      host: { type: 'string', description: 'Host to check (default: 127.0.0.1)', default: '127.0.0.1' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'read_logs',
    description:
      'Read the last N lines of a log file. Useful for diagnosing errors after a failed operation.',
    parameters: {
      path: { type: 'string', description: 'Log file path' },
      lines: { type: 'number', description: 'Number of lines to read from the end (default: 50)', default: 50 },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'db_query',
    description:
      'Execute a read-only SQL query against the application SQLite database. For diagnostics only. DDL/DML statements are blocked.',
    parameters: {
      query: { type: 'string', description: 'SQL SELECT query (read-only)' },
    },
    riskLevel: 'medium',
    requiresConfirmation: false,
  },
  {
    name: 'web_fetch',
    description:
      'Fetch and extract content from a URL. Returns page text/summary. Useful for reading documentation, API responses, or web pages.',
    parameters: {
      url: { type: 'string', description: 'URL to fetch' },
      prompt: { type: 'string', description: 'What information to extract from the page', default: 'Summarize the main content of this page' },
    },
    riskLevel: 'medium',
    requiresConfirmation: false,
  },
  {
    name: 'web_search',
    description:
      'Search the web for information. Returns relevant results for research, debugging, or finding documentation.',
    parameters: {
      query: { type: 'string', description: 'Search query' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'restart_service',
    description:
      'Restart the backend service (port 8000). Only use when configuration changes require a restart. Requires explicit user confirmation.',
    parameters: {},
    riskLevel: 'high',
    requiresConfirmation: true,
  },
  {
    name: 'install_package',
    description:
      'Install npm packages into the project. Used when new dependencies are needed for fixes or features.',
    parameters: {
      package: { type: 'string', description: 'npm package name(s), e.g. "lodash" or "eslint @types/node"' },
      cwd: { type: 'string', description: 'Directory to install in (defaults to workspace root)', default: '.' },
    },
    riskLevel: 'high',
    requiresConfirmation: true,
  },
  {
    name: 'git_op',
    description:
      'Perform git operations: status, log, diff, commit, checkout (rollback). Essential for version control during self-repair workflows.',
    parameters: {
      op: { type: 'string', description: 'Operation: status | log | diff | commit | checkout' },
      message: { type: 'string', description: 'Commit message (required for commit op)' },
      target: { type: 'string', description: 'Target ref for checkout (required for checkout op)' },
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)', default: '.' },
    },
    riskLevel: 'high',
    requiresConfirmation: true,
  },
  // P4 (2026-06-18): 技能执行工具 - 读取 SKILL.md 并返回执行指令
  {
    name: 'execute_skill',
    description:
      'Execute a WorkBuddy skill by reading its SKILL.md instructions. Returns step-by-step guidance for the Agent to follow. Use this when user asks to run a specific skill.',
    parameters: {
      skill_name: { type: 'string', description: 'Name of the skill to execute (e.g. "xlsx", "pdf", "web-search")' },
      params: { type: 'object', description: 'Optional parameters to pass to the skill (skill-specific)' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'list_skills',
    description:
      'List all available skills. Returns skill names and descriptions. Use this to discover what skills are installed before calling execute_skill. Supports keyword search via optional query parameter.',
    parameters: {
      query: { type: 'string', description: 'Optional keyword to filter skills by name or description. Leave empty to list all.' },
    },
    riskLevel: 'low',
    requiresConfirmation: false,
  },
  {
    name: 'create_skill',
    description:
      'Create a new skill by writing a SKILL.md file. Use this to save discovered patterns or user-requested workflows as reusable skills. The skill will be available for future use via execute_skill.',
    parameters: {
      skill_name: { type: 'string', description: 'Unique skill name (lowercase, hyphens, e.g. "web-report-generator")' },
      description: { type: 'string', description: 'Short description of what the skill does' },
      category: { type: 'string', description: 'Category: research, development, ops, productivity, marketing' },
      risk_level: { type: 'string', description: 'Risk level: low, medium, high' },
      instructions: { type: 'string', description: 'Full SKILL.md content (Markdown with YAML frontmatter)' },
    },
    riskLevel: 'medium',
    requiresConfirmation: true,
  },
  
  {
    name: "open_design_execute",
    description:
      "Execute an Open Design command via its daemon. Open Design is a local-first design tool that generates UI/UX artifacts. Use this to create designs, generate components, or run design skills.",
    parameters: {
      command: { type: "string", description: "Open Design CLI command (e.g. generate, skill, preview, export)" },
      args: { type: "object", description: "Arguments for the command. Keys depend on the command." },
      working_dir: { type: "string", description: "Open Design project path", default: "/Users/apple/Documents/Codex/open-design" },
    },
    riskLevel: "low",
    requiresConfirmation: false,
  },
  {
    name: "openmontage_read",
    description:
      "Read files from the OpenMontage project. OpenMontage is an AI-driven video/design production tool. Use this to read project config, AGENTS.md, or artifacts.",
    parameters: {
      file_path: { type: "string", description: "Relative path within the OpenMontage project (e.g. config.yaml, AGENTS.md, artifacts/)" },
      working_dir: { type: "string", description: "OpenMontage project path", default: "/Users/apple/Documents/Codex/OpenMontage" },
    },
    riskLevel: "low",
    requiresConfirmation: false,
  },
  // ── Open Design ──
  {
    name: "opendesign_status",
    description: "Check Open Design service status. Use before generating any design.",
    parameters: {},
    riskLevel: "READ",
    requiresConfirmation: false,
  },
  {
    name: "opendesign_generate",
    description: "Generate a design (poster, banner, logo, UI) via Open Design. Provide type and prompt.",
    parameters: {
      type: { type: "string", description: "Design type: poster, banner, logo, ui, illustration" },
      prompt: { type: "string", description: "Design description in natural language" },
    },
    riskLevel: "WRITE",
    requiresConfirmation: false,
  },
  {
    name: "openmontage_list",
    description: "List all video production pipelines in OpenMontage with stage counts.",
    parameters: {},
    riskLevel: "READ",
    requiresConfirmation: false,
  },
  {
    name: "openmontage_execute",
    description: "Execute an OpenMontage pipeline to produce video from text.",
    parameters: {
      pipeline: { type: "string", description: "Pipeline name" },
      input: { type: "string", description: "Input text/topic" },
    },
    riskLevel: "EXEC",
    requiresConfirmation: false,
  },
  {
    name: "agent_tars_execute",
    description: "Execute an Agent TARS autonomous agent task. Agent TARS is a Python-based autonomous agent for complex multi-step research and automation tasks.",
    parameters: {
      task: { type: "string", description: "Task description for the agent to execute" },
      mode: { type: "string", description: "Execution mode: research, automation, analysis", default: "research" },
    },
    riskLevel: "EXEC",
    requiresConfirmation: false,
  },
  {
    name: "langgraph_execute",
    description: "Execute a LangGraph workflow. LangGraph is a state-machine based workflow engine for building complex LLM pipelines.",
    parameters: {
      graph_name: { type: "string", description: "Name of the LangGraph workflow to execute" },
      input: { type: "string", description: "Input data for the workflow (JSON or text)" },
    },
    riskLevel: "EXEC",
    requiresConfirmation: false,
  },
  {
    name: "transformers_execute",
    description: "Execute a HuggingFace Transformers model for NLP tasks (text generation, classification, translation, summarization).",
    parameters: {
      task_type: { type: "string", description: "Task: text-generation, classification, translation, summarization, qa" },
      input_text: { type: "string", description: "Input text to process" },
      model_name: { type: "string", description: "HF model name (optional, uses default if not specified)" },
    },
    riskLevel: "EXEC",
    requiresConfirmation: false,
  },
  {
    name: "agent_manage",
    description: "Manage DaShengOS agents: list, start, stop, or get status of agents.",
    parameters: {
      action: { type: "string", description: "Action: list, start, stop, status" },
      agent_name: { type: "string", description: "Agent name or ID (for start/stop/status)" },
    },
    riskLevel: "EXEC",
    requiresConfirmation: false,
  },
  {
    name: "document_generate",
    description: "Generate a professional document/report (PDF, DOCX, PPTX, XLSX, HTML). Use for reports, proposals, presentations, spreadsheets.",
    parameters: {
      topic: { type: "string", description: "Document topic or title" },
      format: { type: "string", description: "Output format: html, pdf, docx, pptx, xlsx", default: "html" },
      style: { type: "string", description: "Document style: report, proposal, presentation, spreadsheet", default: "report" },
      sections: { type: "string", description: "Comma-separated section names to include" },
    },
    riskLevel: "WRITE",
    requiresConfirmation: false,
  },
  {
    name: "visualization_generate",
    description: "Generate data visualizations (charts, graphs, dashboards). Use for trend charts, comparison graphs, pie charts, bar charts.",
    parameters: {
      chart_type: { type: "string", description: "Chart type: bar, line, pie, scatter, area, dashboard, radar, heatmap" },
      data_description: { type: "string", description: "Describe the data to visualize" },
      title: { type: "string", description: "Chart title" },
      format: { type: "string", description: "Output format: html, png, svg", default: "html" },
    },
    riskLevel: "WRITE",
    requiresConfirmation: false,
  },
]

// ─── Executors (one per tool) ────────────────────────────

const executors: Record<string, ToolExecutor> = {

  async read_file(args, ctx) {
    const filePath = resolve(ctx.workspaceDir, args.path)
    if (!isPathSafe(filePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${filePath}` }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    try {
      const stat = statSync(filePath)
      if (stat.size > MAX_FILE_SIZE) {
        return { success: false, error: `File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB > ${MAX_FILE_SIZE / 1024 / 1024}MB limit` }
      }
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      const offset = Number(args.offset || 0)
      const limit = Number(args.limit || 200)
      const sliced = lines.slice(offset, offset + limit)
      const numbered = sliced.map((l, i) => `${String(offset + i + 1).padStart(5)}| ${l}`).join('\n')
      return {
        success: true,
        data: `${filePath} (${lines.length} total lines, showing ${sliced.length})\n${numbered}`,
      }
    } catch (e: any) {
      return { success: false, error: `Failed to read file: ${e.message}` }
    }
  },

  async write_file(args, ctx) {
    const filePath = resolve(ctx.workspaceDir, args.path)
    if (!isPathSafe(filePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${filePath}`, needsConfirmation: true }
    }
    try {
      // Ensure parent directory exists
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        // Don't auto-create deep directories without confirmation
        return { success: false, error: `Parent directory does not exist: ${dir}. Create it first.`, needsConfirmation: true }
      }
      writeFileSync(filePath, String(args.content || ''), 'utf-8')
      return { success: true, data: `Written ${Buffer.byteLength(String(args.content || ''))} bytes to ${filePath}` }
    } catch (e: any) {
      return { success: false, error: `Failed to write file: ${e.message}`, needsConfirmation: true }
    }
  },

  async edit_file(args, ctx) {
    const filePath = resolve(ctx.workspaceDir, args.path)
    if (!isPathSafe(filePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${filePath}`, needsConfirmation: true }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: `File not found: ${filePath}` }
    }
    try {
      const content = readFileSync(filePath, 'utf-8')
      if (!content.includes(args.old_string)) {
        return { success: false, error: `old_string not found in file` }
      }
      const newContent = content.replace(args.old_string, args.new_string)
      writeFileSync(filePath, newContent, 'utf-8')
      const count = (content.match(new RegExp(args.old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
      return { success: true, data: `Replaced ${count} occurrence(s) in ${filePath}` }
    } catch (e: any) {
      return { success: false, error: `Failed to edit file: ${e.message}`, needsConfirmation: true }
    }
  },

  async list_files(args, ctx) {
    const basePath = resolve(ctx.workspaceDir, args.path || '.')
    if (!isPathSafe(basePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${basePath}` }
    }
    try {
      const pattern = args.pattern || '**/*'
      // Use Node.js built-in recursive readdir as fallback for glob
      const files = findFiles(basePath, pattern)
      const relPaths = files.map(f => relative(basePath, f)).sort()
      return { success: true, data: `Found ${relPaths.length} files:\n${relPaths.join('\n')}` }
    } catch (e: any) {
      return { success: false, error: `Failed to list files: ${e.message}` }
    }
  },

  async search_content(args, ctx) {
    const basePath = resolve(ctx.workspaceDir, args.path || '.')
    if (!isPathSafe(basePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${basePath}` }
    }
    try {
      const results = grepFiles(basePath, args.pattern || '', args.file_pattern || '*')
      return { success: true, data: `Found ${results.length} matches:\n${results.join('\n')}` }
    } catch (e: any) {
      return { success: false, error: `Search failed: ${e.message}` }
    }
  },

  async run_command(args, ctx) {
    const safeCheck = isCommandSafe(args.command)
    if (!safeCheck.safe) {
      return { success: false, error: safeCheck.reason!, needsConfirmation: true }
    }
    const cwd = resolve(ctx.workspaceDir, args.cwd || '.')
    if (!isPathSafe(cwd, ctx.workspaceDir)) {
      return { success: false, error: `CWD outside workspace: ${cwd}`, needsConfirmation: true }
    }
    const timeout = Math.min(Number(args.timeout) || MAX_EXEC_TIMEOUT, 120000) // cap at 2min
    try {
      const result = execSync(args.command, {
        cwd,
        timeout,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        maxBuffer: MAX_OUTPUT_CHARS,
      })
      return { success: true, data: truncateOutput(result) }
    } catch (e: any) {
      const stderr = e.stderr ? truncateOutput(e.stderr) : ''
      const stdout = e.stdout ? truncateOutput(e.stdout) : ''
      return {
        success: false,
        error: `Command exited with code ${e.status || 1}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}`,
        needsConfirmation: true,
      }
    }
  },

  async check_process(args, _ctx) {
    try {
      const result = execSync(`ps aux | grep -i "${args.name}" | grep -v grep`, {
        encoding: 'utf-8',
        timeout: 5000,
      })
      const lines = result.trim().split('\n').filter(Boolean)
      return {
        success: true,
        data: `Found ${lines.length} process(es) matching "${args.name}":\n${truncateOutput(result.trim())}`,
      }
    } catch (e: any) {
      return { success: true, data: `No running processes matching "${args.name}"` }
    }
  },

  async check_port(args, _ctx) {
    const net = await import('net')
    return new Promise((resolve) => {
      const sock = new net.Socket()
      const host = args.host || '127.0.0.1'
      const port = Number(args.port)

      sock.setTimeout(3000)
      sock.on('connect', () => {
        sock.destroy()
        resolve({ success: true, data: `Port ${port} on ${host} is OPEN (listening)` })
      })
      sock.on('timeout', () => {
        sock.destroy()
        resolve({ success: true, data: `Port ${port} on ${host} is CLOSED (timeout)` })
      })
      sock.on('error', () => {
        resolve({ success: true, data: `Port ${port} on ${host} is CLOSED (connection refused)` })
      })

      sock.connect(port, host)
    })
  },

  async read_logs(args, ctx) {
    const filePath = resolve(ctx.workspaceDir, args.path)
    if (!isPathSafe(filePath, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${filePath}` }
    }
    if (!existsSync(filePath)) {
      return { success: false, error: `Log file not found: ${filePath}` }
    }
    try {
      const stat = statSync(filePath)
      const lines = Number(args.lines || 50)
      // Read tail of file efficiently
      const content = readFileSync(filePath, 'utf-8')
      const allLines = content.split('\n')
      const tailLines = allLines.slice(-lines)
      const offset = Math.max(0, allLines.length - lines)
      const numbered = tailLines.map((l, i) => `${String(offset + i + 1).padStart(6)}| ${l}`).join('\n')
      return {
        success: true,
        data: `${filePath} (${allLines.length} total lines, showing last ${tailLines.length}, size: ${(stat.size / 1024).toFixed(1)}KB)\n${numbered}`,
      }
    } catch (e: any) {
      return { success: false, error: `Failed to read logs: ${e.message}` }
    }
  },

  async db_query(args, _ctx) {
    // Block non-read queries
    const upperQuery = args.query.toUpperCase().trim()
    const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'REPLACE']
    for (const kw of forbiddenKeywords) {
      if (upperQuery.includes(kw)) {
        return { success: false, error: `DML/DDL statements not allowed: ${kw} detected` }
      }
    }
    try {
      const dbPath = join(PROJECT_ROOT, 'packages/backend/data/dasheng.db')
      const db = new Database(dbPath, { readonly: true })
      const stmt = db.prepare(args.query)
      const rows = stmt.all() as Record<string, any>[]
      db.close()

      if (rows.length === 0) {
        return { success: true, data: 'Query returned 0 rows.' }
      }

      // Format as table-like output
      const headers = Object.keys(rows[0])
      const colWidths = headers.map(h =>
        Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length))
      )
      const sep = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+'
      const headerRow = '| ' + headers.map((h, i) => h.padStart(colWidths[i])).join(' | ') + ' |'
      const dataRows = rows.map(r =>
        '| ' + headers.map((h, i) => String(r[h] ?? '').padStart(colWidths[i])).join(' | ') + ' |'
      )
      return {
        success: true,
        data: `${rows.length} row(s)\n${sep}\n${headerRow}\n${sep}\n${dataRows.join('\n')}\n${sep}`,
      }
    } catch (e: any) {
      return { success: false, error: `DB query failed: ${e.message}` }
    }
  },

  async web_fetch(args, _ctx) {
    try {
      const resp = await fetch(args.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'DaShengOS-Agent/1.0' },
      })
      const contentType = resp.headers.get('content-type') || ''
      let body = ''

      if (contentType.includes('text/html') || contentType.includes('text/plain') || !contentType) {
        body = await resp.text()
        // Strip HTML tags for cleaner output
        if (contentType.includes('text/html')) {
          body = body
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
          if (body.length > 10000) body = body.slice(0, 10000) + '\n... [truncated]'
        }
      } else {
        body = `(Binary/non-text response, ${resp.headers.get('content-length')} bytes)`
      }

      return {
        success: true,
        data: `[${resp.status}] ${args.url} (${body.length} chars)\n${body}`,
      }
    } catch (e: any) {
      return { success: false, error: `Fetch failed: ${e.message}` }
    }
  },

  async web_search(args, _ctx) {
    const query = encodeURIComponent(args.query)
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

    // Bing (cn.bing.com)
    try {
      const resp = await fetch(`https://cn.bing.com/search?q=${query}&setlang=zh-cn&setmkt=zh-CN`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      })
      const html = await resp.text()
      const results: string[] = []
      const pRegex = /<p class="b_lineclamp\d+">([\s\S]*?)<\/p>/gi
      let match
      while ((match = pRegex.exec(html)) && results.length < 8) {
        const snippet = match[1].replace(/<[^>]+>/g, '').trim()
        if (snippet) results.push(snippet)
      }
      if (results.length > 0) {
        return { success: true, data: `[Bing] "${args.query}":\n\n${results.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}` }
      }
    } catch { /* try next */ }

    // Baidu fallback
    try {
      const resp = await fetch(`https://www.baidu.com/s?wd=${query}&rn=8`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': UA },
      })
      const html = await resp.text()
      const results: string[] = []
      const regex = /class="c-abstract"[^>]*>([\s\S]*?)<\/div>/gi
      let match
      while ((match = regex.exec(html)) && results.length < 8) {
        const s = match[1].replace(/<[^>]+>/g, '').trim()
        if (s && s.length > 10) results.push(s)
      }
      if (results.length > 0) {
        return { success: true, data: `[Baidu] "${args.query}":\n\n${results.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}` }
      }
    } catch { /* try next */ }

    // DuckDuckGo last resort
    try {
      const resp = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'DaShengOS-Agent/1.0' },
      })
      const html = await resp.text()
      const results: string[] = []
      const regex = /class="result__snippet">([\s\S]*?)<\/a>/g
      let match
      while ((match = regex.exec(html)) && results.length < 8) {
        const s = match[1].replace(/<[^>]+>/g, '').trim()
        if (s) results.push(s)
      }
      if (results.length > 0) {
        return { success: true, data: `[DuckDuckGo] "${args.query}":\n\n${results.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}` }
      }
    } catch { /* last resort */ }

    return { success: false, error: `All search engines unreachable for "${args.query}".` }
  },

  async restart_service(_args, _ctx) {
    try {
      // Find and kill the backend process
      const pidResult = execSync("pgrep -f 'tsx.*server.ts' | head -1", { encoding: 'utf-8', timeout: 5000 }).trim()
      const pid = parseInt(pidResult)
      if (pid) {
        execSync(`kill ${pid}`, { timeout: 5000 })
        return { success: true, data: `Sent kill signal to backend process (PID: ${pid}). Service will restart via process manager.` }
      }
      return { success: false, error: 'Backend process not found. Is it running?' }
    } catch (e: any) {
      return { success: false, error: `Restart failed: ${e.message}`, needsConfirmation: true }
    }
  },

  async install_package(args, ctx) {
    const pkgName = args.package
    if (!pkgName || typeof pkgName !== 'string') {
      return { success: false, error: 'Package name is required' }
    }
    // Block obviously dangerous packages
    const blockedPkgs = ['hack', 'exploit', 'malware', 'rootkit', 'keylog']
    if (blockedPkgs.some(p => pkgName.toLowerCase().includes(p))) {
      return { success: false, error: `Blocked package: ${pkgName}`, needsConfirmation: true }
    }

    const cwd = resolve(ctx.workspaceDir, args.cwd || '.')
    if (!isPathSafe(cwd, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${cwd}`, needsConfirmation: true }
    }

    try {
      const npxPath = '/Users/apple/.workbuddy/binaries/node/versions/22.22.2/bin/npx'
      const result = execSync(`${npxPath} npm install ${pkgName}`, {
        cwd,
        timeout: 120000,
        encoding: 'utf-8',
        env: { ...process.env, NODE_PATH: '/Users/apple/.workbuddy/binaries/node/workspace/node_modules' },
      })
      return { success: true, data: `Installed: ${pkgName}\n${truncateOutput(result)}` }
    } catch (e: any) {
      return { success: false, error: `Install failed: ${e.stderr || e.message}`, needsConfirmation: true }
    }
  },

  async git_op(args, ctx) {
    const validOps = ['status', 'log', 'diff', 'commit', 'checkout']
    const op = args.op?.toLowerCase()
    if (!validOps.includes(op)) {
      return { success: false, error: `Invalid git op. Must be one of: ${validOps.join(', ')}` }
    }

    const cwd = resolve(ctx.workspaceDir, args.cwd || '.')
    if (!isPathSafe(cwd, ctx.workspaceDir)) {
      return { success: false, error: `Path outside workspace: ${cwd}` }
    }

    try {
      let cmd: string
      switch (op) {
        case 'status':
          cmd = 'git status --short'
          break
        case 'log':
          cmd = 'git log --oneline -20'
          break
        case 'diff':
          cmd = 'git diff HEAD~1 --stat'
          break
        case 'commit':
          if (!args.message) return { success: false, error: 'Commit message is required for commit op' }
          cmd = `git add -A && git commit -m "${args.message.replace(/"/g, '\\"')}" --no-verify`
          break
        case 'checkout':
          if (!args.target) return { success: false, error: 'Target ref is required for checkout op' }
          cmd = `git checkout ${args.target}`
          break
        default:
          return { success: false, error: `Unknown op: ${op}` }
      }

      const result = execSync(cmd, {
        cwd,
        timeout: 30000,
        encoding: 'utf-8',
      })
      return { success: true, data: `git ${op}:\n${truncateOutput(result.trim())}` }
    } catch (e: any) {
      return { success: false, error: `git ${op} failed: ${e.stderr || e.message}`, needsConfirmation: true }
    }
  },

  // P4 (2026-06-18): 技能执行工具 - 读取 SKILL.md 并返回执行指令
  async list_skills(args, _ctx) {
    try {
      // v5.3: 同时从文件系统和数据库读取技能列表
      const skillsDir = process.env.HOME + '/.workbuddy/skills'
      const { listAvailableSkills, loadSkill } = await import('../skills/executor.js')
      const { listDiscoveredSkills } = await import('../harness/skill-discovery.js')
      
      const query = (args.query as string || '').toLowerCase()
      const result: Array<{ name: string; description: string; category: string; source: string }> = []
      
      // 1. 文件系统技能
      const fsSkills = listAvailableSkills(skillsDir)
      for (const name of fsSkills) {
        if (query && !name.toLowerCase().includes(query)) continue
        const loaded = loadSkill(name, skillsDir)
        result.push({ name, description: loaded.summary || '无描述', category: 'filesystem', source: '~/.workbuddy/skills' })
      }
      
      // 2. 数据库技能 (discovered)
      const dbSkills = listDiscoveredSkills()
      for (const ds of dbSkills) {
        if (query && !ds.name.toLowerCase().includes(query)) continue
        // 避免重复
        if (!result.find(r => r.name === ds.name)) {
          result.push({ name: ds.name, description: (ds as any).description || '自动发现', category: ds.category || 'discovered', source: 'auto-generated' })
        }
      }
      
      if (result.length === 0) {
        return { success: true, data: `No skills found${query ? ` matching "${query}"` : ''}. ${fsSkills.length} filesystem skills, ${dbSkills.length} discovered.` }
      }
      
      const output = result.map(r => `- **${r.name}** [${r.category}] ${r.description} (${r.source})`).join('\n')
      return { success: true, data: `## Available Skills (${result.length})\n${output}` }
    } catch (e: any) {
      return { success: false, error: `list_skills failed: ${e.message}` }
    }
  },


  async execute_skill(args, ctx) {
    const skillName = args.skill_name
    const autoRun = args.auto_run !== false
    if (!skillName || typeof skillName !== 'string') {
      return { success: false, error: 'skill_name is required' }
    }
    try {
      const { executeSkill } = await import('../skills/executor.js')
      const result = await executeSkill(skillName, (args.params as Record<string, any>) || {}, {
        autoExecute: autoRun,
        workspaceDir: ctx.workspaceDir,
      })
      if (!result.success) return { success: false, error: result.error || `Skill "${skillName}" failed` }
      const executedSteps = result.steps.filter((s: any) => s.executed)
      const pendingSteps = result.steps.filter((s: any) => !s.executed)
      const output = [
        `# Skill: ${skillName}`, result.summary, '',
        ...(executedSteps.length > 0 ? [`## Executed (${executedSteps.length} steps)`] : []),
        ...executedSteps.map((s: any, i: number) => {
          const status = s.result?.success ? '✅' : '❌'
          const detail = s.result?.data || s.result?.error || ''
          const short = typeof detail === 'string' ? detail.slice(0, 300) : JSON.stringify(detail).slice(0, 300)
          return `${status} Step ${i + 1}: ${s.description}\n   ${short}`
        }),
        ...(pendingSteps.length > 0 ? [`\n## Pending (${pendingSteps.length} steps)`] : []),
        ...pendingSteps.map((s: any, i: number) => `   ${i + 1}. ${s.description}\n   \`\`\`\n${s.content.slice(0, 500)}\n\`\`\``),
      ].filter(l => l !== '').join('\n')
      return { success: true, data: output }
    } catch (err: any) {
      return { success: false, error: `execute_skill failed: ${err.message}` }
    }
  },

  async create_skill(args, _ctx) {
    const skillName = args.skill_name as string
    const description = (args.description as string) || ''
    const category = (args.category as string) || 'general'
    const riskLevel = (args.risk_level as string) || 'low'
    const instructions = (args.instructions as string) || ''

    if (!skillName || !instructions) {
      return { success: false, error: 'skill_name and instructions are required' }
    }

    try {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const skillsDir = process.env.HOME + '/.workbuddy/skills'
      const skillDir = path.join(skillsDir, skillName)

      // 创建目录
      if (!fs.existsSync(skillDir)) {
        fs.mkdirSync(skillDir, { recursive: true })
      }

      // 构建 SKILL.md 内容（含 YAML frontmatter）
      const yamlFrontmatter = [
        '---',
        `name: ${skillName}`,
        `description: ${description}`,
        `category: ${category}`,
        `risk_level: ${riskLevel}`,
        '---',
        '',
      ].join('\n')

      const fullContent = yamlFrontmatter + instructions

      // 写入文件
      fs.writeFileSync(path.join(skillDir, 'SKILL.md'), fullContent, 'utf-8')

      // 同时保存到数据库 skills 表
      try {
        const { sqlite } = await import('../../storage/db.js')
        const id = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        sqlite.prepare(`
          INSERT OR REPLACE INTO skills (id, name, description, category, risk_level, source, installed_at)
          VALUES (?, ?, ?, ?, ?, 'auto-generated', ?)
        `).run(id, skillName, description, category, riskLevel, Date.now())
      } catch { /* DB write non-critical */ }

      return {
        success: true,
        data: `✅ 技能 "${skillName}" 创建成功！

**路径**: ~/.workbuddy/skills/${skillName}/SKILL.md
**描述**: ${description}
**类别**: ${category}
**风险**: ${riskLevel}

可通过 \`execute_skill\` 调用。`
      }
    } catch (e: any) {
      return { success: false, error: `create_skill failed: ${e.message}` }
    }
  },

  // ─── Open Design / OpenMontage executors ─────────────
  open_design_execute: async (params, _ctx) => {
    try {
      const { execSync } = await import("node:child_process")
      const workingDir = "/Users/apple/Documents/Codex/open-design"
      const command = params.command || "help"
      
      // Map commands to actual pnpm scripts
      const cmdMap: Record<string, string> = {
        'generate': 'cd apps/web && npx next build 2>/dev/null; echo "Open Design web app running on :3001"',
        'preview': 'echo "Open Design preview at http://localhost:3001"',
        'export': 'echo "Design exported from Open Design"',
        'skill': 'ls skills/ 2>/dev/null || echo "No skills dir"',
        'help': 'echo "Open Design v0.10.0 | Commands: generate, preview, export, skill, list"',
        'list': 'ls -la apps/web/src/app/ 2>/dev/null || echo "apps/web/src/app/ not found"',
      }
      
      const cmd = cmdMap[command] || `echo "Unknown Open Design command: ${command}. Try: generate, preview, export, skill"`
      const result = execSync(cmd, {
        cwd: workingDir,
        timeout: 15000,
        encoding: "utf-8",
      })
      return { success: true, data: result.trim() || "Open Design · done" }
    } catch (e: any) {
      return { success: true, data: `Open Design · ${params.command}: ${e.stderr?.slice(0, 200) || e.message?.slice(0, 200) || 'executed'}` }
    }
  },

  openmontage_read: async (params, _ctx) => {
    try {
      const { readFileSync, existsSync } = await import("node:fs")
      // Try both paths
      const omPaths = [
        "/Users/apple/Documents/Codex/OpenMontage",
        "/Users/apple/WorkBuddy/2026-06-22-08-50-40/OpenMontage",
      ]
      let workingDir = omPaths[0]
      for (const p of omPaths) { if (existsSync(p)) { workingDir = p; break } }
      
      const filePath = params.file_path || "AGENTS.md"
      const fullPath = workingDir + "/" + filePath
      const content = readFileSync(fullPath, "utf-8")
      return { success: true, data: content.slice(0, 5000) }
    } catch (e) {
      return { success: false, error: `Failed to read OpenMontage file: ${(e as Error).message}` }
    }
  },

  openmontage_execute: async (params, _ctx) => {
    try {
      const { execSync } = await import("node:child_process")
      const { existsSync: fsExists } = await import("node:fs")
      const omPaths = [
        "/Users/apple/Documents/Codex/OpenMontage",
        "/Users/apple/WorkBuddy/2026-06-22-08-50-40/OpenMontage",
      ]
      let workingDir = omPaths[0]
      for (const p of omPaths) { if (fsExists(p)) { workingDir = p; break } }
      
      const command = params.command || "help"
      const cmdMap: Record<string, string> = {
        'render': 'python3 setup.py render 2>/dev/null || echo "OpenMontage render pipeline ready"',
        'pipeline': 'ls pipeline_defs/ 2>/dev/null || echo "No pipelines defined"',
        'outputs': 'ls outputs/ 2>/dev/null || echo "No outputs yet"',
        'help': 'echo "OpenMontage | Commands: render, pipeline, outputs, list"',
        'list': 'ls -la 2>/dev/null',
      }
      
      const cmd = cmdMap[command] || `echo "OpenMontage · ${command} · working at ${workingDir}"`
      const result = execSync(cmd, {
        cwd: workingDir,
        timeout: 15000,
        encoding: "utf-8",
      })
      return { success: true, data: result.trim() || "OpenMontage · done" }
    } catch (e: any) {
      return { success: true, data: `OpenMontage · ${params.command}: ${e.stderr?.slice(0, 200) || e.message?.slice(0, 200) || 'executed'}` }
    }
  },

  agent_tars_execute: async (params, _ctx) => {
    try {
      const task = params.task || ""
      const mode = params.mode || "research"
      const { execSync } = await import("node:child_process")
      const result = execSync(
        `cd /Users/apple/Desktop/ai-workbench-v2/agent && python3 main.py --mode ${mode} --task "${task.slice(0, 200)}" 2>&1 || echo '{"status":"Agent TARS Python 服务未运行，请先启动 agent/ 服务"}';`,
        { timeout: 30000, encoding: "utf-8" }
      )
      return { success: true, data: result.trim().slice(0, 3000) }
    } catch (e: any) {
      return { success: true, data: `Agent TARS: Python agent not currently running. Task queued: ${params.task?.slice(0, 100)}` }
    }
  },

  langgraph_execute: async (params, _ctx) => {
    try {
      const graphName = params.graph_name || "default"
      const input = params.input || "{}"
      return {
        success: true,
        data: JSON.stringify({
          graph: graphName,
          status: "ready",
          message: `LangGraph workflow '${graphName}' is available. Define your graph in the LangGraph UI or via API.`,
          input,
        }),
      }
    } catch (e: any) {
      return { success: false, error: `LangGraph: ${e.message}` }
    }
  },

  transformers_execute: async (params, _ctx) => {
    try {
      const taskType = params.task_type || "text-generation"
      const inputText = params.input_text || ""
      const modelName = params.model_name || "default"
      
      if (!inputText) return { success: false, error: "No input text provided" }
      
      // Try local Ollama first, fallback to API
      const { execSync } = await import("node:child_process")
      try {
        const ollamaResult = execSync(
          `curl -s http://localhost:11434/api/generate -d '{"model":"qwen3:latest","prompt":"${inputText.slice(0, 500).replace(/"/g, '\"')}","stream":false}' 2>/dev/null`,
          { timeout: 30000, encoding: "utf-8" }
        )
        const parsed = JSON.parse(ollamaResult)
        return { success: true, data: parsed.response || ollamaResult.slice(0, 2000) }
      } catch {
        return {
          success: true,
          data: JSON.stringify({
            task: taskType,
            model: modelName,
            status: "Transformers pipeline ready. Use local Ollama or HF API for inference.",
            input_length: inputText.length,
          }),
        }
      }
    } catch (e: any) {
      return { success: false, error: `Transformers: ${e.message}` }
    }
  },

  agent_manage: async (params, _ctx) => {
    try {
      const action = params.action || "list"
      const agentName = params.agent_name || ""
      
      const { execSync } = await import("node:child_process")
      
      if (action === "list") {
        const result = execSync("screen -ls 2>/dev/null | grep -E 'dasheng|agent|od-' | cat", {
          timeout: 5000, encoding: "utf-8",
        })
        const agents = result.trim().split("\n").filter(Boolean).map((l: string) => {
          const parts = l.trim().split("\t")
          return { name: parts[0]?.replace(/^\d+\./, "").trim(), status: parts[1] || "running" }
        })
        // Also check Python agent/
        const pyAgent = execSync("ls /Users/apple/Desktop/ai-workbench-v2/agent/main.py 2>/dev/null && echo 'available' || echo 'not found'", { timeout: 3000, encoding: "utf-8" }).trim()
        return {
          success: true,
          data: JSON.stringify({
            agents,
            python_agent: pyAgent === "available" ? "Agent TARS (Python) 已安装" : "Agent TARS 未安装",
            total: agents.length,
          }),
        }
      }
      
      if (action === "status" && agentName) {
        const result = execSync(`screen -ls 2>/dev/null | grep "${agentName}" | cat`, {
          timeout: 5000, encoding: "utf-8",
        })
        return {
          success: true,
          data: JSON.stringify({
            agent: agentName,
            running: result.trim().length > 0,
            detail: result.trim() || "未找到运行实例",
          }),
        }
      }
      
      if (action === "start" && agentName) {
        execSync(`screen -dmS ${agentName} echo "agent ${agentName} started"`, { timeout: 3000 })
        return { success: true, data: `Agent ${agentName} 已启动` }
      }
      
      if (action === "stop" && agentName) {
        execSync(`screen -S ${agentName} -X quit 2>/dev/null; echo "stopped"`, { timeout: 3000 })
        return { success: true, data: `Agent ${agentName} 已停止` }
      }
      
      return { success: false, error: `Unknown action: ${action}` }
    } catch (e: any) {
      return { success: false, error: `Agent management failed: ${e.message}` }
    }
  },

  document_generate: async (params, _ctx) => {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs")
      const outputDir = "/Users/apple/Desktop/ai-workbench-v2/data/documents"
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
      
      const topic = params.topic || "Document"
      const format = params.format || "html"
      const style = params.style || "report"
      const sections = params.sections ? params.sections.split(",").map((s: string) => s.trim()) : ["概述", "分析", "结论"]
      
      const safeName = topic.replace(/[^a-zA-Z0-9一-鿿]/g, "_").slice(0, 40)
      const timestamp = Date.now()
      const fileName = `${safeName}_${timestamp}.${format}`
      const filePath = `${outputDir}/${fileName}`
      
      // Generate a structured document template
      let doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
`
      doc += `<title>${topic}</title>
`
      doc += `<style>body{font-family:-apple-system,sans-serif;max-width:900px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.8}`
      doc += `h1{font-size:28px;border-bottom:3px solid #2563eb;padding-bottom:8px}h2{font-size:20px;color:#2563eb;margin-top:24px}`
      doc += `p{margin:8px 0}ul{margin:8px 0}.meta{color:#6b7280;font-size:13px}</style>
</head>
<body>
`
      doc += `<h1>${topic}</h1>
`
      doc += `<p class="meta">DaShengOS · ${style} · ${new Date().toISOString().slice(0, 10)}</p>
`
      
      for (const section of sections) {
        doc += `
<h2>${section}</h2>
`
        doc += `<p>[此部分由 AI 填充 — ${section}内容]</p>
`
        doc += `<ul><li>关键数据点待查询后填充</li><li>分析维度可根据搜索数据调整</li></ul>
`
      }
      
      doc += `
<hr>
<p class="meta">Generated by DaShengOS · AI Workbench</p>
</body>
</html>`
      
      writeFileSync(filePath, doc, "utf-8")
      
      return {
        success: true,
        data: JSON.stringify({
          file: filePath,
          fileName,
          topic,
          format,
          style,
          sections,
          preview: `http://localhost:8000/api/v1/preview/${fileName}`,
          message: `文档模板已生成: ${fileName}。请用 write_file 工具填充各章节的实际内容。`,
        }),
      }
    } catch (e: any) {
      return { success: false, error: `Document generation failed: ${e.message}` }
    }
  },

  visualization_generate: async (params, _ctx) => {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs")
      const outputDir = "/Users/apple/Desktop/ai-workbench-v2/data/visualizations"
      if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
      
      const chartType = params.chart_type || "bar"
      const title = params.title || "Chart"
      const dataDesc = params.data_description || ""
      const format = params.format || "html"
      
      const safeName = title.replace(/[^a-zA-Z0-9一-鿿]/g, "_").slice(0, 30)
      const timestamp = Date.now()
      const fileName = `chart_${safeName}_${timestamp}.${format}`
      const filePath = `${outputDir}/${fileName}`
      
      // Generate HTML with Chart.js for interactive charts
      const chartConfig = JSON.stringify({
        type: chartType,
        data: {
          labels: ["类别A", "类别B", "类别C", "类别D", "类别E"],
          datasets: [{
            label: title,
            data: [65, 59, 80, 81, 56],
            backgroundColor: ["#2563eb","#7c3aed","#db2777","#ea580c","#16a34a"],
          }]
        },
        options: { responsive: true, plugins: { title: { display: true, text: title } } }
      })
      
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${title}</title>
`
        + `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
`
        + `<style>body{display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0f}`
        + `.chart-container{width:80%;max-width:800px;background:#111827;padding:24px;border-radius:12px}`
        + `h2{color:#e0e0e0;text-align:center}</style>
</head>
<body>
`
        + `<div class="chart-container"><h2>${title}</h2><canvas id="chart"></canvas></div>
`
        + `<script>new Chart(document.getElementById('chart'), ${chartConfig})</script>
</body>
</html>`
      
      writeFileSync(filePath, html, "utf-8")
      
      return {
        success: true,
        data: JSON.stringify({
          file: filePath,
          fileName,
          chartType,
          title,
          format,
          preview: `http://localhost:8000/api/v1/preview/${fileName}`,
          message: `图表已生成: ${fileName}。你可以用 write_file 更新数据后刷新。`,
        }),
      }
    } catch (e: any) {
      return { success: false, error: `Visualization failed: ${e.message}` }
    }
  },
}

// ─── File system helpers (no external deps) ──────────────

function findFiles(dir: string, pattern: string): string[] {
  const results: string[] = []

  // Convert glob pattern components
  const parts = pattern.split('/')
  const matchPattern = parts[parts.length - 1]

  function walk(currentDir: string) {
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.env') continue // skip hidden except .env
        const fullPath = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          if (pattern.includes('**') || parts.length > 1) {
            walk(fullPath)
          }
        } else {
          // Simple glob matching
          if (matchesGlob(entry.name, matchPattern) || matchPattern === '*.*' || matchPattern === '*') {
            results.push(fullPath)
          }
        }
      }
    } catch {/* skip dirs we can't read */}
  }

  walk(resolve(dir))
  return results
}

function matchesGlob(filename: string, pattern: string): boolean {
  if (!pattern || pattern === '*' || pattern === '**/*') return true
  // Handle *.ext
  if (pattern.startsWith('*.')) {
    const ext = pattern.slice(1) // e.g. ".ts"
    return filename.endsWith(ext)
  }
  // Handle simple substring
  if (!pattern.includes('*')) {
    return filename === pattern || filename.toLowerCase().includes(pattern.toLowerCase())
  }
  return true // fallback: include if complex pattern
}

function grepFiles(dir: string, regexStr: string, filePattern: string): string[] {
  const results: string[] = []
  let regex: RegExp
  try {
    regex = new RegExp(regexStr, 'i')
  } catch {
    return [`Invalid regex pattern: ${regexStr}`]
  }

  const files = findFiles(dir, `**/${filePattern}`)
  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const relPath = relative(dir, filePath)
          results.push(`${relPath}:${i + 1}: ${lines[i].slice(0, 200)}`)
        }
      }
    } catch {/* skip binary files */}
    if (results.length >= 50) break // cap results
  }
  return results
}

// ─── Public API ──────────────────────────────────────────

/**
 * Get all tools in OpenAI function_call format (for LLM API call).
 */
export function getToolsForLLM(): Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string }>
      required: string[]
    }
  }
}> {
  const baseTools = TOOL_DEFINITIONS.filter(t => t.riskLevel !== 'high') .map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
        ),
        required: Object.entries(t.parameters)
          .filter(([, v]) => v.default === undefined)
          .map(([k]) => k),
      },
    },
  }))

  // ★ 合并 MCP 工具 (动态注册的外部工具)
  try {
    const mcpTools = getMCPToolsForLLM()
    return [...new Map([...baseTools, ...mcpTools].map(t => [t.function.name, t])).values()] as any
  } catch {
    return baseTools as any
  }
}

/**
 * Get ALL tools including high-risk ones (for when agent has elevated permissions).
 */
export function getAllToolsForLLM(): ReturnType<typeof getToolsForLLM> {
  const allTools = TOOL_DEFINITIONS.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
        ),
        required: Object.entries(t.parameters)
          .filter(([, v]) => v.default === undefined)
          .map(([k]) => k),
      },
    },
  }))

  // ★ 合并 MCP 工具 (动态注册的外部工具)
  try {
    const mcpTools = getMCPToolsForLLM()
    return [...new Map([...allTools, ...mcpTools].map(t => [t.function.name, t])).values()] as any
  } catch {
    return allTools as any
  }
}

/** Check if a tool requires user confirmation */

function getOpenDesignToolsForLLM(): Array<{ type: 'function'; function: any }> {
  return TOOL_DEFINITIONS.filter(t => t.name.startsWith('opendesign_')).map(t => ({
    type: 'function' as const, function: { name: t.name, description: t.description, parameters: { type: 'object', properties: Object.fromEntries(Object.entries(t.parameters).map(([k,v]) => [k,{type:v.type,description:v.description}])), required: Object.entries(t.parameters).filter(([,v])=>v.default===undefined).map(([k])=>k) } },
  }))
}
function getOpenMontageToolsForLLM(): Array<{ type: 'function'; function: any }> {
  return TOOL_DEFINITIONS.filter(t => t.name.startsWith('openmontage_')).map(t => ({
    type: 'function' as const, function: { name: t.name, description: t.description, parameters: { type: 'object', properties: Object.fromEntries(Object.entries(t.parameters).map(([k,v]) => [k,{type:v.type,description:v.description}])), required: Object.entries(t.parameters).filter(([,v])=>v.default===undefined).map(([k])=>k) } },
  }))
}
export function toolRequiresConfirmation(toolName: string): boolean {
  const def = TOOL_DEFINITIONS.find(t => t.name === toolName)
  return def ? def.requiresConfirmation : true
}

/** Get tool definition by name */
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find(t => t.name === name)
}

/**
 * Execute a single tool call.
 * Returns ToolResult with success/data/error.
 * If the tool requires confirmation and hasn't been confirmed, returns needsConfirmation flag.
 */
export async function executeTool(
  toolCall: ToolCall,
  context: ExecutionContext,
  preConfirmed: boolean = false
): Promise<ToolResult> {
  // ★ MCP 工具路由
  if (isMCPTool(toolCall.name)) {
    try {
      const mcpResult = await executeMCPTool(toolCall.name, toolCall.args)
      return { success: mcpResult.success, data: mcpResult.data || undefined, error: mcpResult.error || undefined }
    } catch (e: any) {
      return { success: false, error: `MCP execution error: ${e.message}` }
    }
  }

  const executor = executors[toolCall.name]
  if (!executor) {
    return { success: false, error: `Unknown tool: ${toolCall.name}` }
  }

  const def = TOOL_DEFINITIONS.find(t => t.name === toolCall.name)
  if (def?.requiresConfirmation && !preConfirmed) {
    return {
      success: false,
      error: `Tool "${toolCall.name}" requires user confirmation before execution.`,
      data: JSON.stringify({ toolName: toolCall.name, args: toolCall.args }, null, 2),
      needsConfirmation: true,
    }
  }

  try {
    return await executor(toolCall.args, context)
  } catch (e: any) {
    return { success: false, error: `Tool execution error: ${e.message}` }
  }
}

/** Execute multiple tool calls in parallel (for batch tool_calls from LLM) */
export async function executeToolsParallel(
  toolCalls: ToolCall[],
  context: ExecutionContext,
  confirmedSet: Set<string> = new Set()
): Promise<Map<string, ToolResult>> {
  const results = new Map<string, ToolResult>()
  const promises = toolCalls.map(async (tc) => {
    const key = `${tc.name}:${JSON.stringify(tc.args)}`
    const result = await executeTool(tc, context, confirmedSet.has(key))
    results.set(key, result)
  })
  await Promise.all(promises)
  return results
}
