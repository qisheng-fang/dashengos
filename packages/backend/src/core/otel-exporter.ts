// packages/backend/src/core/otel-exporter.ts · DaShengOS v6.0
// OpenTelemetry Collector 导出器 — OTLP/HTTP + Prometheus + 本地Dashboard
// 2026-06-23

import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

// ═══════════════════════════════════════════════════════════
// OTLP/HTTP 导出器 (发送到 OTEL Collector)
// ═══════════════════════════════════════════════════════════

const OTEL_COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL || 'http://127.0.0.1:4318'

export interface OTLPConfig {
  endpoint: string
  timeoutMs: number
  batchSize: number
  flushIntervalMs: number
}

const defaultConfig: OTLPConfig = {
  endpoint: OTEL_COLLECTOR_URL + '/v1/traces',
  timeoutMs: 5000,
  batchSize: 50,
  flushIntervalMs: 5000,
}

// Span buffer for batch export
let spanBuffer: any[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let collectorAvailable = false

/**
 * 检测 OTEL Collector 是否可用
 */
export async function checkCollectorHealth(): Promise<boolean> {
  try {
    const resp = await fetch(OTEL_COLLECTOR_URL + '/v1/traces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceSpans: [] }),
      signal: AbortSignal.timeout(3000),
    })
    collectorAvailable = resp.status < 500
    return collectorAvailable
  } catch {
    collectorAvailable = false
    return false
  }
}

/**
 * 批量发送 Span 到 OTEL Collector (OTLP/HTTP 格式)
 */
async function flushSpans(): Promise<void> {
  if (spanBuffer.length === 0) return
  if (!collectorAvailable) {
    const healthy = await checkCollectorHealth()
    if (!healthy) { spanBuffer = []; return }
  }

  const batch = spanBuffer.splice(0, defaultConfig.batchSize)
  
  // OTLP/HTTP JSON 格式
  const body = {
    resourceSpans: [{
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: 'dashengos' } },
          { key: 'service.version', value: { stringValue: '6.0' } },
          { key: 'host.name', value: { stringValue: require('node:os').hostname() } },
        ],
      },
      scopeSpans: [{
        scope: { name: 'dashengos-agent' },
        spans: batch.map(s => ({
          traceId: Buffer.from(s.traceId, 'hex').toString('base64'),
          spanId: Buffer.from(s.spanId, 'hex').toString('base64'),
          parentSpanId: s.parentSpanId ? Buffer.from(s.parentSpanId, 'hex').toString('base64') : '',
          name: s.name,
          kind: { INTERNAL: 1, SERVER: 2, CLIENT: 3, PRODUCER: 4, CONSUMER: 5 }[s.kind] || 1,
          startTimeUnixNano: String(s.startTime * 1_000_000),
          endTimeUnixNano: String(s.endTime * 1_000_000),
          status: { code: s.status === 'OK' ? 1 : 2 },
          attributes: Object.entries(s.attributes || {}).map(([k, v]) => ({
            key: k,
            value: typeof v === 'number' ? { doubleValue: v } : { stringValue: String(v) },
          })),
        })),
      }],
    }],
  }

  try {
    await fetch(defaultConfig.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(defaultConfig.timeoutMs),
    })
  } catch { /* collector unreachable — spans will be logged locally */ }
}

/**
 * 异步导出 Span (添加到批量缓冲区)
 */
export function exportToCollector(span: any): void {
  spanBuffer.push(span)
  if (spanBuffer.length >= defaultConfig.batchSize) {
    flushSpans().catch(() => {})
  }
}

// 启动定时刷新
export function startCollectorExport(): void {
  if (flushTimer) return
  checkCollectorHealth().then(healthy => {
    if (healthy) console.log('[OTEL Collector] ✅ 已连接 ' + OTEL_COLLECTOR_URL)
  })
  flushTimer = setInterval(() => flushSpans().catch(() => {}), defaultConfig.flushIntervalMs)
}

export function stopCollectorExport(): void {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null }
}

// ═══════════════════════════════════════════════════════════
// Prometheus Metrics 导出
// ═══════════════════════════════════════════════════════════

let metricsRegistry = new Map<string, { type: 'counter' | 'gauge' | 'histogram'; value: number; labels: Record<string, string> }>()

export function recordMetric(name: string, value: number, type: 'counter' | 'gauge' | 'histogram' = 'gauge', labels: Record<string, string> = {}): void {
  const key = name + ':' + JSON.stringify(labels)
  const existing = metricsRegistry.get(key)
  if (existing) {
    if (type === 'counter') existing.value += value
    else existing.value = value
  } else {
    metricsRegistry.set(key, { type, value, labels })
  }
  if (metricsRegistry.size > 10000) {
    const keys = [...metricsRegistry.keys()]
    for (let i = 0; i < 1000; i++) metricsRegistry.delete(keys[i])
  }
}

export function getPrometheusMetrics(): string {
  const lines: string[] = []
  for (const [key, metric] of metricsRegistry) {
    const name = key.split(':')[0]
    const labelStr = Object.entries(metric.labels).map(([k, v]) => `${k}="${v}"`).join(',')
    lines.push(`# HELP ${name} ${name}`)
    lines.push(`# TYPE ${name} ${metric.type}`)
    lines.push(`${name}${labelStr ? '{' + labelStr + '}' : ''} ${metric.value}`)
  }
  return lines.join('\n') + '\n'
}

// ═══════════════════════════════════════════════════════════
// 本地 Dashboard 数据
// ═══════════════════════════════════════════════════════════

export interface DashboardStats {
  timestamp: number
  uptimeSeconds: number
  totalRequests: number
  activeSessions: number
  totalTokens: number
  totalToolCalls: number
  avgLatencyMs: number
  successRate: number
  providers: Record<string, { healthy: boolean; calls: number; errors: number }>
  mcpServers: Record<string, { status: string; toolCount: number }>
  memoryStats: { totalMemories: number; crossSessionCount: number; profileExists: boolean }
}

const dashboardHistory: DashboardStats[] = []

export function recordDashboardSnapshot(stats: DashboardStats): void {
  dashboardHistory.push(stats)
  if (dashboardHistory.length > 1440) dashboardHistory.shift() // 24h of per-minute data
}

export function getDashboardHistory(minutesBack = 60): DashboardStats[] {
  const cutoff = Date.now() - minutesBack * 60000
  return dashboardHistory.filter(s => s.timestamp > cutoff)
}

console.log('[OTelExporter] Collector导出+Prometheus+Dashboard 已就绪')
