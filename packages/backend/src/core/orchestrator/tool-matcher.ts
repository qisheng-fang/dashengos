// tool-matcher.ts — DaShengOS v7.0 动态工具/技能匹配器
// 在意图理解后、Agent 调度前，自动匹配可用工具和技能
// 覆盖: 30 核心工具 + 89 MCP 工具 + 199 Skills + 217 Agency Agents

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadAgentRegistry, routeIntent, type AgentDef } from './agent-registry.js'
import { getToolRankings } from './self-evolver.js'

// ─── Types ─────────────────────────────────────────────

export interface MatchedTool {
  name: string
  description: string
  source: 'core' | 'mcp' | 'skill' | 'agent'
  serverId?: string      // for MCP tools
  skillPath?: string      // for skills
  confidence: number
  parameters?: Record<string, any>
}

export interface ToolMatchResult {
  tools: MatchedTool[]
  toolDefs: any[]          // OpenAI function calling format
  skills: MatchedTool[]    // skills to preload
  agents: AgentDef[]       // agency agents to dispatch
  skillPrompts: string     // combined skill system prompts
  summary: string          // human-readable summary
}

// ─── Intent → Tool Mapping Rules ──────────────────────

interface ToolRule {
  keywords: string[]
  tools: Array<{
    name: string
    source: 'core' | 'mcp' | 'skill'
    serverId?: string
  }>
}

const TOOL_RULES: ToolRule[] = [
  // 搜索/调研类
  { keywords: ['搜索','查找','查询','调研','报告','分析','数据','市场','行业','趋势','最新','news','search','research','report','github','开源','open source','repo','repository','项目','project','推荐','recommend'], tools: [
    { name: 'web_search', source: 'core' },
    { name: 'github_search', source: 'core' },
    { name: 'web_fetch', source: 'core' },
    { name: 'web_fetch_url', source: 'core' },
    { name: 'execute_skill', source: 'core' },
  ]},
  // 文件读写类
  { keywords: ['文件','读写','编辑','修改','创建','写入','保存','生成','输出','write','edit','create','save'], tools: [
    { name: 'read_file', source: 'core' },
    { name: 'write_file', source: 'core' },
    { name: 'edit_file', source: 'core' },
    { name: 'list_files', source: 'core' },
  ]},
  // 代码/开发类
  { keywords: ['代码','code','编程','开发','debug','修复','fix','bug','函数','class','组件','重构','优化'], tools: [
    { name: 'read_file', source: 'core' },
    { name: 'write_file', source: 'core' },
    { name: 'edit_file', source: 'core' },
    { name: 'search_content', source: 'core' },
    { name: 'run_command', source: 'core' },
  ]},
  // 命令执行类
  { keywords: ['运行','执行','安装','启动','停止','重启','部署','构建','命令','终端','shell','bash','zsh','pwd','ls','grep','find','cat','npm','git','node','python','pip','brew','docker','curl','wget','build','run','start','stop','install','deploy'], tools: [
    { name: 'run_command', source: 'core' },
    { name: 'install_package', source: 'core' },
    { name: 'restart_service', source: 'core' },
    { name: 'git_op', source: 'core' },
  ]},
  // 进程/端口检查
  { keywords: ['进程','端口','状态','检查','监控','是否运行','health','status','check','monitor'], tools: [
    { name: 'check_process', source: 'core' },
    { name: 'check_port', source: 'core' },
    { name: 'read_logs', source: 'core' },
  ]},
  // 数据库
  { keywords: ['数据库','database','SQL','查询','query','表','table','schema','迁移','migration'], tools: [
    { name: 'db_query', source: 'core' },
    { name: 'read_file', source: 'core' },
  ]},
  // 设计/图像
  { keywords: ['设计','画','海报','banner','logo','图像','图片','生成图','illustration','design','draw'], tools: [
    { name: 'open_design_execute', source: 'core' },
    { name: 'opendesign_generate', source: 'core' },
    { name: 'opendesign_status', source: 'core' },
    { name: 'write_file', source: 'core' },
  ]},
  // 视频
  { keywords: ['视频','video','剪辑','montage','渲染','render','动画','animation'], tools: [
    { name: 'openmontage_execute', source: 'core' },
    { name: 'openmontage_read', source: 'core' },
    { name: 'openmontage_list', source: 'core' },
    { name: 'write_file', source: 'core' },
  ]},
  // 安全审计
  { keywords: ['安全','security','漏洞','vulnerability','审计','audit','渗透','penetration','合规','compliance','扫描','scan'], tools: [
    { name: 'read_file', source: 'core' },
    { name: 'search_content', source: 'core' },
    { name: 'run_command', source: 'core' },
    // MCP Codex Security tools would be matched automatically
  ]},
  // 浏览器自动化
  { keywords: ['浏览器','browser','网页','截图','screenshot','爬虫','scrape','playwright','测试页面','自动化测试'], tools: [
    { name: 'web_fetch', source: 'core' },
    // MCP Playwright tools would be matched automatically
  ]},
  // iOS/macOS 构建
  { keywords: ['iOS','macOS','Xcode','Swift','构建IPA','打包','archive','证书','provisioning','appstore'], tools: [
    { name: 'run_command', source: 'core' },
    // MCP Xcode Build tools would be matched automatically
  ]},
  // Agent TARS
  { keywords: ['agent tars','tars','自动化代理','自主代理','autonomous agent'], tools: [
    { name: 'agent_tars_execute', source: 'core' },
    { name: 'execute_skill', source: 'core' },
  ]},
]

