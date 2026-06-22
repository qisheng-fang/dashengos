// packages/backend/src/core/context-compressor.ts · DaShengOS v5.3
// 上下文压缩引擎 — 防止长对话超出LLM窗口导致失忆/中断
// 2026-06-21

// ─── Constants ─────────────────────────────────────────────

/** 触发压缩的 token 阈值 (DeepSeek 128K, 保守取 60K) */
const COMPRESSION_THRESHOLD = 60000

/** 压缩后保留的最近消息数 */
const KEEP_RECENT = 8

/** 摘要最大长度 (tokens) */
const SUMMARY_MAX_TOKENS = 2000

// ─── Types ─────────────────────────────────────────────────

export interface CompressedContext {
  /** 压缩后的消息列表 (可直接发送给 LLM) */
  messages: Array<{ role: string; content: string }>
  /** 是否进行了压缩 */
  compressed: boolean
  /** 压缩统计 */
  stats: {
    originalTokens: number
    compressedTokens: number
    originalMessages: number
    compressedMessages: number
    removedMessages: number
  }
}

// ─── Token Estimator ───────────────────────────────────────

/**
 * 估算文本的 token 数
 * 中文: ~1.5 chars/token, 英文: ~3.5 chars/token
 * 保守估算: 2 chars/token
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  // 中文字符 + 英文单词分别计算
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 3.5)
}

/**
 * 估算完整消息列表的总 token 数
 */
function estimateTotalTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const msg of messages) {
    total += estimateTokens(msg.role) + estimateTokens(msg.content || '') + 4 // role + content + overhead
  }
  return total
}

// ─── Core Compressor ───────────────────────────────────────

/**
 * 压缩对话上下文
 * 
 * 策略:
 * 1. 如果总 token < 阈值，不做压缩
 * 2. 超过阈值时:
 *    a. 保留最近 KEEP_RECENT 条消息不变
 *    b. 将更早的消息合并为一条摘要
 *    c. 摘要放在 system 消息之后、最近消息之前
 */
export function compressContext(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
  options?: {
    threshold?: number
    keepRecent?: number
  }
): CompressedContext {
  const threshold = options?.threshold || COMPRESSION_THRESHOLD
  const keepRecent = options?.keepRecent || KEEP_RECENT

  const systemTokens = estimateTokens(systemPrompt || '')
  const totalTokens = systemTokens + estimateTotalTokens(messages)
  const originalCount = messages.length

  // 不需要压缩
  if (totalTokens < threshold) {
    return {
      messages,
      compressed: false,
      stats: {
        originalTokens: totalTokens,
        compressedTokens: totalTokens,
        originalMessages: originalCount,
        compressedMessages: originalCount,
        removedMessages: 0,
      },
    }
  }

  console.log(`[ContextCompressor] 触发压缩: ${totalTokens} tokens > ${threshold} 阈值`)

  // 分离: 待摘要的消息 + 保留的最近消息
  const recentMessages = messages.slice(-keepRecent)
  const oldMessages = messages.slice(0, -keepRecent)

  if (oldMessages.length === 0) {
    // 消息太少无法压缩，保留原样
    return {
      messages,
      compressed: false,
      stats: {
        originalTokens: totalTokens,
        compressedTokens: totalTokens,
        originalMessages: originalCount,
        compressedMessages: originalCount,
        removedMessages: 0,
      },
    }
  }

  // 生成摘要
  const summary = generateCompressionSummary(oldMessages)

  // 构建压缩后的消息列表
  const compressed: Array<{ role: string; content: string }> = []

  // 1. System prompt (外部处理，这里不重复)
  // 2. 摘要 (作为 system 角色的上下文注入)
  compressed.push({
    role: 'system',
    content: `[上下文摘要 — 以下为此前对话的压缩记录，用于保持连贯性]\n${summary}`,
  })

  // 3. 最近消息
  compressed.push(...recentMessages)

  const compressedTokens = estimateTotalTokens(compressed)

  console.log(`[ContextCompressor] 压缩完成: ${originalCount} → ${compressed.length} 条, ${totalTokens} → ${compressedTokens + systemTokens} tokens`)

  return {
    messages: compressed,
    compressed: true,
    stats: {
      originalTokens: totalTokens,
      compressedTokens: compressedTokens + systemTokens,
      originalMessages: originalCount,
      compressedMessages: compressed.length,
      removedMessages: oldMessages.length,
    },
  }
}

