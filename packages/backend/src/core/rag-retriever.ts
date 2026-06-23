// packages/backend/src/core/rag-retriever.ts · DaShengOS v6.0
// 混合检索引擎 — BM25 + 语义 + 重排序 + 查询改写
// 2026-06-23

import { embedText, embedBatch, cosineSimilarity, getEmbedderStatus } from './rag-embedder.js'
import { chunkDocument, expandChunkContext, type TextChunk } from './rag-chunker.js'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface SearchResult {
  chunk: TextChunk
  score: number            // 综合分数 0-100
  bm25Score: number        // 0-50
  semanticScore: number    // 0-50
  rerankScore?: number     // 0-50 (重排序后)
  rank: number
}

export interface RewrittenQuery {
  original: string
  expanded: string[]       // 改写后的多个查询
  keywords: string[]
}

export interface RetrievalResult {
  query: RewrittenQuery
  results: SearchResult[]
  stats: {
    totalChunks: number
    candidatesRetrieved: number
    candidatesReranked: number
    latencyMs: number
    engine: string
  }
}

// ═══════════════════════════════════════════════════════════
// BM25 实现 (Okapi BM25)
// ═══════════════════════════════════════════════════════════

class BM25Index {
  private k1 = 1.5
  private b = 0.75
  private documents: string[] = []
  private docLengths: number[] = []
  private avgDocLength = 0
  private termFreqs: Map<string, number[]> = new Map() // term → [freq per doc]
  private docFreqs: Map<string, number> = new Map()    // term → doc count
  private totalDocs = 0

  index(documents: string[]): void {
    this.documents = documents
    this.totalDocs = documents.length
    this.docLengths = documents.map(d => d.length)
    this.avgDocLength = this.docLengths.reduce((s, l) => s + l, 0) / Math.max(1, this.totalDocs)
    this.termFreqs.clear()
    this.docFreqs.clear()

    for (let i = 0; i < documents.length; i++) {
      const terms = this.tokenize(documents[i])
      const termCount = new Map<string, number>()
      for (const t of terms) {
        termCount.set(t, (termCount.get(t) || 0) + 1)
      }
      for (const [term, freq] of termCount) {
        if (!this.termFreqs.has(term)) this.termFreqs.set(term, new Array(this.totalDocs).fill(0))
        this.termFreqs.get(term)![i] = freq
        this.docFreqs.set(term, (this.docFreqs.get(term) || 0) + 1)
      }
    }
  }

  search(query: string, topK = 20): Array<{ docIndex: number; score: number }> {
    const queryTerms = this.tokenize(query)
    const scores: number[] = new Array(this.totalDocs).fill(0)

    for (const term of queryTerms) {
      const df = this.docFreqs.get(term) || 0
      if (df === 0) continue
      const idf = Math.log(1 + (this.totalDocs - df + 0.5) / (df + 0.5))
      const tfs = this.termFreqs.get(term) || []

      for (let i = 0; i < this.totalDocs; i++) {
        const tf = tfs[i] || 0
        if (tf === 0) continue
        const docLen = this.docLengths[i] || 1
        const score = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * docLen / this.avgDocLength))
        scores[i] += score
      }
    }

    return scores
      .map((score, docIndex) => ({ docIndex, score }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
      .split(/[\s]+/)
      .filter(t => t.length >= 2)
  }
}

// ═══════════════════════════════════════════════════════════
// 查询改写
// ═══════════════════════════════════════════════════════════

