// packages/backend/src/cache/redis.ts · v0.3 spec §13
// Redis client + namespace + 雪崩/击穿/穿透保护
// Phase 2 (2026-06-17): Redis 改为可选依赖 — 连不上不 crash，降级为 no-cache

import Redis from 'ioredis'
import { config } from '../config.js'
import { logger } from '../core/logger.js'

const NS = config.REDIS_NAMESPACE

// Redis 连接状态 — 可选依赖，连不上降级
let _redis: Redis | null = null
let _connected = false

function getRedis(): Redis | null {
  return _connected ? _redis : null
}

export function isRedisConnected(): boolean {
  return _connected
}

// 尝试连接 Redis，失败不 crash
try {
  _redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    retryStrategy: () => null, // 不重试
    connectTimeout: 3000,
  })

  // 等待初始连接
  _redis.on('connect', () => {
    _connected = true
    logger.info('redis connected', { url: config.REDIS_URL })
  })

  _redis.on('error', (err: Error) => {
    if (!_connected) {
      logger.warn('redis unavailable — running in no-cache mode', { err: err.message, url: config.REDIS_URL })
    }
    _connected = false
  })

  _redis.on('close', () => {
    _connected = false
    logger.info('redis connection closed')
  })

  // Phase 2: 异步连接，不阻塞启动
  _redis.connect().catch(() => {
    logger.warn('redis connect failed — running in no-cache mode')
  })
} catch (err) {
  logger.warn('redis init failed — running in no-cache mode', { err: (err as Error).message })
  _redis = null
  _connected = false
}

// Key 加 namespace
export function k(parts: (string | number)[]): string {
  return [NS, ...parts].join(':')
}

// TTL 加随机抖动 (±10% 防雪崩)
export function jitteredTtl(base: number): number {
  return base + Math.floor(Math.random() * base * 0.1)
}

// singleflight (防击穿)
const inflight = new Map<string, Promise<unknown>>()

export async function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key)
  if (existing) return existing as Promise<T>
  const p = fn().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

// cachedGet (防穿透: 空值缓存) — Redis 不可用时直接调 loader
export async function cachedGet<T>(key: string, loader: () => Promise<T | null>, ttl = 300): Promise<T | null> {
  const r = getRedis()
  if (!r) return loader()

  try {
    const cached = await r.get(key)
    if (cached === '__NULL__') return null
    if (cached !== null) return JSON.parse(cached) as T
  } catch {
    return loader()
  }

  return singleflight(key, async () => {
    const loaded = await loader()
    if (loaded === null) {
      try { await r.set(key, '__NULL__', 'EX', 60) } catch { /* noop */ }
      return null
    }
    try { await r.set(key, JSON.stringify(loaded), 'EX', jitteredTtl(ttl)) } catch { /* noop */ }
    return loaded
  })
}

// Pub/Sub (高严重度 audit 推送) — Redis 不可用时静默丢弃
export async function publishAudit(payload: unknown): Promise<void> {
  const r = getRedis()
  if (!r) return
  try { await r.publish('audit:critical', JSON.stringify(payload)) } catch { /* noop */ }
}

// Phase 2: 优雅关闭时断开
export async function disconnect(): Promise<void> {
  const r = getRedis()
  if (r) {
    try { await r.quit() } catch { /* noop */ }
    _connected = false
  }
}

// Phase 2: 健康检查用
export async function ping(): Promise<boolean> {
  const r = getRedis()
  if (!r) return false
  try {
    const result = await r.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}
