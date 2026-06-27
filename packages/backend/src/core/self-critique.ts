// packages/backend/src/core/self-critique.ts · DaShengOS v8.1
// 自我审查模块 — Hermes-style self-critique loop
// LLM 输出 → 自我审查 → 修正 → 最终输出
// 2026-06-28

import { config } from '../config.js'

// Types
export interface CritiqueResult {
  original: string
  critique: string
  issues: CritiqueIssue[]
  severity: 'none' | 'minor' | 'major' | 'critical'
  revised: string
  improvementRatio: number  // 0-1, how much the answer improved
  tokensUsed: number
}

export interface CritiqueIssue {
  type: 'hallucination' | 'incompleteness' | 'inaccuracy' | 'bias' | 'clarity' | 'safety'
  description: string
  location: string   // quoted text from original
  confidence: number // 0-1
}

export interface CritiqueConfig {
  enabled: boolean
  maxRetries: number          // max critique-revise cycles (default 1)
  provider: string            // LLM provider for critique
  model: string               // model for critique
  timeoutMs: number
  minContentLength: number    // only critique answers longer than this
}

const DEFAULT_CONFIG: CritiqueConfig = {
  enabled: true,
  maxRetries: 1,
  provider: 'siliconflow',
  model: 'deepseek-chat',
  timeoutMs: 30000,
  minContentLength: 100,
}

const CRITIQUE_SYSTEM_PROMPT = `You are a strict quality reviewer. Review the following AI response for:

1. **Hallucinations**: Made-up facts, numbers, statistics without evidence markers
2. **Incompleteness**: Missing key information the user asked for
3. **Inaccuracy**: Wrong or misleading statements
4. **Bias**: One-sided or unfair representation
5. **Clarity**: Confusing, vague, or poorly structured writing
6. **Safety**: Potentially harmful content

Respond in JSON format:
{
  "issues": [
    {"type": "hallucination|incompleteness|inaccuracy|bias|clarity|safety", "description": "...", "location": "quoted text from original", "confidence": 0.8}
  ],
  "severity": "none|minor|major|critical",
  "critique": "brief overall assessment",
  "needsRevision": true
}

If no issues found, return {"issues": [], "severity": "none", "critique": "No issues found", "needsRevision": false}`

const REVISE_SYSTEM_PROMPT = `You are an AI quality improver. Given the original answer and a quality review, produce a REVISED answer that fixes all identified issues.

Rules:
- Preserve all correct information from the original
- Fix hallucinations by removing or marking uncertain claims with [推测]
- Fill in missing information
- Improve clarity and structure
- NEVER add new unverified claims

Respond with ONLY the revised answer text. No JSON, no meta-commentary.`

// Self-critique entry point
export async function selfCritique(
  originalAnswer: string,
  userQuery: string,
  cfg: Partial<CritiqueConfig> = {}
): Promise<CritiqueResult> {
  const c: CritiqueConfig = { ...DEFAULT_CONFIG, ...cfg }

  if (!c.enabled || originalAnswer.length < c.minContentLength) {
    return {
      original: originalAnswer,
      critique: 'Skipped (too short or disabled)',
      issues: [],
      severity: 'none',
      revised: originalAnswer,
      improvementRatio: 0,
      tokensUsed: 0,
    }
  }

  let totalTokens = 0

  // Phase 1: Critique
  const critiqueResp = await callLLM(CRITIQUE_SYSTEM_PROMPT, critiqueUserPrompt(originalAnswer, userQuery), c)
  totalTokens += critiqueResp.tokens

  let parsed: any
  try {
    // Extract JSON from response
    const jsonMatch = critiqueResp.text.match(/\{[\s\S]*\}/)
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { issues: [], severity: 'minor', critique: critiqueResp.text, needsRevision: false }
  } catch {
    parsed = { issues: [], severity: 'minor', critique: critiqueResp.text, needsRevision: false }
  }

  const issues: CritiqueIssue[] = (parsed.issues || []).map((i: any) => ({
    type: i.type || 'clarity',
    description: i.description || '',
    location: i.location || '',
    confidence: i.confidence || 0.5,
  }))

  if (!parsed.needsRevision && issues.length === 0) {
    return {
      original: originalAnswer,
      critique: parsed.critique || 'Passed review',
      issues: [],
      severity: 'none',
      revised: originalAnswer,
      improvementRatio: 1,
      tokensUsed: totalTokens,
    }
  }

  // Phase 2: Revise
  const reviseResp = await callLLM(REVISE_SYSTEM_PROMPT, reviseUserPrompt(originalAnswer, JSON.stringify(parsed, null, 2)), c)
  totalTokens += reviseResp.tokens

  const improvementRatio = Math.min(1, Math.max(0,
    (reviseResp.text.length - originalAnswer.length) / Math.max(originalAnswer.length, 1) + 0.5
  ))

  return {
    original: originalAnswer,
    critique: parsed.critique || critiqueResp.text,
    issues,
    severity: parsed.severity || 'minor',
    revised: reviseResp.text || originalAnswer,
    improvementRatio,
    tokensUsed: totalTokens,
  }
}

// Bulk critique for multiple answers (e.g., swarm outputs)
export async function bulkCritique(
  answers: Array<{ text: string; label: string }>,
  userQuery: string,
  cfg: Partial<CritiqueConfig> = {}
): Promise<Array<{ label: string; result: CritiqueResult }>> {
  const results = await Promise.all(
    answers.map(async ({ text, label }) => ({
      label,
      result: await selfCritique(text, userQuery, cfg),
    }))
  )
  return results
}

// Helper: call LLM
async function callLLM(
  systemPrompt: string,
  userMessage: string,
  cfg: CritiqueConfig
): Promise<{ text: string; tokens: number }> {
  // Use configured provider
  let baseUrl = config.SILICONFLOW_BASE_URL
  let apiKey = config.SILICONFLOW_API_KEY

  if (cfg.provider === 'openai') {
    baseUrl = 'https://api.openai.com/v1'
    apiKey = process.env.OPENAI_API_KEY || ''
  }

  const resp = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error('Self-critique LLM call failed: ' + resp.status + ' ' + errText.slice(0, 200))
  }

  const data = await resp.json() as any
  const text = data.choices?.[0]?.message?.content || ''
  const tokens = data.usage?.total_tokens || 0

  return { text, tokens }
}

function critiqueUserPrompt(original: string, userQuery: string): string {
  return 'USER QUERY:\n' + userQuery + '\n\nAI RESPONSE TO REVIEW:\n' + original.slice(0, 4000)
}

function reviseUserPrompt(original: string, critiqueJson: string): string {
  return 'ORIGINAL ANSWER:\n' + original.slice(0, 4000) + '\n\nQUALITY REVIEW:\n' + critiqueJson + '\n\nPlease produce the revised answer now.'
}

console.log('[SelfCritique] Module loaded (Hermes-style self-review loop)')