// MCP server ↔ keyword mapping for automatic matching
const MCP_SERVER_KEYWORDS: Record<string, string[]> = {
  mcp_codex_security: ['安全','security','漏洞','审计','扫描','合规','攻击','渗透','威胁','加密','auth','vulnerability'],
  mcp_playwright: ['浏览器','browser','网页','截图','自动化','测试','UI测试','e2e','playwright','爬虫'],
  mcp_agnes_ai: ['图像生成','图片','绘画','image','generate image','视频生成'],
  mcp_xcodebuild: ['iOS','Xcode','Swift','构建','build','打包','archive','证书','模拟器','simulator'],
}

// ─── Skill discovery ───────────────────────────────────

const SKILL_ROOTS = [
  join(process.env.HOME || '/Users/apple', '.workbuddy', 'skills'),
  join(process.env.HOME || '/Users/apple', '.agents', 'skills'),
]

function discoverSkills(): Map<string, { path: string; prompt: string; name: string; description: string }> {
  const skills = new Map<string, { path: string; prompt: string; name: string; description: string }>()
  for (const root of SKILL_ROOTS) {
    if (!existsSync(root)) continue
    try {
      for (const dir of readdirSync(root)) {
        const skillMd = join(root, dir, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        try {
          const content = readFileSync(skillMd, 'utf-8')
          const nameMatch = content.match(/^name:\s*(.+)$/m)
          const descMatch = content.match(/^description:\s*(.+)$/m)
          if (nameMatch) {
            skills.set(dir, {
              path: skillMd,
              prompt: content.slice(0, 2000),
              name: nameMatch[1].trim(),
              description: descMatch?.[1]?.trim() || '',
            })
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return skills
}

// ─── Main Matcher ──────────────────────────────────────

export function matchToolsForIntent(
  message: string,
  taskType: string,
): ToolMatchResult {
  const msg = message.toLowerCase()
  const result: ToolMatchResult = {
    tools: [],
    toolDefs: [],
    skills: [],
    agents: [],
    skillPrompts: '',
    summary: '',
  }

  // 1. Core tools — keyword matching
  const matchedCore = new Set<string>()
  for (const rule of TOOL_RULES) {
    let score = 0
    for (const kw of rule.keywords) {
      if (msg.includes(kw.toLowerCase())) score += kw.length
    }
    if (score > 0) {
      for (const tool of rule.tools) {
        if (tool.source === 'core' && !matchedCore.has(tool.name)) {
          matchedCore.add(tool.name)
          result.tools.push({
            name: tool.name, description: `Core tool: ${tool.name}`,
            source: 'core', confidence: Math.min(score / 20, 1),
          })
        }
      }
    }
  }

  // Ensure minimum tools based on task type
  if (taskType === 'HTML' || taskType === 'REPORT') {
    addIfMissing(result, matchedCore, 'web_search', 'core')
    addIfMissing(result, matchedCore, 'write_file', 'core')
  }
  if (taskType === 'CODE_FIX') {
    addIfMissing(result, matchedCore, 'read_file', 'core')
    addIfMissing(result, matchedCore, 'write_file', 'core')
    addIfMissing(result, matchedCore, 'edit_file', 'core')
    addIfMissing(result, matchedCore, 'search_content', 'core')
    addIfMissing(result, matchedCore, 'run_command', 'core')
  }
  if (taskType === 'GENERAL' || taskType === 'QUESTION') {
    // Minimal tools for simple Q&A
  }

  // 2. MCP tools — automatic matching based on keywords
  for (const [serverId, keywords] of Object.entries(MCP_SERVER_KEYWORDS)) {
    let mcpScore = 0
    for (const kw of keywords) {
      if (msg.includes(kw.toLowerCase())) mcpScore += kw.length
    }
    if (mcpScore > 0) {
      result.tools.push({
        name: serverId,
        description: `MCP server: ${serverId}`,
        source: 'mcp',
        serverId,
        confidence: Math.min(mcpScore / 15, 1),
      })
    }
  }

  // 3. Skills — match by name/description
  const skills = discoverSkills()
  for (const [skillDir, skill] of skills) {
    const skillText = `${skill.name} ${skill.description}`.toLowerCase()
    let skillScore = 0
    for (const word of msg.split(/\s+/)) {
      if (skillText.includes(word.toLowerCase())) skillScore += word.length
    }
    if (skillScore > 3 || taskType === 'REPORT' && skillText.includes('report')) {
      result.skills.push({
        name: skill.name, description: skill.description,
        source: 'skill', skillPath: skill.path,
        confidence: Math.min(skillScore / 30, 1),
      })
    }
  }

  // 4. Agency Agents — route intent
  const agentRoute = routeIntent(message)
  if (agentRoute.matched && agentRoute.primaryAgent) {
    result.agents.push(agentRoute.primaryAgent)
    if (agentRoute.chainAgents.length > 1) {
      for (let i = 1; i < agentRoute.chainAgents.length; i++) {
        result.agents.push(agentRoute.chainAgents[i])
      }
    }
    result.tools.push({
      name: `agent:${agentRoute.primaryAgent.slug}`,
      description: `Agency Agent: ${agentRoute.primaryAgent.name} (${agentRoute.divisionLabel}) [${agentRoute.mode}]`,
      source: 'agent',
      confidence: agentRoute.confidence,
    })
  }

  // 5. Build OpenAI function calling definitions
  result.toolDefs = buildToolDefinitions(result.tools)

  // 6. Build skill prompts (inject into system prompt)
  if (result.skills.length > 0) {
    result.skillPrompts = result.skills
      .slice(0, 3)
      .map(s => `[SKILL: ${s.name}] ${s.description}`)
      .join('\n')
    if (result.skillPrompts) {
      result.skillPrompts = '\n## Available Skills\n' + result.skillPrompts
    }
  }

  // 6b. Boost confidence based on evolution ranking data
  try {
    const rankings = getToolRankings()
    for (const tool of result.tools) {
      const rank = rankings.tools.find(r => r.name === tool.name)
      if (rank && rank.successRate > 0.7 && rank.uses >= 5) {
        tool.confidence = Math.min(1, tool.confidence + 0.15)
        tool.description += ` [⭐${rank.uses}次使用,${(rank.successRate*100).toFixed(0)}%成功率]`
      }
    }
    // Boost agent confidence
    for (const tool of result.tools) {
      if (tool.source === 'agent') {
        const agentSlug = tool.name.replace('agent:', '')
        const rank = rankings.agents.find(r => r.name === agentSlug)
        if (rank && rank.successRate > 0.7 && rank.uses >= 3) {
          tool.confidence = Math.min(1, tool.confidence + 0.2)
          tool.description += ` [🏆已验证]`
        }
      }
    }
  } catch { /* rankings unavailable — skip */ }

  // 7. Summary
  const parts: string[] = []
  const coreCount = result.tools.filter(t => t.source === 'core').length
  const mcpCount = result.tools.filter(t => t.source === 'mcp').length
  const skillCount = result.skills.length
  const agentCount = result.agents.length
  if (coreCount > 0) parts.push(`${coreCount} 核心工具`)
  if (mcpCount > 0) parts.push(`${mcpCount} MCP`)
  if (skillCount > 0) parts.push(`${skillCount} 技能`)
  if (agentCount > 0) parts.push(`${agentCount} Agent`)
  result.summary = parts.join(' + ') || '基础工具'

  return result
}

// ─── Helpers ───────────────────────────────────────────

function addIfMissing(result: ToolMatchResult, set: Set<string>, name: string, source: 'core' | 'mcp') {
  if (!set.has(name)) {
    set.add(name)
    result.tools.push({ name, description: `${source} tool: ${name}`, source, confidence: 1 })
  }
}

function buildToolDefinitions(tools: MatchedTool[]): any[] {
  const defs: any[] = []

  // Core tool definitions (simplified for LLM function calling)
  const coreToolDefs: Record<string, any> = {
    web_search: {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current information, news, data, and facts',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query'],
        },
      },
    },
    web_fetch: {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch and read content from a URL',
        parameters: {
          type: 'object',
          properties: { url: { type: 'string', description: 'URL to fetch' } },
          required: ['url'],
        },
      },
    },
    write_file: {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Write content to a file',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'File content' },
          },
          required: ['path', 'content'],
        },
      },
    },
    read_file: {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file from the filesystem',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'File path to read' } },
          required: ['path'],
        },
      },
    },
    edit_file: {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit a file by replacing old_string with new_string',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
            old_string: { type: 'string', description: 'Text to replace' },
            new_string: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    list_files: {
      type: 'function',
      function: {
        name: 'list_files',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Directory path' } },
          required: ['path'],
        },
      },
    },
    search_content: {
      type: 'function',
      function: {
        name: 'search_content',
        description: 'Search for text pattern in files',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string', description: 'Directory to search in' },
          },
          required: ['pattern'],
        },
      },
    },
    run_command: {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Execute a shell command',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell command to run' } },
          required: ['command'],
        },
      },
    },
    install_package: {
      type: 'function',
      function: {
        name: 'install_package',
        description: 'Install a package via npm/pip/brew',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Package name' },
            manager: { type: 'string', description: 'npm/pip/brew' },
          },
          required: ['name'],
        },
      },
    },
    git_op: {
      type: 'function',
      function: {
        name: 'git_op',
        description: 'Execute a git operation (status, log, diff, branch, etc.)',
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', description: 'Git operation: status, log, diff, branch, add, commit, push' },
            path: { type: 'string', description: 'Repository path' },
          },
          required: ['operation'],
        },
      },
    },
    execute_skill: {
      type: 'function',
      function: {
        name: 'execute_skill',
        description: 'Execute an installed skill by name',
        parameters: {
          type: 'object',
          properties: {
            skill_name: { type: 'string', description: 'Skill name to execute' },
            args: { type: 'object', description: 'Arguments for the skill' },
          },
          required: ['skill_name'],
        },
      },
    },
    db_query: {
      type: 'function',
      function: {
        name: 'db_query',
        description: 'Execute a database query',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'SQL query' } },
          required: ['query'],
        },
      },
    },
    check_process: {
      type: 'function', function: { name: 'check_process', description: 'Check if a process is running', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    },
    check_port: {
      type: 'function', function: { name: 'check_port', description: 'Check if a port is in use', parameters: { type: 'object', properties: { port: { type: 'number' } }, required: ['port'] } },
    },
    read_logs: {
      type: 'function', function: { name: 'read_logs', description: 'Read application logs', parameters: { type: 'object', properties: { lines: { type: 'number' } } } },
    },
    restart_service: {
      type: 'function', function: { name: 'restart_service', description: 'Restart a service', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
    },
    open_design_execute: {
      type: 'function', function: { name: 'open_design_execute', description: 'Execute Open Design for image generation', parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } },
    },
    openmontage_execute: {
      type: 'function', function: { name: 'openmontage_execute', description: 'Execute OpenMontage for video generation', parameters: { type: 'object', properties: { config: { type: 'string' } }, required: ['config'] } },
    },
    agent_tars_execute: {
      type: 'function', function: { name: 'agent_tars_execute', description: 'Execute Agent TARS autonomous task', parameters: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
    },
  }

  for (const tool of tools) {
    if (tool.source === 'core' && coreToolDefs[tool.name]) {
      defs.push(coreToolDefs[tool.name])
    }
    // MCP tools are registered separately via mcp-client, not added as function defs here
    // Skills are injected as system prompt context, not function defs
    // Agents are dispatched via specialistPhase
  }

  return defs
}

// ─── Export ────────────────────────────────────────────
export { TOOL_RULES, MCP_SERVER_KEYWORDS, discoverSkills }
