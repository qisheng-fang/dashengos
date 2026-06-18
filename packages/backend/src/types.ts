// packages/backend/src/types.ts · 全局共享类型
// 主要解决 Fastify decorate('sqlite', ...) 后的类型访问
import type { Database } from 'better-sqlite3'

export type SqliteDb = Database

export interface AuthUser {
  id: string
  role: 'ADMIN' | 'USER' | 'GUEST'
  scopes: string[]
}
