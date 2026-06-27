// DaShengOS v6.2 — Cross-Model Tool Format Adapter
// 将内部 OpenAI 格式的工具定义和响应转换为各 Provider 原生格式
// 支持: OpenAI, Anthropic, Google Gemini, 以及所有 OpenAI 兼容 providers
//
// 设计原则:
//   内部格式 = OpenAI function-calling (业界事实标准)
//   每个 provider 负责: 1) 转换工具定义  2) 解析工具响应
//   如果 provider 不做转换 → 默认透传 (OpenAI 兼容)

import type { ChatRequest, ChatResponse } from './base.js'

// ── 内部工具定义 (OpenAI 格式) ─────────────────────────

export interface InternalToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, any>
  }
}

// ── 规范化工具调用响应 ──────────────────────────────────

export interface NormalizedToolCall {
  id: string
  type: string
  function: {
    name: string
    arguments: string
  }
}

export interface NormalizedChatResponse {
  content: string
  tool_calls: NormalizedToolCall[]
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string
}

// ── Provider 工具适配器接口 ──────────────────────────────

export interface ToolFormatAdapter {
  /** 提供商名称 */
  provider: string

  /** 转换工具定义为 Provider 原生格式 */
  convertTools: (tools: InternalToolDef[]) => any[]

  /** 从 Provider 原始响应中提取规范化的工具调用 */
  parseToolCalls: (rawResponse: any) => NormalizedToolCall[]

  /** 从 Provider 原始响应中提取文本内容 */
  parseContent: (rawResponse: any) => string

  /** 解析 usage */
  parseUsage: (rawResponse: any) => { prompt_tokens: number; completion_tokens: number; total_tokens: number }

  /** 解析 finish_reason */
  parseFinishReason: (rawResponse: any) => string

  /** 解析 model */
  parseModel: (rawResponse: any) => string
}

// ── OpenAI 适配器 (默认/基准) ────────────────────────────

const openaiAdapter: ToolFormatAdapter = {
  provider: 'openai',
  convertTools: (tools) => tools,  // 原生格式, 透传
  parseToolCalls: (d) => d.choices?.[0]?.message?.tool_calls || [],
  parseContent: (d) => d.choices?.[0]?.message?.content || '',
  parseUsage: (d) => d.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  parseFinishReason: (d) => d.choices?.[0]?.finish_reason || 'stop',
  parseModel: (d) => d.model || 'unknown',
}

// ── Anthropic 适配器 ─────────────────────────────────────

const anthropicAdapter: ToolFormatAdapter = {
  provider: 'anthropic',

  // OpenAI { type:'function', function: { name, description, parameters } }
  // → Anthropic { name, description, input_schema }
  convertTools: (tools) =>
    tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    })),

  // Anthropic content blocks → 规范化 tool_calls
  parseToolCalls: (d) => {
    const blocks = d.content || []
    return blocks
      .filter((b: any) => b.type === 'tool_use')
      .map((b: any, i: number) => ({
        id: b.id || `anthropic_tc_${i}`,
        type: 'function',
        function: {
          name: b.name || '',
          arguments: JSON.stringify(b.input || {}),
        },
      }))
  },

  parseContent: (d) => {
    const blocks = d.content || []
    const textBlocks = blocks.filter((b: any) => b.type === 'text')
    return textBlocks.map((b: any) => b.text).join('\n')
  },

  parseUsage: (d) => ({
    prompt_tokens: d.usage?.input_tokens || 0,
    completion_tokens: d.usage?.output_tokens || 0,
    total_tokens: (d.usage?.input_tokens || 0) + (d.usage?.output_tokens || 0),
  }),

  parseFinishReason: (d) => {
    const reason = d.stop_reason || 'stop'
    // Anthropic: 'end_turn', 'max_tokens', 'stop_sequence', 'tool_use'
    if (reason === 'tool_use') return 'tool_calls'
    return reason === 'end_turn' ? 'stop' : reason
  },

  parseModel: (d) => d.model || 'claude',
}

