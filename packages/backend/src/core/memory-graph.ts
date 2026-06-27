// packages/backend/src/core/memory-graph.ts · DaShengOS v8.2
// Entity-Relation Graph — 对标 OpenClaw Memory Graph
// 实体-关系建模，支持关联检索和路径查询
// 2026-06-28

import { sqlite } from '../storage/db.js'

// Types
export interface MemoryEntity {
  id: string
  userId: string
  name: string           // entity name (e.g. "Python", "DaShengOS", "Qisheng")
  type: 'person' | 'project' | 'concept' | 'tool' | 'skill' | 'document' | 'event'
  attributes: Record<string, string>  // key-value metadata
  importance: number     // 0-1
  confidence: number     // 0-1, how sure we are about this entity
  firstSeen: string
  lastSeen: string
  occurrenceCount: number
}

export interface MemoryRelation {
  id: string
  userId: string
  sourceId: string       // entity ID
  targetId: string       // entity ID
  relationType: string   // e.g. "uses", "depends_on", "part_of", "creates", "knows", "prefers"
  weight: number         // 0-1, strength of relation
  evidence: string       // what conversation/context proved this relation
  firstSeen: string
  lastSeen: string
}

export interface GraphQueryResult {
  entities: MemoryEntity[]
  relations: MemoryRelation[]
  paths: Array<{ entities: string[]; relations: string[]; totalWeight: number }>
}

// Initialize tables
export function initMemoryGraphTables(): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'concept',
      attributes TEXT DEFAULT '{}',
      importance REAL DEFAULT 0.5,
      confidence REAL DEFAULT 0.5,
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      occurrence_count INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_memory_entities_user ON memory_entities(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_type ON memory_entities(type);

    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL DEFAULT 0.5,
      evidence TEXT DEFAULT '',
      first_seen TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_id) REFERENCES memory_entities(id),
      FOREIGN KEY (target_id) REFERENCES memory_entities(id)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_relations_user ON memory_relations(user_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_src ON memory_relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_tgt ON memory_relations(target_id);
  `)
  console.log('[MemoryGraph] Tables initialized')
}

// Upsert entity (create or update)
export function upsertEntity(
  userId: string,
  name: string,
  type: MemoryEntity['type'],
  attributes: Record<string, string> = {},
  importance = 0.5,
  confidence = 0.5
): string {
  // Check if entity exists by name+type
  const existing = sqlite.prepare(
    'SELECT id, occurrence_count FROM memory_entities WHERE user_id = ? AND name = ? AND type = ?'
  ).get(userId, name, type) as { id: string; occurrence_count: number } | undefined

  if (existing) {
    // Update: increment count, update last_seen, boost importance
    const newImportance = Math.min(1, Math.max(importance, 0.5 + existing.occurrence_count * 0.02))
    sqlite.prepare(`
      UPDATE memory_entities 
      SET last_seen = datetime('now'), occurrence_count = occurrence_count + 1,
          importance = ?, confidence = MAX(confidence, ?), attributes = ?
      WHERE id = ?
    `).run(newImportance, confidence, JSON.stringify(attributes), existing.id)
    return existing.id
  }

  // Create new
  const id = 'ent_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  sqlite.prepare(`
    INSERT INTO memory_entities (id, user_id, name, type, attributes, importance, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, type, JSON.stringify(attributes), importance, confidence)
  return id
}

