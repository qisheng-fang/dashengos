// packages/backend/src/core/context-compressor.ts · DaShengOS v5.4
// 上下文压缩引擎 — LLM 智能摘要 + 规则回退
// 2026-06-23 · v5.4: 热路径切换 smartCompress, token触发替代消息数触发

// ─── Constants ─────────────────────────────────────────────
const COMPRESSION_THRESHOLD = 60000
const KEEP_RECENT = 8
const SUMMARY_MAX_TOKENS = 2000

// ─── Types ─────────────────────────────────────────────────
export interface CompressedContext {
  messages: Array<{ role: string; content: string }>
  compressed: boolean
  stats: {
    originalTokens: number; compressedTokens: number
    originalMessages: number; compressedMessages: number; removedMessages: number
  }
}

// ─── Telemetry ─────────────────────────────────────────────
export interface CompressionMetrics {
  attempts: number
  triggered: number       // threshold exceeded
  llmAttempts: number
  llmSuccesses: number
  llmFailures: number     // fell back to rule-based
  fallbackCount: number
  totalOriginalTokens: number
  totalCompressedTokens: number
  avgRatio: number
  avgLatencyMs: number
  lastError?: string
  lastTriggerTime: number
  dynamicThreshold: number
}

let _compressionMetrics: CompressionMetrics = {
  attempts: 0, triggered: 0, llmAttempts: 0,
  llmSuccesses: 0, llmFailures: 0, fallbackCount: 0,
  totalOriginalTokens: 0, totalCompressedTokens: 0,
  avgRatio: 0, avgLatencyMs: 0, lastTriggerTime: 0,
  dynamicThreshold: COMPRESSION_THRESHOLD,
}

let _consecutiveLLMFailures = 0

export function getCompressionMetrics(): CompressionMetrics {
  return { ..._compressionMetrics }
}

function recordCompression(stats: { originalTokens: number; compressedTokens: number; latencyMs: number; llmSuccess: boolean }) {
  _compressionMetrics.attempts++
  _compressionMetrics.lastTriggerTime = Date.now()
  _compressionMetrics.totalOriginalTokens += stats.originalTokens
  _compressionMetrics.totalCompressedTokens += stats.compressedTokens
  
  if (stats.originalTokens > 0) {
    const ratio = stats.originalTokens / Math.max(1, stats.compressedTokens)
    const n = _compressionMetrics.triggered
    _compressionMetrics.avgRatio = (_compressionMetrics.avgRatio * n + ratio) / (n + 1)
  }
  const n = _compressionMetrics.triggered
  _compressionMetrics.avgLatencyMs = (_compressionMetrics.avgLatencyMs * n + stats.latencyMs) / (n + 1)
  
  if (stats.llmSuccess) {
    _compressionMetrics.llmSuccesses++
    _consecutiveLLMFailures = 0
  } else {
    _compressionMetrics.fallbackCount++
    _consecutiveLLMFailures++
    if (_consecutiveLLMFailures >= 3) {
      // Auto-tune: raise threshold to reduce compression frequency on failing LLM
      const newThreshold = Math.min(_compressionMetrics.dynamicThreshold * 1.5, 120000)
      if (newThreshold !== _compressionMetrics.dynamicThreshold) {
        console.log(`[Compressor] Auto-tune: raising threshold ${_compressionMetrics.dynamicThreshold}→${newThreshold} (${_consecutiveLLMFailures} consecutive LLM failures)`)
        _compressionMetrics.dynamicThreshold = newThreshold
      }
    }
  }
  
  // Auto-tune down: if ratio is great, lower threshold to compress more aggressively
  if (_compressionMetrics.avgRatio > 5 && _compressionMetrics.triggered > 5) {
    const newThreshold = Math.max(_compressionMetrics.dynamicThreshold * 0.8, 20000)
    if (newThreshold !== _compressionMetrics.dynamicThreshold) {
      console.log(`[Compressor] Auto-tune: lowering threshold ${_compressionMetrics.dynamicThreshold}→${newThreshold} (avg ratio=${_compressionMetrics.avgRatio.toFixed(1)}x)`)
      _compressionMetrics.dynamicThreshold = newThreshold
    }
  }
}

// Metrics reset (for testing)
export function resetCompressionMetrics(): void {
  _compressionMetrics = {
    attempts: 0, triggered: 0, llmAttempts: 0,
    llmSuccesses: 0, llmFailures: 0, fallbackCount: 0,
    totalOriginalTokens: 0, totalCompressedTokens: 0,
    avgRatio: 0, avgLatencyMs: 0, lastTriggerTime: 0,
    dynamicThreshold: COMPRESSION_THRESHOLD,
  }
  _consecutiveLLMFailures = 0
}

// ─── Token Estimator ───────────────────────────────────────
function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  const otherChars = text.length - chineseChars
  return Math.ceil(chineseChars / 1.5 + otherChars / 3.5)
}

export function estimateTotalTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const msg of messages) total += estimateTokens(msg.role) + estimateTokens(msg.content || '') + 4
  return total
}