// ── Google Gemini 适配器 ────────────────────────────────

const googleAdapter: ToolFormatAdapter = {
  provider: 'google',

  convertTools: (tools) =>
    tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),

  parseToolCalls: (d) => {
    const candidates = d.candidates || []
    const parts = candidates[0]?.content?.parts || []
    return parts
      .filter((p: any) => p.functionCall)
      .map((p: any, i: number) => ({
        id: `gemini_tc_${i}`,
        type: 'function',
        function: {
          name: p.functionCall.name || '',
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      }))
  },

  parseContent: (d) => {
    const candidates = d.candidates || []
    const parts = candidates[0]?.content?.parts || []
    return parts
      .filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join('\n')
  },

  parseUsage: (d) => ({
    prompt_tokens: d.usageMetadata?.promptTokenCount || 0,
    completion_tokens: d.usageMetadata?.candidatesTokenCount || 0,
    total_tokens: d.usageMetadata?.totalTokenCount || 0,
  }),

  parseFinishReason: (d) => {
    const reason = d.candidates?.[0]?.finishReason || 'STOP'
    if (reason === 'TOOL_CALLS') return 'tool_calls'
    return reason === 'STOP' ? 'stop' : reason.toLowerCase()
  },

  parseModel: (d) => d.modelVersion || 'gemini',
}

// ── 适配器注册表 ─────────────────────────────────────────

const ADAPTERS: Record<string, ToolFormatAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  google: googleAdapter,
  // 以下 provider 为 OpenAI 兼容, 使用 openai adapter
  deepseek: openaiAdapter,
  siliconflow: openaiAdapter,
  groq: openaiAdapter,
  mistral: openaiAdapter,
  together: openaiAdapter,
  perplexity: openaiAdapter,
  openrouter: openaiAdapter,
  ollama: openaiAdapter,
  llamacpp: openaiAdapter,
  agnes_ai: openaiAdapter,
  'qwen-local': openaiAdapter,
}

// ── 公开 API ─────────────────────────────────────────────

export function getToolAdapter(providerName: string): ToolFormatAdapter {
  return ADAPTERS[providerName] || openaiAdapter
}

/**
 * 将内部工具定义转换为指定 Provider 的原生格式
 */
export function convertToolsForProvider(providerName: string, tools: InternalToolDef[]): any[] {
  const adapter = getToolAdapter(providerName)
  return adapter.convertTools(tools)
}

/**
 * 将 Provider 原始响应规范化为内部 ChatResponse 格式
 */
export function normalizeProviderResponse(
  providerName: string,
  rawResponse: any
): NormalizedChatResponse {
  const adapter = getToolAdapter(providerName)
  return {
    content: adapter.parseContent(rawResponse),
    tool_calls: adapter.parseToolCalls(rawResponse),
    model: adapter.parseModel(rawResponse),
    usage: adapter.parseUsage(rawResponse),
    finish_reason: adapter.parseFinishReason(rawResponse),
  }
}

/**
 * 生成工具感知的 System Prompt 追加指令
 * 不同模型需要不同的工具调用引导语
 */
export function buildToolAwarePrompt(providerName: string, toolNames: string[]): string {
  const toolsList = toolNames.map(n => `  - ${n}`).join('\n')

  switch (providerName) {
    case 'anthropic':
      return `\n[TOOLS] Available tools (use tool_use blocks):\n${toolsList}\nWhen you need data, use a tool. Put results in your response.`

    case 'google':
      return `\n[TOOLS] Available functions:\n${toolsList}\nCall functions when needed. Use functionCall in your response parts.`

    default:
      // OpenAI 兼容格式
      return `\n[TOOLS] Available functions:\n${toolsList}\nCall functions via function calling. NEVER describe what tools you'll use — just call them.`
  }
}

/**
 * 注册自定义适配器 (用于第三方 provider)
 */
export function registerToolAdapter(name: string, adapter: ToolFormatAdapter): void {
  ADAPTERS[name] = adapter
}

export function listAdapters(): string[] {
  return Object.keys(ADAPTERS)
}
