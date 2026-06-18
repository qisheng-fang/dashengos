// packages/backend/src/core/audit.ts · v0.3 spec §16.8
// 结构化审计日志 + HMAC 签名 + Redis pub/sub

import { createHmac, randomBytes } from 'node:crypto'
import { ulid } from 'ulid'
import { sqlite } from '../storage/db.js'
import { publishAudit } from '../cache/redis.js'
import { config } from '../config.js'

let hmacSecret = randomBytes(32)

if (config.DASHENG_STRICT_SECURITY) {
  // 严格模式: 从环境读 secret (生产环境)
  hmacSecret = Buffer.from(config.AUDIT_LOG_HMAC_SECRET, 'utf-8')
}

export interface AuditEvent {
  type: string // api.call / tool.exec / sandbox.exec / injection.detected
  severity: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL'
  action: string
  user_id?: string
  session_id?: string
  target?: string
  args_json?: string
  result_summary?: string
  duration_ms?: number
  client_ip?: string
  user_agent?: string
}

export interface AuditLogEntry extends AuditEvent {
  id: string
  timestamp: number
  signature_hmac: string
}

function sign(id: string, timestamp: number, event: AuditEvent): string {
  const payload = JSON.stringify({ id, timestamp, ...event })
  return createHmac('sha256', hmacSecret).update(payload).digest('hex')
}

export const audit = {
  async log(event: AuditEvent): Promise<void> {
    const id = ulid()
    const timestamp = Date.now()
    const signature_hmac = sign(id, timestamp, event)

    // 异步写 SQLite (不阻塞主流程)
    try {
      sqlite
        .prepare(
          `INSERT INTO audit_logs (id, timestamp, user_id, session_id, type, severity, action,
         target, args_json, result_summary, duration_ms, client_ip, user_agent, signature_hmac)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          timestamp,
          event.user_id ?? null,
          event.session_id ?? null,
          event.type,
          event.severity,
          event.action,
          event.target ?? null,
          event.args_json ?? null,
          event.result_summary ?? null,
          event.duration_ms ?? null,
          event.client_ip ?? null,
          event.user_agent ?? null,
          signature_hmac,
        )
    } catch (err) {
      console.error('[AUDIT_FAILED]', err, event)
    }

    // 高严重度实时推送
    if (event.severity === 'CRITICAL' || event.severity === 'ERROR') {
      publishAudit({ id, timestamp, ...event }).catch(() => {
        /* silent */
      })
    }
  },

  async list(opts: {
    userId?: string
    sessionId?: string
    type?: string
    severity?: string
    from?: number
    to?: number
    limit?: number
    cursor?: number
  }): Promise<AuditLogEntry[]> {
    const limit = opts.limit ?? 50
    let sql = 'SELECT * FROM audit_logs WHERE 1=1'
    const params: unknown[] = []
    if (opts.userId) {
      sql += ' AND user_id = ?'
      params.push(opts.userId)
    }
    if (opts.sessionId) {
      sql += ' AND session_id = ?'
      params.push(opts.sessionId)
    }
    if (opts.type) {
      sql += ' AND type = ?'
      params.push(opts.type)
    }
    if (opts.severity) {
      sql += ' AND severity = ?'
      params.push(opts.severity)
    }
    if (opts.from) {
      sql += ' AND timestamp >= ?'
      params.push(opts.from)
    }
    if (opts.to) {
      sql += ' AND timestamp <= ?'
      params.push(opts.to)
    }
    if (opts.cursor) {
      sql += ' AND timestamp < ?'
      params.push(opts.cursor)
    }
    sql += ' ORDER BY timestamp DESC LIMIT ?'
    params.push(limit)
    return sqlite.prepare(sql).all(...params) as AuditLogEntry[]
  },
}
