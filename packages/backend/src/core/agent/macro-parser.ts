// packages/backend/src/core/agent/macro-parser.ts
// DaShengOS / OMNI-BRAIN OS — 暗号宏解析器
// 2026-06-21 · Ghost / Deep Dive / Halt & Catch Fire 特权模式

// ─── Types ─────────────────────────────────────────────────

export type MacroMode = 'ghost' | 'deep_dive' | 'halt'

export interface ParsedMacros {
  /** 激活暗号，未检测到则为 null */
  mode: MacroMode | null
  /** 清除暗号标记后的干净消息 */
  cleanMessage: string
  /** 注入到 system prompt 的特权指令 */
  systemPromptInjection: string
  /** 循环行为覆盖 */
  loopOverrides: {
    maxIterations?: number
    haltImmediately?: boolean
    stripResponse?: boolean   // Ghost: 剥离非代码内容
  }
}

// ─── 正则模式 ─────────────────────────────────────────────

const GHOST_RE = /\[Mode:\s*Ghost\]|Mode:\s*Ghost/gi
const DEEP_DIVE_RE = /\[Deep\s*Dive\]|Deep\s*Dive/gi
const HALT_RE = /\[Halt\s*&\s*Catch\s*Fire\]|Halt\s*&\s*Catch\s*Fire/gi

// ─── 暗号系统提示词注入 ───────────────────────────────────

const GHOST_INJECTION = `
╔═══════════════════════════════════════════════════════════╗
║ [暗号激活: GHOST MODE — 幽灵/静默黑客模式]              ║
╚═══════════════════════════════════════════════════════════╝
你已进入幽灵模式。绝对法则:
1. 输出物只有: 代码块 / CLI 命令 / 工具执行结果
2. 严禁任何解释、总结、寒暄、过渡语
3. 每一个不是代码/命令的字符都是浪费
4. 如果必须回应，只输出最终交付物 (代码/脚本/命令输出)
5. 禁止 "我来帮你" "这是方案" "让我解释" 等任何废话
6. 就像黑客终端 — 只有输入和输出，没有人际交互层
7. Anti-Yapping 强度: MAX`

const DEEP_DIVE_INJECTION = `
╔═══════════════════════════════════════════════════════════╗
║ [暗号激活: DEEP DIVE — 深潜/最强算力模式]               ║
╚═══════════════════════════════════════════════════════════╝
你已进入深潜模式。算力全开。绝对法则:
1. 使用所有可用工具 — web_search, db_query, web_fetch, read_file 等并行调用
2. 交叉验证多个数据源，每条论断必须有出处
3. 输出结构: 背景 → 数据全景 → 深度分析 → 结论 → 可执行行动项 → 风险矩阵
4. 不放过任何疑点，不依赖任何未经验证的假设
5. 这是处理复杂商业情报/竞品分析/基建诊断的终极模式
6. 长度不限 — 完整降维报告，宁可多写不可漏掉关键信息
7. 如遇知识缺口 → 立即搜索补全 → 继续深挖`

const HALT_INJECTION = `
╔═══════════════════════════════════════════════════════════╗
║ [暗号激活: HALT & CATCH FIRE — 紧急制动]                ║
╚═══════════════════════════════════════════════════════════╝
紧急制动已触发。你已收到终止指令:
1. 立即中止所有正在执行的任务
2. 不要做任何额外操作
3. 只回复: "■ 紧急制动已激活。所有任务已中止。系统待命中。"`

// ─── 解析函数 ─────────────────────────────────────────────

/**
 * 从用户消息中解析暗号宏。
 * 优先级: Halt > Ghost > Deep Dive (Halt 最紧急)
 */
export function parseMacros(message: string): ParsedMacros {
  let cleanMessage = message
  let mode: MacroMode | null = null
  let systemPromptInjection = ''
  const loopOverrides: ParsedMacros['loopOverrides'] = {}

  // 检测 Halt (最高优先级 — 紧急制动)
  if (HALT_RE.test(message)) {
    mode = 'halt'
    cleanMessage = cleanMessage.replace(HALT_RE, '').replace(/\[|\]/g, '').trim()
    systemPromptInjection = HALT_INJECTION
    loopOverrides.haltImmediately = true
    loopOverrides.maxIterations = 1
    return { mode, cleanMessage: cleanMessage || 'halt', systemPromptInjection, loopOverrides }
  }

  // 检测 Deep Dive (第二优先级 — 在 Ghost 之前，因为 Deep Dive 更消耗资源)
  if (DEEP_DIVE_RE.test(message)) {
    mode = 'deep_dive'
    cleanMessage = cleanMessage.replace(DEEP_DIVE_RE, '').replace(/\[|\]/g, '').trim()
    systemPromptInjection = DEEP_DIVE_INJECTION
    loopOverrides.maxIterations = 50 // 给更多迭代次数
    return { mode, cleanMessage: cleanMessage || message, systemPromptInjection, loopOverrides }
  }

  // 检测 Ghost
  if (GHOST_RE.test(message)) {
    mode = 'ghost'
    cleanMessage = cleanMessage.replace(GHOST_RE, '').replace(/\[|\]/g, '').trim()
    systemPromptInjection = GHOST_INJECTION
    loopOverrides.stripResponse = true
    return { mode, cleanMessage: cleanMessage || message, systemPromptInjection, loopOverrides }
  }

  // 未检测到暗号
  return { mode: null, cleanMessage: message, systemPromptInjection: '', loopOverrides: {} }
}

/**
 * 检查消息历史中是否有未解除的暗号 (用于多轮对话暗号持久化)
 * 返回最近一个暗号及其注入，若无返回 null
 */
export function detectActiveMacro(
  history: Array<{ role: string; content: string }>,
): ParsedMacros | null {
  // 倒序检查最近 5 条用户消息
  const recentUserMessages = history
    .filter(h => h.role === 'user')
    .slice(-5)
    .map(h => h.content)

  for (let i = recentUserMessages.length - 1; i >= 0; i--) {
    const parsed = parseMacros(recentUserMessages[i])
    if (parsed.mode) {
      // 如果是 Halt，只在当前轮次生效
      if (parsed.mode === 'halt') return null
      return parsed
    }
  }

  return null
}

/**
 * Ghost 模式响应过滤: 只保留代码块、CLI 命令、工具结果
 */
export function stripGhostResponse(response: string): string {
  const lines = response.split('\n')
  const result: string[] = []
  let inCodeBlock = false

  for (const line of lines) {
    // 代码块边界
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      result.push(line)
      continue
    }

    // 代码块内 — 保留
    if (inCodeBlock) {
      result.push(line)
      continue
    }

    // CLI 命令 (以 $ 或 > 开头)
    if (/^\s*[$>]\s/.test(line)) {
      result.push(line)
      continue
    }

    // 纯代码行 (以缩进开头 + 包含代码特征)
    if (/^\s{2,}[a-zA-Z]/.test(line) && /[{}=;()[\]]/.test(line)) {
      result.push(line)
      continue
    }

    // 工具结果标识
    if (/^(✓|✗|\[.*\]|📁|🔧|⚙️)/.test(line.trim())) {
      result.push(line)
      continue
    }

    // 跳过其他内容 (解释性文字)
  }

  const filtered = result.join('\n').trim()
  return filtered || response // 如果过滤后为空，返回原文防止空白回复
}