// Add relation between two entities
export function addRelation(
  userId: string,
  sourceId: string,
  targetId: string,
  relationType: string,
  weight = 0.5,
  evidence = ''
): string {
  // Check if relation exists
  const existing = sqlite.prepare(
    'SELECT id FROM memory_relations WHERE user_id = ? AND source_id = ? AND target_id = ? AND relation_type = ?'
  ).get(userId, sourceId, targetId, relationType) as { id: string } | undefined

  if (existing) {
    sqlite.prepare(`
      UPDATE memory_relations SET last_seen = datetime('now'), weight = MAX(weight, ?), evidence = ?
      WHERE id = ?
    `).run(weight, evidence || '', existing.id)
    return existing.id
  }

  const id = 'rel_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
  sqlite.prepare(`
    INSERT INTO memory_relations (id, user_id, source_id, target_id, relation_type, weight, evidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, sourceId, targetId, relationType, weight, evidence || '')
  return id
}

// Extract entities and relations from conversation text (simple NLP)
export function extractFromConversation(
  userId: string,
  text: string,
  evidence: string
): { entities: string[]; relations: string[] } {
  const entityIds: string[] = []
  const relationIds: string[] = []

  // Simple patterns to detect entities
  const patterns: Array<{ regex: RegExp; type: MemoryEntity['type'] }> = [
    { regex: /\b(Python|TypeScript|JavaScript|Rust|Go|Java|SQL|React|Vue|Node\.js|Fastify|Docker|Redis|SQLite)\b/gi, type: 'tool' },
    { regex: /\b(DaShengOS|Hermes|OpenClaw|Codex|Claude|GPT|LLM|LangGraph)\b/gi, type: 'project' },
    { regex: /\b(Agent|MCP|API|RAG|CoT|embedding|pipeline|orchestrat)\w*\b/gi, type: 'concept' },
    { regex: /\b(用户|User|客户|Client|Partner|团队)\b/gi, type: 'person' },
  ]

  const foundEntities = new Map<string, MemoryEntity['type']>()
  for (const { regex, type } of patterns) {
    const matches = text.matchAll(regex)
    for (const m of matches) {
      const name = m[0]
      if (!foundEntities.has(name)) {
        foundEntities.set(name, type)
      }
    }
  }

  // Create entities
  for (const [name, type] of foundEntities) {
    const id = upsertEntity(userId, name, type, {}, 0.6, 0.7)
    entityIds.push(id)
  }

  // Create relations between co-occurring entities
  const entityList = Array.from(foundEntities.keys())
  for (let i = 0; i < entityList.length; i++) {
    for (let j = i + 1; j < entityList.length; j++) {
      // Detect relation type between co-occurring entities
      const relType = inferRelationType(entityList[i], entityList[j], foundEntities.get(entityList[i])!, foundEntities.get(entityList[j])!)
      const sourceId = entityIds[i]
      const targetId = entityIds[j]
      if (sourceId && targetId) {
        const rid = addRelation(userId, sourceId, targetId, relType, 0.5, evidence)
        relationIds.push(rid)
      }
    }
  }

  return { entities: entityIds, relations: relationIds }
}

function inferRelationType(_nameA: string, _nameB: string, typeA: MemoryEntity['type'], typeB: MemoryEntity['type']): string {
  if (typeA === 'project' && typeB === 'tool') return 'uses'
  if (typeA === 'tool' && typeB === 'project') return 'used_by'
  if (typeA === 'project' && typeB === 'project') return 'competes_with'
  if (typeA === 'concept' && typeB === 'tool') return 'related_to'
  if (typeA === 'tool' && typeB === 'concept') return 'implements'
  if (typeA === 'person' && typeB === 'tool') return 'prefers'
  if (typeA === 'person' && typeB === 'project') return 'works_on'
  return 'related_to'
}

// Query: find all entities related to a given entity
export function queryRelatedEntities(
  userId: string,
  entityId: string,
  maxDepth = 2
): GraphQueryResult {
  const entities = new Map<string, MemoryEntity>()
  const relations: MemoryRelation[] = []

  // BFS from start entity
  let frontier = [entityId]
  const visited = new Set<string>([entityId])

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const nextFrontier: string[] = []

    for (const eid of frontier) {
      const entity = sqlite.prepare(
        'SELECT * FROM memory_entities WHERE id = ? AND user_id = ?'
      ).get(eid, userId) as any
      if (entity) {
        entities.set(eid, {
          id: entity.id, userId: entity.user_id, name: entity.name, type: entity.type,
          attributes: JSON.parse(entity.attributes || '{}'), importance: entity.importance,
          confidence: entity.confidence, firstSeen: entity.first_seen, lastSeen: entity.last_seen,
          occurrenceCount: entity.occurrence_count,
        })
      }

      // Find all relations
      const rels = sqlite.prepare(
        'SELECT * FROM memory_relations WHERE user_id = ? AND (source_id = ? OR target_id = ?)'
      ).all(userId, eid, eid) as any[]

      for (const rel of rels) {
        relations.push({
          id: rel.id, userId: rel.user_id, sourceId: rel.source_id, targetId: rel.target_id,
          relationType: rel.relation_type, weight: rel.weight, evidence: rel.evidence || '',
          firstSeen: rel.first_seen, lastSeen: rel.last_seen,
        })

        const otherId = rel.source_id === eid ? rel.target_id : rel.source_id
        if (!visited.has(otherId)) {
          visited.add(otherId)
          nextFrontier.push(otherId)
        }
      }
    }

    frontier = nextFrontier
  }

  // Build paths
  const paths = buildPaths(entityId, Array.from(entities.keys()), relations)

  return { entities: Array.from(entities.values()), relations, paths }
}

function buildPaths(
  startId: string,
  entityIds: string[],
  relations: MemoryRelation[]
): Array<{ entities: string[]; relations: string[]; totalWeight: number }> {
  const paths: Array<{ entities: string[]; relations: string[]; totalWeight: number }> = []

  for (const targetId of entityIds) {
    if (targetId === startId) continue

    // Find direct relation
    const direct = relations.find(r =>
      (r.sourceId === startId && r.targetId === targetId) ||
      (r.sourceId === targetId && r.targetId === startId)
    )
    if (direct) {
      paths.push({ entities: [startId, targetId], relations: [direct.id], totalWeight: direct.weight })
    }
  }

  paths.sort((a, b) => b.totalWeight - a.totalWeight)
  return paths.slice(0, 20)
}

// Semantic search across entities
export function searchEntities(userId: string, query: string, limit = 10): MemoryEntity[] {
  const rows = sqlite.prepare(`
    SELECT * FROM memory_entities WHERE user_id = ? AND name LIKE ? 
    ORDER BY importance DESC, last_seen DESC LIMIT ?
  `).all(userId, '%' + query + '%', limit) as any[]

  return rows.map((r: any) => ({
    id: r.id, userId: r.user_id, name: r.name, type: r.type,
    attributes: JSON.parse(r.attributes || '{}'), importance: r.importance,
    confidence: r.confidence, firstSeen: r.first_seen, lastSeen: r.last_seen,
    occurrenceCount: r.occurrence_count,
  }))
}

// Get entity stats
export function getGraphStats(userId: string): { entityCount: number; relationCount: number; topEntities: Array<{ name: string; type: string; importance: number }> } {
  const eCount = (sqlite.prepare('SELECT COUNT(*) as c FROM memory_entities WHERE user_id = ?').get(userId) as any)?.c || 0
  const rCount = (sqlite.prepare('SELECT COUNT(*) as c FROM memory_relations WHERE user_id = ?').get(userId) as any)?.c || 0
  const top = sqlite.prepare(
    'SELECT name, type, importance FROM memory_entities WHERE user_id = ? ORDER BY importance DESC LIMIT 10'
  ).all(userId) as any[]

  return { entityCount: eCount, relationCount: rCount, topEntities: top }
}

// Periodic decay: reduce importance of old, unreferenced entities
export function decayEntities(userId: string, daysThreshold = 30): number {
  const result = sqlite.prepare(`
    UPDATE memory_entities 
    SET importance = MAX(0.1, importance * 0.9)
    WHERE user_id = ? AND last_seen < datetime('now', '-' || ? || ' days') AND occurrence_count < 3
  `).run(userId, daysThreshold)
  return result.changes
}

console.log('[MemoryGraph] Entity-Relation graph module loaded')
