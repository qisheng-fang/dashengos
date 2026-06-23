// packages/backend/src/core/semantic-loop-detector.ts · DaShengOS v6.0
// 语义重复检测 — 防止 LLM 陷入无意义循环
// 2026-06-23

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface LoopAlert {
  detected: boolean
  type: 'exact_repeat' | 'semantic_loop' | 'tool_loop' | 'degrading_quality'
  confidence: number        // 0-1
  evidence: string[]
  recommendation: 'force_synthesize' | 'change_strategy' | 'reduce_temperature' | 'switch_model'
}

export interface ContentFingerprint {
  hash: string
  timestamp: number
  iteration: number
}

// ═══════════════════════════════════════════════════════════
// 指纹生成 (轻量级语义哈希)
// ═══════════════════════════════════════════════════════════

function fingerprint(text: string): string {
  // 归一化: 去空格、去标点、小写
  const normalized = text
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, ' ')
    .replace(/[，。！？、；：""''（）【】《》\.,!\?;:'"\(\)\[\]{}]/g, '')
    .trim()
  
  // 提取关键片段: 取每句的前15个字符
  const sentences = normalized.split(/[。！？.!?]/).filter(s => s.length > 10)
  const keyPhrases = sentences.slice(0, 5).map(s => s.slice(0, 30))
  
  // 简单哈希
  let h = 0
  for (const phrase of keyPhrases) {
    for (let i = 0; i < phrase.length; i++) {
      h = ((h << 5) - h + phrase.charCodeAt(i)) | 0
    }
  }
  return Math.abs(h).toString(16).padStart(8, '0')
}

// ═══════════════════════════════════════════════════════════
// Jaccard 相似度 (工具序列)
// ═══════════════════════════════════════════════════════════

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ═══════════════════════════════════════════════════════════
// 核心检测器
// ═══════════════════════════════════════════════════════════

export class SemanticLoopDetector {
  private contentHistory: ContentFingerprint[] = []
  private toolSequenceHistory: string[][] = []
  private qualityScores: number[] = []
  private consecutiveEmptyTools = 0

  reset(): void {
    this.contentHistory = []
    this.toolSequenceHistory = []
    this.qualityScores = []
    this.consecutiveEmptyTools = 0
  }

  /**
   * 记录一次迭代的输出
   */
  recordIteration(iteration: number, content: string, toolNames: string[], toolResults: Array<'ok' | 'fail'>): void {
    const fp = fingerprint(content)
    this.contentHistory.push({ hash: fp, timestamp: Date.now(), iteration })
    this.toolSequenceHistory.push(toolNames)

    // 质量评分: 基于工具成功率
    const successRate = toolResults.length > 0
      ? toolResults.filter(r => r === 'ok').length / toolResults.length
      : 1
    this.qualityScores.push(successRate)

    // 跟踪空工具迭代
    if (toolNames.length === 0 && content.length < 50) {
      this.consecutiveEmptyTools++
    } else {
      this.consecutiveEmptyTools = 0
    }
  }

  /**
   * 检测是否陷入循环
   */
  detect(): LoopAlert {
    // 1. 精确重复检测 (相同指纹连续出现)
    if (this.contentHistory.length >= 3) {
      const recent = this.contentHistory.slice(-3)
      const uniqueHashes = new Set(recent.map(c => c.hash))
      if (uniqueHashes.size === 1) {
        return {
          detected: true,
          type: 'exact_repeat',
          confidence: 0.95,
          evidence: [`连续 ${recent.length} 次相同输出: ${recent[0].hash}`],
          recommendation: 'force_synthesize',
        }
      }
    }

    // 2. 工具循环检测 (相同工具序列重复)
    if (this.toolSequenceHistory.length >= 4) {
      const recent4 = this.toolSequenceHistory.slice(-4)
      const jac1 = jaccardSimilarity(recent4[0], recent4[2])
      const jac2 = jaccardSimilarity(recent4[1], recent4[3])
      if (jac1 > 0.8 && jac2 > 0.8 && recent4[0].length > 0) {
        return {
          detected: true,
          type: 'tool_loop',
          confidence: Math.max(jac1, jac2),
          evidence: [`工具序列重复: ${recent4[0].join(',')} 出现2次`],
          recommendation: 'change_strategy',
        }
      }
    }

    // 3. 质量下降检测
    if (this.qualityScores.length >= 4) {
      const recent = this.qualityScores.slice(-4)
      const trend = recent[recent.length - 1] - recent[0]
      if (trend < -0.3) {
        return {
          detected: true,
          type: 'degrading_quality',
          confidence: Math.abs(trend),
          evidence: [`工具成功率下降: ${recent[0].toFixed(1)} → ${recent[recent.length-1].toFixed(1)}`],
          recommendation: 'switch_model',
        }
      }
    }

    // 4. 连续空转检测
    if (this.consecutiveEmptyTools >= 3) {
      return {
        detected: true,
        type: 'semantic_loop',
        confidence: 0.7 + this.consecutiveEmptyTools * 0.05,
        evidence: [`连续 ${this.consecutiveEmptyTools} 次无工具调用且输出空洞`],
        recommendation: 'force_synthesize',
      }
    }

    return { detected: false, type: 'semantic_loop', confidence: 0, evidence: [], recommendation: 'force_synthesize' }
  }

  /**
   * 获取用于注入 system prompt 的干预指令
   */
  getIntervention(alert: LoopAlert): string | null {
    if (!alert.detected) return null

    switch (alert.recommendation) {
      case 'force_synthesize':
        return `[SYSTEM] LOOP DETECTED (${alert.type}, confidence=${alert.confidence.toFixed(2)}). You are repeating yourself. STOP all tool calls. Synthesize ALL collected data into the FINAL deliverable NOW. Output content directly — NO tools, NO reasoning, NO descriptions of what you will do. First character of your response must be the deliverable content. Evidence: ${alert.evidence.join('; ')}`
      
      case 'change_strategy':
        return `[SYSTEM] TOOL LOOP DETECTED. You are calling the same tools repeatedly. This is inefficient. Switch strategy: use DIFFERENT tools or synthesize from what you already have. Do not repeat the same tool sequence. Evidence: ${alert.evidence.join('; ')}`
      
      case 'switch_model':
        return `[SYSTEM] QUALITY DEGRADING. Your recent outputs have lower quality. Take a step back. Re-read the user's original request. Produce the best possible answer with what you have. Do NOT call more tools — the data you have is sufficient. Evidence: ${alert.evidence.join('; ')}`
      
      case 'reduce_temperature':
        return `[SYSTEM] Output is becoming unfocused. Be more direct and concise. Answer the user's core question immediately. No tangents.`
      
      default:
        return null
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 全局单例
// ═══════════════════════════════════════════════════════════

let globalDetector: SemanticLoopDetector | null = null

export function getLoopDetector(): SemanticLoopDetector {
  if (!globalDetector) globalDetector = new SemanticLoopDetector()
  return globalDetector
}

export function resetLoopDetector(): void {
  globalDetector = new SemanticLoopDetector()
}

console.log('[SemanticLoopDetector] 语义循环检测已就绪')
