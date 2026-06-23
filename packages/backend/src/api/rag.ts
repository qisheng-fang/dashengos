import type { FastifyInstance } from 'fastify'
import { chunkDocument, chunkDocuments, evaluateChunking } from '../core/rag-chunker.js'
import { embedText, embedBatch, getEmbedderStatus } from '../core/rag-embedder.js'
import { hybridSearch, rewriteQuery, evaluateRagas } from '../core/rag-retriever.js'

export async function ragRoutes(app: FastifyInstance) {
  // Chunking
  app.post('/chunk', { preHandler: [app.authenticate] }, async (req) => {
    const { text, source, chunkSize, chunkOverlap } = req.body as any
    if (!text || !source) return { error: 'text and source required' }
    const result = chunkDocument(text, source, { chunkSize, chunkOverlap })
    return { ...result, evaluation: evaluateChunking(result) }
  })

  app.post('/chunk-batch', { preHandler: [app.authenticate] }, async (req) => {
    const { documents, chunkSize, chunkOverlap } = req.body as any
    if (!documents?.length) return { error: 'documents array required' }
    const results = chunkDocuments(documents, { chunkSize, chunkOverlap })
    return { documents: results.map(r => ({ ...r, evaluation: evaluateChunking(r) })) }
  })

  // Embedding
  app.get('/embedder-status', { preHandler: [app.authenticate] }, async () => {
    return getEmbedderStatus()
  })

  app.post('/embed', { preHandler: [app.authenticate] }, async (req) => {
    const { text } = req.body as any
    if (!text) return { error: 'text required' }
    const result = await embedText(text)
    return { ...result, vectorPreview: result.vector.slice(0, 5) }
  })

  app.post('/embed-batch', { preHandler: [app.authenticate] }, async (req) => {
    const { texts } = req.body as any
    if (!texts?.length) return { error: 'texts array required' }
    const results = await embedBatch(texts)
    return { count: results.length, engine: results[0]?.engine, avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / results.length) }
  })

  // Hybrid Search
  app.post('/search', { preHandler: [app.authenticate] }, async (req) => {
    const { query, documents, topK, semanticWeight, enableRerank, enableQueryRewrite } = req.body as any
    if (!query || !documents?.length) return { error: 'query and documents required' }
    return hybridSearch(query, documents, { topK, semanticWeight, enableRerank, enableQueryRewrite })
  })

  // Query Rewriting
  app.post('/rewrite-query', { preHandler: [app.authenticate] }, async (req) => {
    const { query } = req.body as any
    if (!query) return { error: 'query required' }
    return rewriteQuery(query)
  })

  // RAGAS Evaluation
  app.post('/evaluate', { preHandler: [app.authenticate] }, async (req) => {
    const { query, answer, retrievedChunks, allChunks } = req.body as any
    if (!query || !answer) return { error: 'query and answer required' }
    return evaluateRagas(query, answer, retrievedChunks || [], allChunks || retrievedChunks || [])
  })
}