export function rewriteQuery(query: string): RewrittenQuery {
  const keywords = query
    .replace(/[，。！？、；：""''（）\s,.\-!?;:'"()[\]{}]+/g, ' ')
    .split(' ')
    .filter(k => k.length >= 2)
    .slice(0, 10)

  // 生成改写变体
  const expanded: string[] = [query]

  // 变体1: 去掉问句形式
  const declarative = query.replace(/^(什么是|怎么|如何|为什么|帮我|请|能不能|可以)/g, '').trim()
  if (declarative !== query && declarative.length > 3) expanded.push(declarative)

  // 变体2: 关键词组合
  if (keywords.length >= 2) {
    expanded.push(keywords.join(' '))
  }

  // 变体3: 加 "总结" "分析" 后缀
  if (!query.includes('总结') && !query.includes('分析')) {
    expanded.push(query + ' 总结分析')
  }

  return { original: query, expanded: [...new Set(expanded)], keywords }
}

// ═══════════════════════════════════════════════════════════
// 重排序 (Cross-encoder 模拟)
// ═══════════════════════════════════════════════════════════

function rerankCandidates(
  query: string,
  candidates: SearchResult[]
): SearchResult[] {
  // 基于查询-文档词重叠的重排序
  const queryTerms = new Set(
    query.toLowerCase().replace(/[^\w\u4e00-\u9fff\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2)
  )

  for (const candidate of candidates) {
    const chunkTerms = candidate.chunk.content.toLowerCase().replace(/[^\w\u4e00-\u9fff\s]/g, ' ').split(/\s+/)
    
    // Term overlap ratio
    const overlapCount = chunkTerms.filter(t => queryTerms.has(t)).length
    const overlapRatio = queryTerms.size > 0 ? overlapCount / queryTerms.size : 0
    
    // Position bias: 靠前的 chunk 通常更重要
    const positionBias = Math.max(0, 1 - candidate.chunk.index / Math.max(1, candidates.length))
    
    // Exact match bonus
    const exactMatch = candidate.chunk.content.includes(query) ? 0.3 : 0
    
    candidate.rerankScore = Math.round((overlapRatio * 30 + positionBias * 10 + exactMatch * 10) * 10) / 10
    candidate.score = candidate.bm25Score + candidate.semanticScore + (candidate.rerankScore || 0)
  }

  return candidates.sort((a, b) => b.score - a.score)
}

// ═══════════════════════════════════════════════════════════
// 核心: 混合检索
// ═══════════════════════════════════════════════════════════

export async function hybridSearch(
  query: string,
  documents: Array<{ text: string; source: string; section?: string }>,
  options?: {
    topK?: number
    semanticWeight?: number    // 语义权重 0-1, 默认 0.4
    enableRerank?: boolean
    enableQueryRewrite?: boolean
  }
): Promise<RetrievalResult> {
  const t0 = Date.now()
  const topK = options?.topK || 10
  const semanticWeight = options?.semanticWeight ?? 0.4
  const enableRerank = options?.enableRerank ?? true
  const enableQueryRewrite = options?.enableQueryRewrite ?? true

  // 1. 查询改写
  const rewritten = enableQueryRewrite ? rewriteQuery(query) : { original: query, expanded: [query], keywords: [] as string[] }

  // 2. 文档切片
  const allChunks: TextChunk[] = []
  for (const doc of documents) {
    const chunked = chunkDocument(doc.text, doc.source, { section: doc.section })
    allChunks.push(...chunked.chunks)
  }

  if (allChunks.length === 0) {
    return { query: rewritten, results: [], stats: { totalChunks: 0, candidatesRetrieved: 0, candidatesReranked: 0, latencyMs: Date.now() - t0, engine: 'none' } }
  }

  // 3. BM25 检索 (keyword)
  const bm25 = new BM25Index()
  bm25.index(allChunks.map(c => c.content))
  
  // 合并所有改写查询的 BM25 结果
  const bm25Results = new Map<number, number>()
  for (const eq of rewritten.expanded) {
    const results = bm25.search(eq, topK * 2)
    for (const r of results) {
      bm25Results.set(r.docIndex, Math.max(bm25Results.get(r.docIndex) || 0, r.score))
    }
  }

  // 4. 语义检索
  const queryVec = await embedText(rewritten.original)
  const chunkVecs = await embedBatch(allChunks.map(c => c.content))
  
  const semanticScores = new Map<number, number>()
  for (let i = 0; i < allChunks.length; i++) {
    const sim = cosineSimilarity(queryVec.vector, chunkVecs[i].vector)
    if (sim > 0.15) {
      semanticScores.set(i, sim)
    }
  }

  // 5. 融合 BM25 + 语义 (加权求和)
  const bm25Max = Math.max(1, ...bm25Results.values())
  const candidates: SearchResult[] = []

  for (let i = 0; i < allChunks.length; i++) {
    const bm25Score = ((bm25Results.get(i) || 0) / bm25Max) * 50 // 归一化到 0-50
    const semanticScore = (semanticScores.get(i) || 0) * 50 // 0-50
    const combinedScore = bm25Score * (1 - semanticWeight) + semanticScore * semanticWeight

    if (bm25Score > 0 || semanticScore > 5) {
      candidates.push({
        chunk: allChunks[i],
        score: combinedScore,
        bm25Score: Math.round(bm25Score * 10) / 10,
        semanticScore: Math.round(semanticScore * 10) / 10,
        rank: 0,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const topCandidates = candidates.slice(0, topK * 2)

  // 6. 重排序
  const rerankedCandidates = enableRerank 
    ? rerankCandidates(rewritten.original, topCandidates)
    : topCandidates

  // 7. 上下文扩展 (Anthropic Contextual Retrieval)
  const targetIndices = rerankedCandidates.slice(0, topK).map(c => c.chunk.index)
  const expandedChunks = expandChunkContext(allChunks, targetIndices, 1)
  const expandedIndices = new Set(expandedChunks.map(c => c.index))

  // 重新标记排名
  const finalResults = rerankedCandidates
    .filter(c => expandedIndices.has(c.chunk.index))
    .slice(0, topK)
    .map((c, i) => ({ ...c, rank: i + 1 }))

  return {
    query: rewritten,
    results: finalResults,
    stats: {
      totalChunks: allChunks.length,
      candidatesRetrieved: candidates.length,
      candidatesReranked: topCandidates.length,
      latencyMs: Date.now() - t0,
      engine: getEmbedderStatus().engine,
    },
  }
}

// ═══════════════════════════════════════════════════════════
// RAGAS 忠实度评估
// ═══════════════════════════════════════════════════════════

export interface RagasScore {
  faithfulness: number    // 0-1: 回答是否基于检索到的上下文
  answerRelevance: number // 0-1: 回答与问题的相关度
  contextPrecision: number // 0-1: 检索到的上下文精确度
  contextRecall: number   // 0-1: 检索到的上下文召回率
  overall: number         // 0-100
  grade: 'A' | 'B' | 'C' | 'D'
}

export function evaluateRagas(
  query: string,
  answer: string,
  retrievedChunks: TextChunk[],
  allChunks: TextChunk[]
): RagasScore {
  // Faithfulness: 回答中有多少内容能在检索到的上下文中找到
  const answerSentences = answer.split(/[。！？\n]/).filter(s => s.length > 5)
  let faithfulCount = 0
  const allRetrievedText = retrievedChunks.map(c => c.content).join(' ')
  
  for (const sentence of answerSentences) {
    // 检查句子中的关键词是否出现在检索上下文中
    const keywords = sentence.replace(/[，。！？\s]/g, '').slice(0, 10)
    if (keywords.length >= 3 && allRetrievedText.includes(keywords)) {
      faithfulCount++
    }
  }
  const faithfulness = answerSentences.length > 0 ? faithfulCount / answerSentences.length : 0

  // Answer Relevance: 回答与查询的相关度
  const queryTerms = new Set(query.replace(/[^\w\u4e00-\u9fff]/g, '').split('').filter(c => c.length > 0))
  const answerTerms = new Set(answer.replace(/[^\w\u4e00-\u9fff]/g, '').split('').filter(c => c.length > 0))
  let overlap = 0
  for (const t of queryTerms) if (answerTerms.has(t)) overlap++
  const answerRelevance = queryTerms.size > 0 ? overlap / queryTerms.size : 0

  // Context Precision: 检索到的chunk中有多少是相关的
  const relevantChunks = retrievedChunks.filter(c => {
    const chunkTerms = c.content.replace(/[^\w\u4e00-\u9fff]/g, '')
    let hits = 0
    for (const t of queryTerms) if (chunkTerms.includes(t)) hits++
    return hits >= 2
  })
  const contextPrecision = retrievedChunks.length > 0 ? relevantChunks.length / retrievedChunks.length : 0

  // Context Recall: 所有相关chunk中有多少被检索到
  const allRelevantChunks = allChunks.filter(c => {
    const chunkTerms = c.content.replace(/[^\w\u4e00-\u9fff]/g, '')
    let hits = 0
    for (const t of queryTerms) if (chunkTerms.includes(t)) hits++
    return hits >= 2
  })
  const contextRecall = allRelevantChunks.length > 0 ? relevantChunks.length / allRelevantChunks.length : 0

  const overall = Math.round(faithfulness * 35 + answerRelevance * 25 + contextPrecision * 20 + contextRecall * 20)
  const grade: 'A' | 'B' | 'C' | 'D' = overall >= 80 ? 'A' : overall >= 60 ? 'B' : overall >= 40 ? 'C' : 'D'

  return {
    faithfulness: Math.round(faithfulness * 1000) / 1000,
    answerRelevance: Math.round(answerRelevance * 1000) / 1000,
    contextPrecision: Math.round(contextPrecision * 1000) / 1000,
    contextRecall: Math.round(contextRecall * 1000) / 1000,
    overall,
    grade,
  }
}

console.log('[RagRetriever] 混合检索(BM25+语义+重排序+查询改写+RAGAS)已就绪')
