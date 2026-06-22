// packages/backend/src/core/harness/reflector.ts · DaShengOS Harness — Reflection & Verification
// 2026-06-18 · 结果导向思维 + 幻觉检测 + 自动重试
// 每步执行后验证，不符合预期则反思+重试 (max 2 retries)

// ─── Types ─────────────────────────────────────────────────

export interface VerificationResult {
  passed: boolean
  issues: VerificationIssue[]
  retryRecommended: boolean
  retryStrategy?: 'rephrase' | 'different_tool' | 'escalate'
  confidence: number // 0-1
}

export interface VerificationIssue {
  type: 'empty_result' | 'hallucination_risk' | 'format_violation' | 'off_topic' | 'incomplete' | 'data_stale'
  severity: 'critical' | 'warning' | 'info'
  description: string
  evidence?: string
}

export interface ReflectionLog {
  stepIndex: number
  action: string
  result: string
  verification: VerificationResult
  retryCount: number
  finalResult: string
  learned?: string // 反思中学到的东西
}

// ─── 幻觉检测模式 ──────────────────────────────────────────

const HALLUCINATION_PATTERNS = [
  // 常见幻觉模式: 捏造具体数字但没有"约"/"估算"前缀
  /(?<![约估算推测大概大约])\d{2,3}[\.\d]*%/,  // XX% 没有前缀
  /据.*统计.*\d{4,}/,    // "据XX统计" 加大数字
  /销量.*\d+万/,         // 销量XX万 (非常容易幻觉)
  /市场占有率.*\d+%/,    // 市场占有率XX%
  /同比增长.*\d+%/,      // 同比增长XX%
]

// 可以没有来源的数据
const SAFE_QUALIFIERS = ['约', '估算', '推测', '大概', '大约', '[推测]', '[估算]', '估算值', '行业普遍认为']

// ─── 验证函数 ──────────────────────────────────────────────

/**
 * 验证 LLM 输出/工具结果的质量
 * 返回 VerificationResult 带问题和建议
 */
export function verifyResult(
  input: string,
  output: string,
  expectedPattern?: string,
): VerificationResult {
  const issues: VerificationIssue[] = []
  let confidence = 1.0

  // 1. 空结果检测
  if (!output || output.trim().length === 0) {
    issues.push({
      type: 'empty_result',
      severity: 'critical',
      description: '输出为空',
    })
    confidence -= 0.8
  }

  // 2. 截断检测 (超长输出可能被 max_tokens 截断)
  if (output.length > 100 && !output.endsWith('。') && !output.endsWith('.') && !output.endsWith('```') && !output.endsWith('\n')) {
    issues.push({
      type: 'incomplete',
      severity: 'warning',
      description: '输出可能被截断 (未以句号/代码块结尾)',
      evidence: output.slice(-30),
    })
    confidence -= 0.3
  }

  // 3. 幻觉检测
  for (const pattern of HALLUCINATION_PATTERNS) {
    const match = output.match(pattern)
    if (match) {
      // 检查是否有安全前缀
      const hasQualifier = SAFE_QUALIFIERS.some(q => output.includes(q))
      if (!hasQualifier) {
        issues.push({
          type: 'hallucination_risk',
          severity: 'warning',
          description: `可疑数据点: "${match[0]}" — 缺少"约/估算/推测"限定词`,
          evidence: match[0],
        })
        confidence -= 0.2
      }
    }
  }

  // 4. 格式合规检查 (针对结构化输出)
  if (expectedPattern) {
    const expectedKeywords = expectedPattern.split(/[|,，、]/).map(s => s.trim())
    const missingKeywords = expectedKeywords.filter(k => k && !output.includes(k))

    if (missingKeywords.length > 0 && missingKeywords.length < expectedKeywords.length) {
      issues.push({
        type: 'format_violation',
        severity: 'info',
        description: `缺少预期关键词: ${missingKeywords.join(', ')}`,
      })
      confidence -= 0.1
    }
  }

  // 5. 偏题检测 (跟输入完全不相关)
  if (input && output) {
    const inputKeywords = extractKeywords(input)
    const outputKeywords = extractKeywords(output)
    const overlap = inputKeywords.filter(k => outputKeywords.includes(k))
    if (inputKeywords.length > 2 && overlap.length === 0) {
      issues.push({
        type: 'off_topic',
        severity: 'warning',
        description: '输出可能与输入不相关 (无关键词重叠)',
      })
      confidence -= 0.4
    }
  }

  // 6. 通用泛泛而谈检测
  const genericPhrases = ['这是一个很好的问题', '让我来帮你', '总的来说', '总之', '总而言之']
  const genericCount = genericPhrases.filter(p => output.includes(p)).length
  if (genericCount >= 3 && output.length < 200) {
    issues.push({
      type: 'hallucination_risk',
      severity: 'info',
      description: '输出过于泛泛而谈，可能缺乏实质性内容',
    })
    confidence -= 0.2
  }

  const passed = issues.filter(i => i.severity === 'critical').length === 0 && confidence >= 0.4
  const retryRecommended = confidence < 0.5 && issues.some(i => i.severity === 'critical')

  let retryStrategy: VerificationResult['retryStrategy']
  if (retryRecommended) {
    const hasHallucination = issues.some(i => i.type === 'hallucination_risk')
    const hasEmpty = issues.some(i => i.type === 'empty_result')
    const hasOffTopic = issues.some(i => i.type === 'off_topic')
    retryStrategy = hasOffTopic ? 'rephrase' : hasHallucination ? 'different_tool' : hasEmpty ? 'different_tool' : 'rephrase'
  }

  return {
    passed,
    issues,
    retryRecommended,
    retryStrategy,
    confidence: Math.max(0, Math.min(1, confidence)),
  }
}

