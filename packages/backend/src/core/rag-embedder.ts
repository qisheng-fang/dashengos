// packages/backend/src/core/rag-embedder.ts · DaShengOS v6.0
// 真实语义嵌入引擎 — SiliconFlow bge-large-zh → hash-BOW 回退
// 2026-06-23

import { embedText as hashEmbed } from './harness/vector-memory.js'

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface EmbeddingResult {
  vector: number[]
  dim: number
  engine: 'siliconflow' | 'hash-bow'
  latencyMs: number
  tokensUsed: number
}

export interface EmbeddingCacheEntry {
  vector: number[]
  timestamp: number
}

// ═══════════════════════════════════════════════════════════
// LRU Cache (避免重复嵌入相同文本)
// ═══════════════════════════════════════════════════════════

const embeddingCache = new Map<string, EmbeddingCacheEntry>()
const MAX_CACHE_SIZE = 5000

function cacheKey(text: string): string {
  // 简单哈希作为缓存键
  let h = 0
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(16) + ':' + text.slice(0, 50)
}

function cacheGet(text: string): number[] | null {
  const key = cacheKey(text)
  const entry = embeddingCache.get(key)
  if (entry && Date.now() - entry.timestamp < 3600000) { // 1h TTL
    return entry.vector
  }
  return null
}

function cacheSet(text: string, vector: number[]): void {
  if (embeddingCache.size >= MAX_CACHE_SIZE) {
    // 删除最旧的 20%
    const keys = [...embeddingCache.keys()]
    for (let i = 0; i < Math.floor(MAX_CACHE_SIZE * 0.2); i++) {
      embeddingCache.delete(keys[i])
    }
  }
  embeddingCache.set(cacheKey(text), { vector, timestamp: Date.now() })
}

// ═══════════════════════════════════════════════════════════
// SiliconFlow Embedding API (bge-large-zh, 1024-dim)
// ═══════════════════════════════════════════════════════════

const SF_API_KEY = process.env.SILICONFLOW_API_KEY || ''
const SF_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1'
const SF_EMBED_MODEL = 'BAAI/bge-large-zh-v1.5'

let sfAvailable = !!SF_API_KEY

async function siliconflowEmbed(texts: string[]): Promise<number[][]> {
  if (!sfAvailable || !SF_API_KEY) throw new Error('SiliconFlow API key not configured')
  
  const resp = await fetch(`${SF_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SF_API_KEY}`,
    },
    body: JSON.stringify({
      model: SF_EMBED_MODEL,
      input: texts,
      encoding_format: 'float',
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!resp.ok) {
    const err = await resp.text().catch(() => '')
    if (resp.status === 401 || resp.status === 403) {
      sfAvailable = false
      throw new Error(`SiliconFlow auth failed: ${resp.status}`)
    }
    throw new Error(`SiliconFlow HTTP ${resp.status}: ${err.slice(0, 100)}`)
  }

  const data = await resp.json() as {
    data: Array<{ embedding: number[]; index: number }>
    usage: { total_tokens: number }
  }

  return data.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding)
}

// ═══════════════════════════════════════════════════════════
// 统一嵌入接口 (SiliconFlow → hash-BOW 回退)
// ═══════════════════════════════════════════════════════════

export async function embedText(text: string): Promise<EmbeddingResult> {
  // 1. 检查缓存
  const cached = cacheGet(text)
  if (cached) {
    return { vector: cached, dim: cached.length, engine: cached.length > 256 ? 'siliconflow' : 'hash-bow', latencyMs: 0, tokensUsed: 0 }
  }

  const t0 = Date.now()

  // 2. 尝试 SiliconFlow
  if (sfAvailable) {
    try {
      const vectors = await siliconflowEmbed([text])
      if (vectors.length > 0) {
        cacheSet(text, vectors[0])
        return { vector: vectors[0], dim: vectors[0].length, engine: 'siliconflow', latencyMs: Date.now() - t0, tokensUsed: Math.ceil(text.length / 2) }
      }
    } catch (e: any) {
      console.log('[RagEmbedder] SiliconFlow failed:', e.message?.slice(0, 80), '→ falling back to hash-BOW')
    }
  }

  // 3. 回退 hash-BOW
  const vec = hashEmbed(text)
  cacheSet(text, vec)
  return { vector: vec, dim: 256, engine: 'hash-bow', latencyMs: Date.now() - t0, tokensUsed: 0 }
}

export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  // 分离已缓存和需要嵌入的
  const results: EmbeddingResult[] = []
  const uncached: string[] = []
  const uncachedIndices: number[] = []

  for (let i = 0; i < texts.length; i++) {
    const cached = cacheGet(texts[i])
    if (cached) {
      results[i] = { vector: cached, dim: cached.length, engine: cached.length > 256 ? 'siliconflow' : 'hash-bow', latencyMs: 0, tokensUsed: 0 }
    } else {
      uncached.push(texts[i])
      uncachedIndices.push(i)
    }
  }

  if (uncached.length > 0) {
    const t0 = Date.now()
    let vectors: number[][] = []

    if (sfAvailable) {
      try {
        vectors = await siliconflowEmbed(uncached)
      } catch {
        // 回退
      }
    }

    if (vectors.length === 0) {
      vectors = uncached.map(t => hashEmbed(t))
    }

    for (let i = 0; i < uncached.length; i++) {
      const vec = vectors[i] || hashEmbed(uncached[i])
      cacheSet(uncached[i], vec)
      results[uncachedIndices[i]] = {
        vector: vec,
        dim: vec.length,
        engine: sfAvailable ? 'siliconflow' : 'hash-bow',
        latencyMs: vectors.length > 0 ? Math.round((Date.now() - t0) / uncached.length) : 0,
        tokensUsed: Math.ceil(uncached[i].length / 2),
      }
    }
  }

  return results.filter(Boolean)
}

// ═══════════════════════════════════════════════════════════
// 余弦相似度
// ═══════════════════════════════════════════════════════════

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * (b[i] || 0)
    magA += a[i] * a[i]
  }
  for (let i = 0; i < b.length; i++) magB += b[i] * b[i]
  if (magA === 0 || magB === 0) return 0
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

export function getEmbedderStatus(): { engine: string; available: boolean; dim: number } {
  return { engine: sfAvailable ? 'siliconflow' : 'hash-bow', available: sfAvailable, dim: sfAvailable ? 1024 : 256 }
}

console.log('[RagEmbedder] 嵌入引擎就绪: ' + (sfAvailable ? 'SiliconFlow bge-large-zh (1024-dim)' : 'Hash-BOW (256-dim)'))
