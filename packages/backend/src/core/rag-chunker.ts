// packages/backend/src/core/rag-chunker.ts · DaShengOS v6.0
// RAG 语义切片引擎 — Chunk + Overlap + Embedding
// 2026-06-23 · 遵循 Anthropic Contextual Retrieval 最佳实践

// ═══════════════════════════════════════════════════════════
// 设计参数 (Anthropic Contextual Retrieval 推荐)
// ═══════════════════════════════════════════════════════════
// Chunk Size:     500-800 字符 (中文) / 800-1200 tokens (英文)
// Chunk Overlap:  15-20% (保留边界语义连续性)
// Embedding:      zvec Phase 2 / hash-BOW Phase 1
// Boundary Aware: 按段落/句子边界切分，避免硬切断

const CHUNK_SIZE = 600      // 每块中文约600字符
const CHUNK_OVERLAP = 120   // 重叠120字符 (20%)
const MIN_CHUNK_SIZE = 100  // 小于此的块合并到前一块

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface TextChunk {
  id: string
  index: number
  content: string
  startChar: number
  endChar: number
  metadata: {
    source: string       // 文档来源
    section?: string     // 章节标题
    chunkType: 'paragraph' | 'sentence_boundary' | 'overlap_fallback'
    tokenEstimate: number
  }
  embedding?: number[]   // Phase 2: zvec embedding
}

export interface ChunkedDocument {
  source: string
  totalChars: number
  totalChunks: number
  chunks: TextChunk[]
  stats: {
    avgChunkSize: number
    overlapRatio: number
    boundaryPreservationRate: number
  }
}

// ═══════════════════════════════════════════════════════════
// 智能边界检测
// ═══════════════════════════════════════════════════════════

/**
 * 找到最近的语义边界 (段落 > 句子 > 强制切分)
 */
function findNearestBoundary(text: string, targetPos: number): number {
  if (targetPos >= text.length) return text.length
  
  // 1. 在 [targetPos - 50, targetPos + 50] 范围内找段落边界
  const searchStart = Math.max(0, targetPos - 50)
  const searchEnd = Math.min(text.length, targetPos + 50)
  const segment = text.slice(searchStart, searchEnd)
  
  // 双换行符 (段落边界) — 最优先
  const paraMatch = segment.match(/\n\n/)
  if (paraMatch && paraMatch.index !== undefined) {
    const pos = searchStart + paraMatch.index
    if (Math.abs(pos - targetPos) <= 50) return pos
  }
  
  // 句号/问号/感叹号 + 换行
  const sentMatch = segment.match(/[。！？]\n/)
  if (sentMatch && sentMatch.index !== undefined) {
    const pos = searchStart + sentMatch.index! + 1
    if (Math.abs(pos - targetPos) <= 40) return pos
  }
  
  // 单个句号/问号/感叹号
  const punctMatch = segment.match(/[。！？]/)
  if (punctMatch && punctMatch.index !== undefined) {
    const pos = searchStart + punctMatch.index! + 1
    if (Math.abs(pos - targetPos) <= 30) return pos
  }
  
  // 逗号 (最后选择)
  const commaMatch = segment.match(/[，,]/)
  if (commaMatch && commaMatch.index !== undefined) {
    const pos = searchStart + commaMatch.index! + 1
    if (Math.abs(pos - targetPos) <= 20) return pos
  }
  
  // 无合适边界，返回目标位置
  return targetPos
}

// ═══════════════════════════════════════════════════════════
// 核心切片逻辑
// ═══════════════════════════════════════════════════════════

