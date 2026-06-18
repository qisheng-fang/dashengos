// packages/backend/src/core/logger.ts · Phase 2 (2026-06-17)
// 最小 logger wrapper — 不依赖 fastify instance，独立使用

export const logger = {
  info: (msg: unknown, meta?: Record<string, unknown>) => {
    console.log(JSON.stringify({ level: 'info', time: new Date().toISOString(), msg, ...meta }))
  },
  warn: (msg: unknown, meta?: Record<string, unknown>) => {
    console.warn(JSON.stringify({ level: 'warn', time: new Date().toISOString(), msg, ...meta }))
  },
  error: (msg: unknown, meta?: Record<string, unknown>) => {
    console.error(JSON.stringify({ level: 'error', time: new Date().toISOString(), msg, ...meta }))
  },
}