/**
 * 反思日志: 记录验证结果和学习点
 */
export function createReflectionLog(
  stepIndex: number,
  action: string,
  result: string,
  verification: VerificationResult,
  retryCount: number,
): ReflectionLog {
  let learned: string | undefined

  if (!verification.passed && verification.issues.length > 0) {
    const mainIssue = verification.issues[0]
    learned = `Step ${stepIndex} "${action}" — ${mainIssue.type}: ${mainIssue.description}`
    if (verification.retryStrategy) {
      learned += ` → 建议: ${verification.retryStrategy}`
    }
  }

  return {
    stepIndex,
    action,
    result,
    verification,
    retryCount,
    finalResult: result,
    learned,
  }
}

/**
 * 生成反思增强的 prompt (用于重试)
 */
export function buildReflectionPrompt(
  originalInput: string,
  failedOutput: string,
  issues: VerificationIssue[],
): string {
  const issueDescriptions = issues
    .map(i => `- [${i.severity}] ${i.type}: ${i.description}`)
    .join('\n')

  return `上次的回答存在以下问题，请修正:

问题列表:
${issueDescriptions}

原始问题: ${originalInput}

上次回答:
${failedOutput.slice(0, 1000)}

请重新回答，注意:
1. 修正上述所有问题
2. 不确定的数据标注 [推测] 或 [估算]
3. 不要重复上次的错误
4. 输出必须包含: 摘要→分析→行动项→风险`
}

// ─── 辅助函数 ──────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  // 简单关键词提取: 去停用词，取长度>=2的词
  const stopwords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '他', '她', '吗', '那', '什么', '怎么', '如何', '为什么', '帮我', '请', '可以', '能不能'])

  const words: string[] = []
  // 中文分词 (简单: 按标点/空格分割，取连续中文2-4字)
  const segments = text.split(/[，。！？、；：""''（）\s,.\-!?;:()[\]{}]+/)
  for (const seg of segments) {
    if (seg.length >= 2 && seg.length <= 8 && !stopwords.has(seg)) {
      words.push(seg)
    }
  }
  return [...new Set(words)].slice(0, 10)
}