export function chunkDocument(
  text: string,
  source: string,
  options?: {
    chunkSize?: number
    chunkOverlap?: number
    section?: string
  }
): ChunkedDocument {
  const chunkSize = options?.chunkSize || CHUNK_SIZE
  const chunkOverlap = options?.chunkOverlap || CHUNK_OVERLAP
  
  if (!text || text.trim().length === 0) {
    return { source, totalChars: 0, totalChunks: 0, chunks: [], stats: { avgChunkSize: 0, overlapRatio: 0, boundaryPreservationRate: 0 } }
  }
  
  const chunks: TextChunk[] = []
  let pos = 0
  let index = 0
  let boundaryHits = 0
  let totalSplits = 0
  
  while (pos < text.length) {
    const end = Math.min(pos + chunkSize, text.length)
    totalSplits++
    
    // 智能边界对齐
    const boundary = end < text.length ? findNearestBoundary(text, end) : end
    if (boundary !== end) boundaryHits++
    
    const content = text.slice(pos, boundary).trim()
    
    // 第一个chunk或文本较短时，保留所有内容 (不丢弃)
    if (content.length >= MIN_CHUNK_SIZE || chunks.length === 0) {
      chunks.push({
        id: `${source.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')}_chunk_${index}`,
        index,
        content,
        startChar: pos,
        endChar: boundary,
        metadata: {
          source,
          section: options?.section,
          chunkType: boundary !== end ? 'paragraph' : 'overlap_fallback',
          tokenEstimate: Math.ceil(content.length / 1.5), // 中文token估算
        },
      })
      index++
    } else if (chunks.length > 0) {
      // 小块合并到前一块
      chunks[chunks.length - 1].content += '\n' + content
      chunks[chunks.length - 1].endChar = boundary
    }
    
    // 前进 (带重叠)
    pos = boundary - (boundary < text.length ? chunkOverlap : 0)
    if (pos < 0) pos = 0
    if (pos >= text.length) break
  }
  
  const avgChunkSize = chunks.length > 0 
    ? chunks.reduce((s, c) => s + c.content.length, 0) / chunks.length 
    : 0
  
  return {
    source,
    totalChars: text.length,
    totalChunks: chunks.length,
    chunks,
    stats: {
      avgChunkSize: Math.round(avgChunkSize),
      overlapRatio: Math.round((chunkOverlap / chunkSize) * 100),
      boundaryPreservationRate: totalSplits > 0 ? Math.round((boundaryHits / totalSplits) * 100) : 100,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// 批量切片 (多文档)
// ═══════════════════════════════════════════════════════════

export function chunkDocuments(
  documents: Array<{ text: string; source: string; section?: string }>,
  options?: { chunkSize?: number; chunkOverlap?: number }
): ChunkedDocument[] {
  return documents.map(doc => chunkDocument(doc.text, doc.source, { ...options, section: doc.section }))
}

// ═══════════════════════════════════════════════════════════
// 上下文窗口检索 (Contextual Retrieval)
// ═══════════════════════════════════════════════════════════

/**
 * 检索相关chunk时，自动附带前后邻接chunk
 * Anthropic 推荐: 每个检索到的chunk加上前后各1个chunk
 */
export function expandChunkContext(
  chunks: TextChunk[],
  targetIndices: number[],
  expandBy: number = 1
): TextChunk[] {
  const expanded = new Map<number, TextChunk>()
  
  for (const idx of targetIndices) {
    for (let offset = -expandBy; offset <= expandBy; offset++) {
      const neighborIdx = idx + offset
      if (neighborIdx >= 0 && neighborIdx < chunks.length) {
        expanded.set(neighborIdx, chunks[neighborIdx])
      }
    }
  }
  
  return [...expanded.values()].sort((a, b) => a.index - b.index)
}

// ═══════════════════════════════════════════════════════════
// 检索评估指标
// ═══════════════════════════════════════════════════════════

export function evaluateChunking(chunked: ChunkedDocument): {
  score: number
  grade: 'A' | 'B' | 'C' | 'D'
  issues: string[]
} {
  const issues: string[] = []
  let score = 100
  
  // 检查: 平均chunk大小在合理范围
  if (chunked.stats.avgChunkSize < 200) {
    issues.push('平均chunk过小 (<200字符)，可能丢失上下文')
    score -= 20
  } else if (chunked.stats.avgChunkSize > 1000) {
    issues.push('平均chunk过大 (>1000字符)，检索精度降低')
    score -= 15
  }
  
  // 检查: 重叠率
  if (chunked.stats.overlapRatio < 10) {
    issues.push('重叠率过低 (<10%)，边界语义可能断裂')
    score -= 15
  }
  
  // 检查: 边界保存率
  if (chunked.stats.boundaryPreservationRate < 70) {
    issues.push('边界保存率低 (<70%)，段落硬切断较多')
    score -= 10
  }
  
  // 检查: chunk数量合理
  if (chunked.totalChunks === 0) {
    issues.push('无有效chunk')
    score = 0
  }
  
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D'
  return { score, grade, issues }
}

// ═══════════════════════════════════════════════════════════
// 简易嵌入 (hash-BOW, Phase 1)
// ═══════════════════════════════════════════════════════════

export function embedChunk(text: string, dim: number = 256): number[] {
  const vec = new Array(dim).fill(0)
  const tokens = text.toLowerCase()
    .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
    .split(/[\s]+/)
    .filter(t => t.length >= 2)
  
  for (const token of tokens) {
    let h = 0
    for (let i = 0; i < token.length; i++) {
      h = ((h << 5) - h + token.charCodeAt(i)) | 0
    }
    vec[Math.abs(h) % dim] += 1
  }
  
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
  if (mag > 0) for (let i = 0; i < dim; i++) vec[i] /= mag
  return vec
}

export function chunkSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

console.log('[RAGChunker] 语义切片引擎已就绪 (chunk=' + CHUNK_SIZE + ', overlap=' + CHUNK_OVERLAP + ')')
