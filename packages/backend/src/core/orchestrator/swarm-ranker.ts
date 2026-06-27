// packages/backend/src/core/orchestrator/swarm-ranker.ts · DaShengOS v8.0
// Swarm 投票/排序策略 — 多 Agent 并行处理 → 投票/评分 → 选择最优
// 2026-06-28

export interface SwarmCandidate {
  agentId: string
  output: string
  tokensUsed: number
  durationMs: number
  confidence?: number
}

export interface SwarmRanking {
  winner: SwarmCandidate
  ranking: SwarmCandidate[]
  strategy: 'quality' | 'majority' | 'hybrid'
  consensus: number       // 0-1, 一致性分数
  reasoning: string
}

// Quality-based scoring: 内容质量 + 多样性 + 长度适当
export function rankByQuality(candidates: SwarmCandidate[]): SwarmRanking {
  if (candidates.length === 0) {
    throw new Error('No candidates to rank')
  }
  if (candidates.length === 1) {
    return {
      winner: candidates[0],
      ranking: candidates,
      strategy: 'quality',
      consensus: 1.0,
      reasoning: 'Single candidate — automatic winner',
    }
  }

  // Score each candidate across dimensions
  const scored = candidates.map(c => {
    let score = 0

    // 1. Content length (not too short, not too verbose)
    const len = c.output.length
    if (len >= 200 && len <= 3000) score += 3
    else if (len >= 100 && len <= 5000) score += 2
    else if (len > 50) score += 1

    // 2. Structural quality: bullet points, headers, code blocks
    const hasBullets = /^[\s]*[-*•]|\d+\.\s/m.test(c.output)
    const hasHeaders = /^#{1,3}\s/m.test(c.output)
    const hasCodeBlocks = /```/.test(c.output)
    if (hasBullets) score += 1.5
    if (hasHeaders) score += 1
    if (hasCodeBlocks) score += 1

    // 3. Factual grounding: numbers, dates, references
    const hasNumbers = /\d{2,}/.test(c.output)
    const hasDates = /\d{4}[-/]\d{2}[-/]\d{2}/.test(c.output)
    const hasLinks = /https?:\/\//.test(c.output)
    if (hasNumbers) score += 1
    if (hasDates) score += 1
    if (hasLinks) score += 1.5

    // 4. Token efficiency (output/tokens ratio)
    const efficiency = c.tokensUsed > 0 ? len / c.tokensUsed : 0
    if (efficiency > 4) score += 2
    else if (efficiency > 2) score += 1

    // 5. Agent confidence (if available)
    if (c.confidence) score += c.confidence * 2

    return { ...c, score }
  })

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score)

  const winner = scored[0]
  const consensus = scored.length > 1
    ? 1 - (scored[0].score - scored[scored.length - 1].score) / Math.max(scored[0].score, 1)
    : 1.0

  return {
    winner,
    ranking: scored,
    strategy: 'quality',
    consensus: Math.max(0, Math.min(1, consensus)),
    reasoning: 'Ranked by content quality (length, structure, grounding, efficiency). Winner: ' + winner.agentId + ' (score: ' + winner.score.toFixed(1) + ')',
  }
}

// Simple majority vote via semantic clustering on key phrases
export function majorityVote(candidates: SwarmCandidate[]): SwarmRanking {
  if (candidates.length === 0) {
    throw new Error('No candidates to rank')
  }
  if (candidates.length === 1) {
    return {
      winner: candidates[0],
      ranking: candidates,
      strategy: 'majority',
      consensus: 1.0,
      reasoning: 'Single candidate — automatic winner',
    }
  }

  // Extract key sentences (first 2 sentences + any bold/header lines)
  function extractKeyPhrases(text: string): string[] {
    const lines = text.split('\n').filter(l => l.trim().length > 0)
    const key: string[] = []

    // First 2 substantive lines
    let taken = 0
    for (const line of lines) {
      const t = line.trim()
      if (t.length > 20 && taken < 2) { key.push(t.slice(0, 120)); taken++ }
      if (t.startsWith('#') || t.startsWith('**') || /^\d+\./.test(t)) {
        key.push(t.slice(0, 120))
      }
    }
    return key.slice(0, 5)
  }

  // Cluster: group candidates with similar key phrases
  const clusters: Array<{ phrase: string; members: SwarmCandidate[] }> = []
  const assigned = new Set<number>()

  for (let i = 0; i < candidates.length; i++) {
    if (assigned.has(i)) continue
    const ki = extractKeyPhrases(candidates[i].output)
    const group: SwarmCandidate[] = [candidates[i]]
    assigned.add(i)

    for (let j = i + 1; j < candidates.length; j++) {
      if (assigned.has(j)) continue
      const kj = extractKeyPhrases(candidates[j].output)
      // Simple overlap check
      const overlap = ki.filter(p => kj.some(q => q.includes(p.slice(0, 40)) || p.includes(q.slice(0, 40))))
      if (overlap.length >= 1) {
        group.push(candidates[j])
        assigned.add(j)
      }
    }
    clusters.push({ phrase: ki[0] || 'cluster-' + i, members: group })
  }

  // Largest cluster = majority, pick best within cluster by quality
  clusters.sort((a, b) => b.members.length - a.members.length)
  const majorityCluster = clusters[0]

  // Within majority, rank by quality
  const ranked = rankByQuality(majorityCluster.members)
  const consensus = majorityCluster.members.length / candidates.length

  return {
    winner: ranked.winner,
    ranking: [
      ...majorityCluster.members,
      ...candidates.filter(c => !majorityCluster.members.includes(c)),
    ],
    strategy: 'majority',
    consensus: Math.max(0, Math.min(1, consensus)),
    reasoning: 'Majority cluster (' + majorityCluster.members.length + '/' + candidates.length + ' agents agree). Winner: ' + ranked.winner.agentId,
  }
}

// Hybrid: majority vote then quality rank within winning cluster
export function hybridRank(candidates: SwarmCandidate[]): SwarmRanking {
  // First try majority — if strong consensus (>60%), use it
  const majority = majorityVote(candidates)
  if (majority.consensus >= 0.6) return majority

  // Otherwise fall back to quality ranking
  const quality = rankByQuality(candidates)
  return { ...quality, strategy: 'hybrid', reasoning: 'Low consensus (' + (majority.consensus * 100).toFixed(0) + '%), fallback to quality ranking' }
}

// Aggregate all candidates into a synthesis prompt
export function buildSynthesisPrompt(candidates: SwarmCandidate[], originalTask: string): string {
  const summaries = candidates.map((c, i) =>
    '=== Agent ' + (i + 1) + ' (' + c.agentId + ', confidence: ' + (c.confidence || 'N/A') + ') ===\n' + c.output.slice(0, 2000)
  ).join('\n\n')

  return 'ORIGINAL TASK:\n' + originalTask + '\n\nAGENT OUTPUTS:\n\n' + summaries + '\n\n---\nPlease synthesize the above ' + candidates.length + ' agent outputs into a single, comprehensive, and well-structured final answer. Resolve any contradictions and combine complementary insights.'
}

console.log('[SwarmRanker] Swarm ranking strategies loaded (quality, majority, hybrid)')