/**
 * 智能压缩 — 调用 LLM 生成对话摘要
 * 如果 LLM 不可用，回退到规则压缩
 */
function generateCompressionSummary(messages: Array<{ role: string; content: string }>): string {
  // 规则压缩: 提取关键信息
  const parts: string[] = []

  // 收集用户问题和关键决策
  const userQuestions: string[] = []
  const assistantKeyPoints: string[] = []
  const toolCalls: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const q = msg.content.slice(0, 200).replace(/\n/g, ' ')
      userQuestions.push(q)
    } else if (msg.role === 'assistant') {
      // 提取关键信息: 结论、数字、决策
      const keyPhrases = extractKeyPhrases(msg.content)
      if (keyPhrases) assistantKeyPoints.push(keyPhrases)
    } else if (msg.role === 'tool') {
      const summary = msg.content.slice(0, 100).replace(/\n/g, ' ')
      toolCalls.push(summary)
    }
  }

  if (userQuestions.length > 0) {
    parts.push(`用户提问了 ${userQuestions.length} 个问题: ${userQuestions.slice(0, 6).join('; ')}${userQuestions.length > 6 ? '...' : ''}`)
  }

  if (assistantKeyPoints.length > 0) {
    parts.push(`AI 回复要点: ${assistantKeyPoints.slice(0, 5).join(' | ')}`)
  }

  if (toolCalls.length > 0) {
    parts.push(`执行了 ${toolCalls.length} 次工具调用: ${toolCalls.slice(0, 5).join('; ')}`)
  }

  const summary = parts.join('\n') || '对话记录已压缩'
  return summary.slice(0, SUMMARY_MAX_TOKENS * 3) // ~6000 chars max
}

/**
 * 从回复中提取关键短语
 */
function extractKeyPhrases(text: string): string {
  if (!text || text.length < 20) return ''

  // 提取第一句 (通常是结论)
  const firstSentence = text.split(/[。！？\n]/)[0]?.trim()
  if (firstSentence && firstSentence.length > 5 && firstSentence.length < 150) {
    return firstSentence
  }

  // 提取包含数字的行 (通常是数据)
  const numberLine = text.split('\n').find(l => /\d+/.test(l) && l.length < 200)
  if (numberLine) return numberLine.trim().slice(0, 150)

  return text.slice(0, 150).replace(/\n/g, ' ')
}

// ─── 简化版压缩 (不需要 LLM) ──────────────────────────────

/**
 * 快速压缩 — 纯规则，不需要 LLM 调用
 * 用于 LLM 不可用或需要极快压缩的场景
 */
export function quickCompress(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 40000
): Array<{ role: string; content: string }> {
  let total = 0
  const result: Array<{ role: string; content: string }> = []

  // 从最新到最旧遍历
  const reversed = [...messages].reverse()
  for (const msg of reversed) {
    const tokens = estimateTokens(msg.content)
    if (total + tokens > maxTokens) break
    result.unshift(msg)
    total += tokens
  }

  return result
}

// ─── 智能压缩 (LLM 辅助) ──────────────────────────────────

/**
 * 调用 LLM 生成高质量对话摘要
 * 比规则压缩更准确，但需要额外 API 调用
 */
export async function smartCompress(
  messages: Array<{ role: string; content: string }>,
  options?: { maxSummaryTokens?: number }
): Promise<string> {
  try {
    const { getActiveProvider, getApiKey } = await import('../providers/index.js')
    const provider = getActiveProvider()
    const apiKey = getApiKey(provider) || ''

    if (!apiKey || !provider.chat) {
      // 回退到规则压缩
      return generateCompressionSummary(messages)
    }

    const model = process.env[(provider.name || 'deepseek').toUpperCase() + '_DEFAULT_MODEL'] || provider.defaultModel
    const conversationText = messages.map(m => `[${m.role}]: ${m.content.slice(0, 500)}`).join('\n\n')

    const resp = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `你是一个对话压缩器。将以下对话历史压缩为简洁的结构化摘要，包含：
1. 用户的核心需求和问题
2. AI 给出的关键结论和数据
3. 执行的重要操作
用中文，不超过 ${options?.maxSummaryTokens || 300} 字。`,
          },
          {
            role: 'user',
            content: conversationText.slice(0, 15000),
          },
        ],
        max_tokens: options?.maxSummaryTokens || 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    return data.choices?.[0]?.message?.content || generateCompressionSummary(messages)
  } catch {
    // LLM 不可用时回退规则压缩
    return generateCompressionSummary(messages)
  }
}