// ─── 规则压缩 (回退方案) ──────────────────────────────────
function generateCompressionSummary(messages: Array<{ role: string; content: string }>): string {
  const parts: string[] = []
  const userQuestions: string[] = []
  const assistantKeyPoints: string[] = []
  const toolCalls: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      userQuestions.push(msg.content.slice(0, 200).replace(/\n/g, ' '))
    } else if (msg.role === 'assistant') {
      const firstSentence = msg.content.split(/[。！？\n]/)[0]?.trim()
      if (firstSentence && firstSentence.length > 5 && firstSentence.length < 200) {
        assistantKeyPoints.push(firstSentence)
      } else {
        const numLine = msg.content.split('\n').find(l => /\d+/.test(l) && l.length < 200)
        if (numLine) assistantKeyPoints.push(numLine.trim().slice(0, 150))
      }
    } else if (msg.role === 'tool') {
      toolCalls.push(msg.content.slice(0, 100).replace(/\n/g, ' '))
    }
  }
  if (userQuestions.length) parts.push(`用户提问: ${userQuestions.slice(0, 6).join('; ')}`)
  if (assistantKeyPoints.length) parts.push(`AI要点: ${assistantKeyPoints.slice(0, 5).join(' | ')}`)
  if (toolCalls.length) parts.push(`工具调用: ${toolCalls.slice(0, 5).join('; ')}`)
  return parts.join('\n') || '对话记录已压缩'
}

// ─── LLM 智能压缩 ─────────────────────────────────────────
let _compressCache = new Map<string, { summary: string; time: number }>()
const CACHE_TTL = 300_000 // 5 分钟

async function smartCompress(
  messages: Array<{ role: string; content: string }>,
  options?: { maxSummaryTokens?: number }
): Promise<string> {
  // Cache key: hash of first+last message content
  const cacheKey = `${messages[0]?.content?.slice(0, 50)}|${messages[messages.length-1]?.content?.slice(0, 50)}|${messages.length}`
  const cached = _compressCache.get(cacheKey)
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.summary

  try {
    const { getActiveProvider, getApiKey } = await import('../providers/index.js')
    const provider = getActiveProvider()
    const apiKey = getApiKey(provider) || ''
    if (!apiKey || !provider.chat) throw new Error('No provider')

    const model = (provider as any).defaultModel || 'deepseek-v4-flash'
    const conversationText = messages.map(m => `[${m.role}]: ${m.content.slice(0, 500)}`).join('\n\n')

    const resp = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'system',
          content: `对话压缩器。将历史压缩为结构化摘要（中文，≤${options?.maxSummaryTokens || 300}字）：
1. 用户核心需求
2. AI关键结论/数据
3. 执行的重要操作
4. 未完成事项`
        }, { role: 'user', content: conversationText.slice(0, 15000) }],
        max_tokens: options?.maxSummaryTokens || 300, temperature: 0.3,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json() as any
    const summary = data.choices?.[0]?.message?.content || generateCompressionSummary(messages)
    _compressCache.set(cacheKey, { summary, time: Date.now() })
    return summary
  } catch {
    return generateCompressionSummary(messages)
  }
}

// ─── 核心压缩 (async, LLM优先) ─────────────────────────────
export async function compressContext(
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
  options?: { threshold?: number; keepRecent?: number }
): Promise<CompressedContext> {
  const threshold = options?.threshold || _compressionMetrics.dynamicThreshold
  const keepRecent = options?.keepRecent || KEEP_RECENT
  const systemTokens = estimateTokens(systemPrompt || '')
  const totalTokens = systemTokens + estimateTotalTokens(messages)
  const originalCount = messages.length

  if (totalTokens < threshold) {
    return { messages, compressed: false, stats: {
      originalTokens: totalTokens, compressedTokens: totalTokens,
      originalMessages: originalCount, compressedMessages: originalCount, removedMessages: 0,
    }}
  }

  _compressionMetrics.triggered++
  const t0 = Date.now()
  console.log(`[ContextCompressor] 触发压缩: ${totalTokens}t > ${threshold}t 阈值`)
  const recentMessages = messages.slice(-keepRecent)
  const oldMessages = messages.slice(0, -keepRecent)
  if (oldMessages.length === 0) {
    return { messages, compressed: false, stats: {
      originalTokens: totalTokens, compressedTokens: totalTokens,
      originalMessages: originalCount, compressedMessages: originalCount, removedMessages: 0,
    }}
  }

  // LLM 智能压缩 + 回退
  _compressionMetrics.llmAttempts++
  let llmSuccess = false
  let summary: string
  try {
    summary = await smartCompress(oldMessages)
    llmSuccess = true
  } catch {
    summary = generateCompressionSummary(oldMessages)
    _compressionMetrics.lastError = 'LLM压缩失败，回退规则压缩'
  }

  const compressed: Array<{ role: string; content: string }> = [{
    role: 'system',
    content: `[对话摘要 — 此前对话的压缩记录]\n${summary}`,
  }, ...recentMessages]

  const compressedTokens = estimateTotalTokens(compressed)
  const latency = Date.now() - t0
  console.log(`[ContextCompressor] ${llmSuccess ? '✅' : '⚠️'} ${originalCount}→${compressed.length}条, ${totalTokens}→${compressedTokens+systemTokens}t (${latency}ms)`)

  recordCompression({ originalTokens: totalTokens, compressedTokens: compressedTokens + systemTokens, latencyMs: latency, llmSuccess })

  return { messages: compressed, compressed: true, stats: {
    originalTokens: totalTokens, compressedTokens: compressedTokens + systemTokens,
    originalMessages: originalCount, compressedMessages: compressed.length, removedMessages: oldMessages.length,
  }}
}

// ─── 同步快速压缩 (非LLM, 用于简单裁剪) ──────────────────
export function quickCompress(
  messages: Array<{ role: string; content: string }>,
  maxTokens: number = 40000
): Array<{ role: string; content: string }> {
  let total = 0
  const result: Array<{ role: string; content: string }> = []
  for (const msg of [...messages].reverse()) {
    const tokens = estimateTokens(msg.content)
    if (total + tokens > maxTokens) break
    result.unshift(msg)
    total += tokens
  }
  return result
}

// ─── 定期清理压缩缓存 ─────────────────────────────────────
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of _compressCache) {
    if (now - v.time > CACHE_TTL) _compressCache.delete(k)
  }
}, 300_000)
