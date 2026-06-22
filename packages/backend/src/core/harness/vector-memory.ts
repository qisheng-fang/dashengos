// packages/backend/src/core/harness/vector-memory.ts
// DaShengOS Vector Memory Engine — powered by alibaba/zvec
// 2026-06-22 · 语义向量搜索替代关键词匹配
//
// 架构:
//   Phase 1 (当前): 纯 JS 256-dim 词袋向量 (零依赖，立即可用)
//   Phase 2:        切换到 zvec 原生引擎 (需 C++ 编译通过后)
//
// zvec 集成点: 替换 embedText() → zvec 内置 embedding
//             替换 similarity search → zvec Collection.search()

import { sqlite } from '../../storage/db.js'

// ─── 向量维度 ──────────────────────────────────────────
const VEC_DIM = 256

// ─── 嵌入表 DDL ────────────────────────────────────────
function ensureEmbeddingTable(): void {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS memory_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id INTEGER NOT NULL UNIQUE,
      vec_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES cross_session_memory(id) ON DELETE CASCADE
    )
  `).run()
  sqlite.prepare('CREATE INDEX IF NOT EXISTS idx_me_memory ON memory_embeddings(memory_id)').run()
}

// ─── 简易文本嵌入 (Zero-dependency) ─────────────────────
// 策略: Unicode tokenizer + hash → 256-dim 向量
// zvec 替换: 改这里为 zvec 的 embed() 调用即可

function tokenize(text: string): string[] {
  // 中文: 按字符+双字符组合; 英文: 按空格分词
  const tokens: string[] = []
  const cleaned = text.toLowerCase().replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
  
  // 英文 tokens
  const enTokens = cleaned.match(/[a-z0-9]+/g) || []
  tokens.push(...enTokens)
  
  // 中文 bigram tokens
  const zhChars = cleaned.match(/[\u4e00-\u9fff]/g) || []
  for (let i = 0; i < zhChars.length; i++) {
    tokens.push(zhChars[i])
    if (i + 1 < zhChars.length) tokens.push(zhChars[i] + zhChars[i + 1])
  }
  
  return tokens
}

function hashToken(token: string): number {
  let h = 0
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) - h + token.charCodeAt(i)) | 0
  }
  return Math.abs(h) % VEC_DIM
}

export function embedText(text: string): number[] {
  const vec = new Array(VEC_DIM).fill(0)
  const tokens = tokenize(text)
  if (tokens.length === 0) return vec
  
  for (const token of tokens) {
    vec[hashToken(token)] += 1
  }
  
  // L2 normalize
  const mag = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
  if (mag > 0) for (let i = 0; i < VEC_DIM; i++) vec[i] /= mag
  
  return vec
}

// ─── 余弦相似度 ─────────────────────────────────────────
export function cosineSimilarity(a: number[], b: number[]): number {
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

// ─── 索引记忆条目 ───────────────────────────────────────
export function indexMemoryEmbedding(memoryId: number, text: string): boolean {
  ensureEmbeddingTable()
  try {
    const vec = embedText(text)
    const vecJson = JSON.stringify(vec)
    sqlite.prepare(`
      INSERT OR REPLACE INTO memory_embeddings (memory_id, vec_json, created_at)
      VALUES (?, ?, ?)
    `).run(memoryId, vecJson, Date.now())
    return true
  } catch {
    return false
  }
}

// ─── 语义搜索 ───────────────────────────────────────────
export interface VectorSearchResult {
  memoryId: number
  score: number          // 0-1 余弦相似度
  summary: string
  category: string
  keywords: string[]
}

export function semanticSearch(query: string, userId: string, limit = 5): VectorSearchResult[] {
  ensureEmbeddingTable()
  const queryVec = embedText(query)

  try {
    const rows = sqlite.prepare(`
      SELECT m.id, m.summary, m.category, m.keywords, e.vec_json
      FROM cross_session_memory m
      JOIN memory_embeddings e ON e.memory_id = m.id
      WHERE m.user_id = ?
      ORDER BY m.created_at DESC LIMIT 200
    `).all(userId) as Array<{
      id: number; summary: string; category: string; keywords: string; vec_json: string
    }>

    const results: VectorSearchResult[] = []
    for (const row of rows) {
      try {
        const vec = JSON.parse(row.vec_json) as number[]
        const score = cosineSimilarity(queryVec, vec)
        if (score > 0.1) {
          results.push({
            memoryId: row.id,
            score: Math.round(score * 1000) / 1000,
            summary: row.summary,
            category: row.category,
            keywords: JSON.parse(row.keywords || '[]'),
          })
        }
      } catch { /* skip corrupt vectors */ }
    }

    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit)
  } catch {
    return []
  }
}

// ─── 混合搜索: 关键词 + 语义 ────────────────────────────
export function hybridSearch(
  query: string,
  userId: string,
  keywordResults: Array<{ id: number; summary: string; category: string; keywords: string[]; score: number }>,
  limit = 5
): Array<{ id: number; summary: string; category: string; keywords: string[]; score: number; semanticScore: number }> {
  const semantic = semanticSearch(query, userId, 20)
  const semanticMap = new Map(semantic.map(s => [s.memoryId, s.score]))

  const merged = keywordResults.map(kr => ({
    id: kr.id,
    summary: kr.summary,
    category: kr.category,
    keywords: kr.keywords,
    score: kr.score + (semanticMap.get(kr.id) || 0) * 15,
    semanticScore: semanticMap.get(kr.id) || 0,
  }))

  merged.sort((a, b) => b.score - a.score)
  return merged.slice(0, limit)
}

// ─── zvec 集成占位 ──────────────────────────────────────
// Phase 2: 当 zvec 编译通过后，替换以下实现:
//
// import { zvec } from 'zvec'
// const db = new zvec.DB('/tmp/dasheng/zvec')
// const col = db.createCollection('memory', { dimension: 768 })
//
// export function embedText(text: string): number[] {
//   return zvec.embed(text, { model: 'bge-small-zh' })
// }
//
// export function semanticSearch(query: string, userId: string, limit = 5) {
//   const qv = embedText(query)
//   return col.search(qv, { limit, filter: { user_id: userId } })
// }

console.log('[VectorMemory] 向量记忆引擎已初始化 (dim=' + VEC_DIM + ', mode=hash-bow)')
